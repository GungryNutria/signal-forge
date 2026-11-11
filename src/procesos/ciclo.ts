import { pathToFileURL } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ACTIVOS, type Activo } from "@/core/activos";
import { armarFoto, type DatoConTs } from "@/core/foto";
import { evaluarTendenciaSmaV1, TENDENCIA_SMA_V1 } from "@/core/regla/tendencia-sma-v1";
import { ranura30 } from "@/core/tiempo";
import { AlpacaBroker } from "@/server/broker/alpaca";
import { AlpacaDatos } from "@/server/broker/datos";
import {
  ErrorBroker,
  type Barra,
  type Broker,
  type DatosMercado,
  type Snapshot,
} from "@/server/broker/tipos";
import {
  ejecuciones,
  ejecucionesCierre,
  evaluaciones,
  eventos,
} from "@/server/db/esquema";
import { cargarEnv, leerMaxEntradasAbiertas, type Env } from "@/server/env";
import { guardarLectura } from "@/server/lecturas";
import { carteraParaFoto, investigacionVigente } from "@/server/foto";
import { procesarPropuesta, URL_PAPER, type CtxPropuesta } from "@/server/propuestas/procesar";

const MIN = 60_000;
const BARRAS_REQUERIDAS = TENDENCIA_SMA_V1.periodoSma + 1;
const PLAZO_INTERNO_MS = 120_000;

export type DepsCiclo = {
  pool: Pool;
  broker: Broker;
  datos: DatosMercado;
  ahora: () => Date;
  env: Pick<Env, "APCA_API_BASE_URL" | "TRADING_PAUSADO">;
  /** Valores que nunca deben salir en el log ni en `error_detalle` (llaves del broker). */
  secretos?: readonly string[];
  /** Plazo interno (RNF-11); por defecto 120 s. */
  plazoMs?: number;
  esperar?: CtxPropuesta["esperar"];
  log?: (linea: Record<string, unknown>) => void;
};

export type ResultadoCiclo = {
  ejecucionId: string;
  estado: "completada" | "error" | "omitida_solapamiento";
  evaluaciones: { activo: Activo; resultado: string; propuestaId?: string }[];
};

/**
 * Clave de idempotencia del ciclo (desviación 3 de T-4): ranura de 30 min, versión de la regla y activo.
 * Dos ejecuciones de la misma ranura producen la misma clave, así que el camino común las trata como un reintento (AC-12).
 */
export function claveCiclo(ranura: Date, activo: Activo): string {
  return `ciclo:${TENDENCIA_SMA_V1.version}:${ranura.toISOString().replace(".000Z", "Z")}:${activo}`;
}

type Mercado = {
  barras: Partial<Record<Activo, Barra[] | ErrorBroker>>;
  snapshots: Partial<Record<Activo, Snapshot>> | ErrorBroker;
};

const comoError = (e: unknown) => (e instanceof ErrorBroker ? e : e instanceof Error ? e : new Error(String(e)));

async function leerMercado(datos: DatosMercado, desde: Date, hasta: Date): Promise<Mercado> {
  const [snapshots, ...barras] = await Promise.all([
    datos.snapshots(ACTIVOS).catch(comoError),
    ...ACTIVOS.map((a) => datos.barras30m(a, desde, hasta).catch(comoError)),
  ]);
  return {
    snapshots: snapshots as Mercado["snapshots"],
    barras: Object.fromEntries(ACTIVOS.map((a, i) => [a, barras[i]])),
  };
}

const esFallo = (x: unknown): x is Error => x instanceof Error;

export async function ejecutarCiclo(deps: DepsCiclo): Promise<ResultadoCiclo> {
  const db = drizzle(deps.pool);
  const limpiar = (texto: string) => (deps.secretos ?? []).reduce((t, s) => (s ? t.split(s).join("[oculto]") : t), texto);
  const log = (linea: Record<string, unknown>) =>
    (deps.log ?? ((l) => console.log(JSON.stringify(l))))(JSON.parse(limpiar(JSON.stringify(linea))));

  const conexion = await deps.pool.connect();
  let tieneCandado = false;
  let errorConexion: Error | undefined;
  try {
    const { rows } = await conexion.query("SELECT pg_try_advisory_lock(hashtext('sf:ciclo')) AS ok");
    tieneCandado = rows[0].ok === true;
    return tieneCandado ? await correr(deps, db, limpiar, log) : await omitir(deps, db, log);
  } finally {
    try {
      if (tieneCandado) await conexion.query("SELECT pg_advisory_unlock(hashtext('sf:ciclo'))");
    } catch (e) {
      errorConexion = comoError(e); // se destruye la conexión: Postgres libera el candado al cerrarla
    }
    conexion.release(errorConexion);
  }
}

/** REQ-36: otro ciclo tiene el candado; queda constancia y no se hace nada más. */
async function omitir(deps: DepsCiclo, db: NodePgDatabase, log: (l: Record<string, unknown>) => void): Promise<ResultadoCiclo> {
  const ahora = deps.ahora();
  const [{ id }] = await db
    .insert(ejecuciones)
    .values({ ranura: ranura30(ahora), inicio: ahora, versionRegla: TENDENCIA_SMA_V1.version })
    .returning({ id: ejecuciones.id });
  await db.insert(ejecucionesCierre).values({ ejecucionId: id, fin: deps.ahora(), estado: "omitida_solapamiento" });
  log({ evento: "ciclo", ejecucion_id: id, estado: "omitida_solapamiento" });
  return { ejecucionId: id, estado: "omitida_solapamiento", evaluaciones: [] };
}

async function correr(
  deps: DepsCiclo,
  db: NodePgDatabase,
  limpiar: (t: string) => string,
  log: (l: Record<string, unknown>) => void,
): Promise<ResultadoCiclo> {
  const inicio = deps.ahora();
  const ranura = ranura30(inicio);
  const [{ id: ejecucionId }] = await db
    .insert(ejecuciones)
    .values({ ranura, inicio, versionRegla: TENDENCIA_SMA_V1.version })
    .returning({ id: ejecuciones.id });

  const hechos: ResultadoCiclo["evaluaciones"] = [];
  const fallos: string[] = [];
  let abortado = false;

  const evaluar = async () => {
    // REQ-8: N se lee al empezar; si es inválida lanza y la ejecución termina en `error` sin evaluar ni proponer.
    const maxEntradasAbiertasPorActivo = leerMaxEntradasAbiertas();
    const mercado = await leerMercado(deps.datos, new Date(inicio.getTime() - 25 * 60 * MIN), inicio);
    // REQ-24: T se toma después de leer los datos, así que todo dato es anterior o igual a T.
    const T = deps.ahora();
    await registrarLecturas(db, mercado, T, limpiar);
    const bid = Object.fromEntries(
      ACTIVOS.map((a) => [a, !esFallo(mercado.snapshots) ? (mercado.snapshots[a]?.bid ?? null) : null]),
    ) as Record<Activo, number | null>;

    for (const activo of ACTIVOS) {
      if (abortado) return;
      try {
        hechos.push(await evaluarActivo({ deps, db, ejecucionId, ranura, activo, mercado, T, bid, maxEntradasAbiertasPorActivo, limpiar, fallos, abortado: () => abortado }));
      } catch (e) {
        const detalle = limpiar(comoError(e).message);
        const [fila] = await db
          .insert(evaluaciones)
          .values({
            ejecucionId,
            activo,
            evaluadaEn: T,
            resultado: "error",
            versionRegla: TENDENCIA_SMA_V1.version,
            foto: { version: "foto-v2" },
            errorDetalle: detalle,
          })
          .onConflictDoNothing()
          .returning({ id: evaluaciones.id });
        if (fila) hechos.push({ activo, resultado: "error" });
        else fallos.push(`${activo}: ${detalle}`); // la evaluación ya estaba registrada y no se puede corregir (append-only)
        log({ evento: "ciclo_activo_error", ejecucion_id: ejecucionId, activo, error: detalle });
      }
    }
  };

  let temporizador: NodeJS.Timeout | undefined;
  try {
    const plazo = new Promise<"plazo">((r) => {
      temporizador = setTimeout(() => r("plazo"), deps.plazoMs ?? PLAZO_INTERNO_MS);
    });
    const fin = await Promise.race([evaluar().then(() => "ok" as const), plazo]);
    if (fin === "plazo") {
      abortado = true;
      fallos.push("plazo interno agotado");
      const T = deps.ahora();
      for (const activo of ACTIVOS.filter((a) => !hechos.some((h) => h.activo === a))) {
        const [fila] = await db
          .insert(evaluaciones)
          .values({
            ejecucionId,
            activo,
            evaluadaEn: T,
            resultado: "error",
            versionRegla: TENDENCIA_SMA_V1.version,
            foto: { version: "foto-v2" },
            errorDetalle: "plazo interno agotado",
          })
          .onConflictDoNothing()
          .returning({ id: evaluaciones.id });
        if (fila) hechos.push({ activo, resultado: "error" });
      }
    }
  } catch (e) {
    fallos.push(limpiar(comoError(e).message));
  } finally {
    clearTimeout(temporizador);
  }

  const estado = fallos.length > 0 ? "error" : "completada";
  const error = fallos.length > 0 ? fallos.join("; ") : null;
  if (error) await db.insert(eventos).values({ momento: deps.ahora(), tipo: "error_ciclo", detalle: { ejecucionId, error } });
  await db.insert(ejecucionesCierre).values({ ejecucionId, fin: deps.ahora(), estado, error });
  log({ evento: "ciclo", ejecucion_id: ejecucionId, estado, evaluaciones: hechos });
  return { ejecucionId, estado, evaluaciones: hechos };
}

/** Guarda en `lecturas_mercado` el precio leído y, si algo falló, el error (AC-6). */
async function registrarLecturas(db: NodePgDatabase, m: Mercado, t: Date, limpiar: (t: string) => string) {
  for (const activo of ACTIVOS) {
    const b = m.barras[activo];
    const falla = esFallo(m.snapshots) ? m.snapshots : esFallo(b) ? b : null;
    const s = esFallo(m.snapshots) ? undefined : m.snapshots[activo];
    if (s) await guardarLectura(db, activo, s, t);
    if (falla || !s) await guardarLectura(db, activo, { error: limpiar(falla ? falla.message : "sin quote o trade para el activo") }, t);
  }
}

type ParamsActivo = {
  deps: DepsCiclo;
  db: NodePgDatabase;
  ejecucionId: string;
  ranura: Date;
  activo: Activo;
  mercado: Mercado;
  T: Date;
  bid: Record<Activo, number | null>;
  maxEntradasAbiertasPorActivo: number;
  limpiar: (t: string) => string;
  fallos: string[];
  abortado: () => boolean;
};

async function evaluarActivo(p: ParamsActivo): Promise<ResultadoCiclo["evaluaciones"][number]> {
  const { deps, db, ejecucionId, ranura, activo, mercado, T } = p;
  const b = mercado.barras[activo];
  const barras = esFallo(b) ? [] : (b ?? []);
  const snap = esFallo(mercado.snapshots) ? undefined : mercado.snapshots[activo];

  // Barras cerradas y criterios de "datos no disponibles" (REQ-6).
  const cerradas = barras
    .filter((x) => Date.parse(x.t) + 30 * MIN <= T.getTime())
    .sort((a, c) => Date.parse(a.t) - Date.parse(c.t));
  let sinDatos: string | null = null;
  if (esFallo(b)) sinDatos = `barras: ${b.message}`;
  else if (esFallo(mercado.snapshots)) sinDatos = `snapshots: ${mercado.snapshots.message}`;
  else if (cerradas.length < BARRAS_REQUERIDAS) sinDatos = `solo ${cerradas.length} barras cerradas (se necesitan ${BARRAS_REQUERIDAS})`;
  else if (T.getTime() - (Date.parse(cerradas[cerradas.length - 1].t) + 30 * MIN) > 60 * MIN)
    sinDatos = "la última barra cerrada terminó hace más de 60 min";
  else if (!snap) sinDatos = "sin quote para el activo";
  else if (snap.tsQuote.getTime() > T.getTime() || T.getTime() - snap.tsQuote.getTime() > 300_000)
    sinDatos = "quote ausente o con más de 300 s";

  const dato = (valor: number | undefined, ts: Date | undefined): DatoConTs | null =>
    snap && valor !== undefined && ts ? { valor, ts } : null;
  const closes = cerradas.slice(-BARRAS_REQUERIDAS).map((x) => x.c);
  const regla = sinDatos ? null : { version: TENDENCIA_SMA_V1.version, closes, resultado: evaluarTendenciaSmaV1(closes) };
  const investigacion = await investigacionVigente(db, activo, T);

  const foto = armarFoto({
    evaluadaEn: T,
    cartera: await carteraParaFoto(db, T, p.bid),
    mercado: {
      activo,
      ultimo: dato(snap?.ultimo, snap?.tsTrade),
      bid: dato(snap?.bid, snap?.tsQuote),
      ask: dato(snap?.ask, snap?.tsQuote),
      barras,
    },
    regla,
    investigacion,
  });

  const resultado = sinDatos ? "datos_no_disponibles" : regla?.resultado.senal ? "propuesta" : "sin_senal";
  const [{ id: evaluacionId }] = await db
    .insert(evaluaciones)
    .values({
      ejecucionId,
      activo,
      evaluadaEn: T,
      resultado,
      versionRegla: TENDENCIA_SMA_V1.version,
      foto,
      investigacionId: investigacion?.id ?? null,
      errorDetalle: sinDatos ? p.limpiar(sinDatos) : null,
    })
    .returning({ id: evaluaciones.id });
  if (resultado !== "propuesta" || !regla || p.abortado()) return { activo, resultado };

  const entrada = {
    clave_idempotencia: claveCiclo(ranura, activo),
    activo,
    lado: "buy",
    nocional_usd: TENDENCIA_SMA_V1.nocionalUsd,
    tipo_orden: TENDENCIA_SMA_V1.tipoOrden,
    proponente: TENDENCIA_SMA_V1.version,
    ejecucion_id: ejecucionId,
    version_regla: TENDENCIA_SMA_V1.version,
    justificacion: {
      entradas: { closes },
      resultado: {
        senal: true,
        close_ultimo: regla.resultado.closeUltimo,
        close_previo: regla.resultado.closePrevio,
        sma20: regla.resultado.sma20,
      },
    },
  };
  try {
    const r = await procesarPropuesta(entrada, {
      db,
      broker: deps.broker,
      ahora: deps.ahora,
      env: deps.env,
      maxEntradasAbiertasPorActivo: p.maxEntradasAbiertasPorActivo,
      evaluacionId,
      esperar: deps.esperar,
    });
    return { activo, resultado, propuestaId: r.propuestaId };
  } catch (e) {
    // La evaluación ya dice "propuesta" y es de solo inserción: se deja constancia en la ejecución y sigue el otro activo.
    p.fallos.push(`${activo}: ${p.limpiar(comoError(e).message)}`);
    return { activo, resultado };
  }
}

/** Broker de relleno cuando la URL no es la de paper: `procesarPropuesta` ya rechaza antes de usarlo (REQ-15). */
const brokerProhibido: Broker = {
  enviarOrden: () => Promise.reject(new Error("broker no disponible: APCA_API_BASE_URL no es la de paper")),
  consultarOrden: () => Promise.reject(new Error("broker no disponible: APCA_API_BASE_URL no es la de paper")),
};

async function main() {
  const env = cargarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  try {
    const broker =
      env.APCA_API_BASE_URL === URL_PAPER
        ? new AlpacaBroker({ keyId: env.APCA_API_KEY_ID, secretKey: env.APCA_API_SECRET_KEY, baseUrl: env.APCA_API_BASE_URL })
        : brokerProhibido;
    const r = await ejecutarCiclo({
      pool,
      broker,
      datos: new AlpacaDatos(),
      ahora: () => new Date(),
      env,
      secretos: [env.APCA_API_SECRET_KEY, env.APCA_API_KEY_ID],
    });
    if (r.estado === "error") process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Solo corre como proceso (`node dist/ciclo.mjs`); importarlo desde los tests no ejecuta nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(JSON.stringify({ evento: "ciclo_fatal", error: e instanceof Error ? e.message : "ciclo fallido" }));
    process.exit(1);
  });
}

