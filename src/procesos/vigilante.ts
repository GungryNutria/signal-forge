import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ACTIVOS, esActivo, type Activo } from "@/core/activos";
import { deCentavos } from "@/core/dinero";
import { cerrarLote, type MotivoCierre } from "@/core/pnl";
import { AlpacaBroker } from "@/server/broker/alpaca";
import { AlpacaDatos } from "@/server/broker/datos";
import { ErrorBroker, type Broker, type DatosMercado, type OrdenBroker } from "@/server/broker/tipos";
import { calcularCartera } from "@/server/cartera";
import { cierresLote, eventos, eventosOrden, ordenes } from "@/server/db/esquema";
import { cargarEnv, type Env } from "@/server/env";
import { guardarLectura } from "@/server/lecturas";
import { estadoDe, registrarLlenadoEntrada, URL_PAPER } from "@/server/propuestas/procesar";

const PLAZO_INTERNO_MS = 45_000;
const PRECIO_FRESCO_MS = 120_000;
const NO_ENVIADA_TRAS_MS = 60_000;
const VIVOS = "('pendiente_envio','enviada','aceptada','parcial','desconocido')";

export type DepsVigilante = {
  pool: Pool;
  broker: Broker;
  datos: DatosMercado;
  ahora: () => Date;
  env: Pick<Env, "APCA_API_BASE_URL">;
  secretos?: readonly string[];
  plazoMs?: number;
  log?: (linea: Record<string, unknown>) => void;
};

export type ResultadoVigilante = {
  estado: "completada" | "omitida_solapamiento" | "error";
  reconciliadas: number;
  ventas: number;
  cierres: number;
};

type Orden = { id: string; tramo: string; client_order_id: string; activo: string; lote_id: string | null; creada_en: Date; estado: string };
type Lote = { id: string; activo: string; abierto_en: Date; nocional_c: string; cantidad_neta: string; stop_loss: string; take_profit: string };

const comoError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

export async function ejecutarVigilante(deps: DepsVigilante): Promise<ResultadoVigilante> {
  const db = drizzle(deps.pool);
  const limpiar = (t: string) => (deps.secretos ?? []).reduce((acc, s) => (s ? acc.split(s).join("[oculto]") : acc), t);
  const log = (l: Record<string, unknown>) =>
    (deps.log ?? ((x) => console.log(JSON.stringify(x))))(JSON.parse(limpiar(JSON.stringify(l))));

  const conexion = await deps.pool.connect();
  let tieneCandado = false;
  let errorConexion: Error | undefined;
  try {
    const { rows } = await conexion.query("SELECT pg_try_advisory_lock(hashtext('sf:vigilante')) AS ok");
    tieneCandado = rows[0].ok === true;
    if (!tieneCandado) {
      log({ evento: "vigilante", estado: "omitida_solapamiento" });
      return { estado: "omitida_solapamiento", reconciliadas: 0, ventas: 0, cierres: 0 };
    }
    return await correr(deps, db, limpiar, log);
  } finally {
    try {
      if (tieneCandado) await conexion.query("SELECT pg_advisory_unlock(hashtext('sf:vigilante'))");
    } catch (e) {
      errorConexion = comoError(e);
    }
    conexion.release(errorConexion);
  }
}

async function correr(
  deps: DepsVigilante,
  db: NodePgDatabase,
  limpiar: (t: string) => string,
  log: (l: Record<string, unknown>) => void,
): Promise<ResultadoVigilante> {
  const r: ResultadoVigilante = { estado: "completada", reconciliadas: 0, ventas: 0, cierres: 0 };
  let abortado = false;
  const falla = async (e: unknown) => {
    r.estado = "error";
    const error = limpiar(comoError(e).message);
    log({ evento: "vigilante_error", error });
    await db.insert(eventos).values({ momento: deps.ahora(), tipo: "error_vigilante", detalle: { error } }).catch(() => {});
  };

  const trabajo = async () => {
    // REQ-15: fuera de paper no se toca el broker.
    if (deps.env.APCA_API_BASE_URL !== URL_PAPER) {
      await db.insert(eventos).values({ momento: deps.ahora(), tipo: "entorno_no_paper", detalle: { proceso: "vigilante" } });
      log({ evento: "vigilante", estado: "entorno_no_paper" });
      return;
    }
    await leerPrecios(deps, db, limpiar);
    const cuenta = { reconciliadas: 0, cierres: 0 };
    await reconciliar(deps, db, cuenta, log, () => abortado);
    r.reconciliadas = cuenta.reconciliadas;
    const ventas = { ventas: 0, cierres: 0 };
    if (!abortado) await proteger(deps, db, ventas, log, () => abortado, falla);
    r.ventas = ventas.ventas;
    r.cierres = cuenta.cierres + ventas.cierres;
    // REQ-31: si el PnL del día llegó a -3 %, deja el evento (las protecciones siguen funcionando).
    if (!abortado) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sf:decision'))`);
        await calcularCartera(tx, deps.ahora(), false);
      });
    }
  };

  let temporizador: NodeJS.Timeout | undefined;
  try {
    const plazo = new Promise<"plazo">((res) => {
      temporizador = setTimeout(() => res("plazo"), deps.plazoMs ?? PLAZO_INTERNO_MS);
    });
    const fin = await Promise.race([trabajo().then(() => "ok" as const), plazo]);
    if (fin === "plazo") {
      abortado = true;
      await falla(new Error("plazo interno de 45 s agotado"));
    }
  } catch (e) {
    await falla(e);
  } finally {
    clearTimeout(temporizador);
  }
  log({ evento: "vigilante", ...r });
  return r;
}

async function leerPrecios(deps: DepsVigilante, db: NodePgDatabase, limpiar: (t: string) => string) {
  const t = deps.ahora();
  let snaps;
  try {
    snaps = await deps.datos.snapshots(ACTIVOS);
  } catch (e) {
    for (const a of ACTIVOS) await guardarLectura(db, a, { error: limpiar(comoError(e).message) }, t);
    return;
  }
  for (const a of ACTIVOS) {
    const s = snaps[a];
    await guardarLectura(db, a, s ?? { error: "sin quote o trade para el activo" }, t);
  }
}

const filas = async <T>(db: Pick<NodePgDatabase, "execute">, c: ReturnType<typeof sql>) => (await db.execute(c)).rows as T[];

/** Reconciliación (REQ-16): las órdenes no terminales se comparan con el broker. Una entrada nunca se reenvía. */
async function reconciliar(
  deps: DepsVigilante,
  db: NodePgDatabase,
  cuenta: { reconciliadas: number; cierres: number },
  log: (l: Record<string, unknown>) => void,
  abortado: () => boolean,
) {
  const pendientes = await filas<Orden>(
    db,
    sql`SELECT id, tramo, client_order_id, activo, lote_id, creada_en, estado FROM v_ordenes
        WHERE estado IN ${sql.raw(VIVOS)} ORDER BY creada_en, id`,
  );
  for (const o of pendientes) {
    if (abortado()) return;
    const ahora = deps.ahora();
    let b: OrdenBroker | "no_existe";
    try {
      b = await deps.broker.consultarOrden(o.client_order_id);
    } catch (e) {
      if (!(e instanceof ErrorBroker)) throw e;
      log({ evento: "reconciliar_sin_respuesta", orden: o.id, causa: e.causa });
      continue;
    }
    cuenta.reconciliadas++;
    if (b === "no_existe") {
      if (ahora.getTime() - new Date(o.creada_en).getTime() > NO_ENVIADA_TRAS_MS) {
        await db.insert(eventosOrden).values({ ordenId: o.id, momento: ahora, estado: "no_enviada", detalle: "el broker no la conoce (404)" });
      }
      continue;
    }
    const nuevo = estadoDe(b.status);
    if (nuevo === "llenada") {
      if (o.tramo === "entrada") await registrarLlenadoEntrada(db, o.id, b, ahora);
      else if (await cerrarSalida(db, o, b, ahora)) cuenta.cierres++;
    } else if (nuevo !== o.estado && !(nuevo === "aceptada" && (o.estado === "enviada" || o.estado === "aceptada"))) {
      await db.insert(eventosOrden).values({
        ordenId: o.id,
        momento: ahora,
        estado: nuevo,
        brokerOrderId: b.id,
        respuesta: b.raw,
        cantidadLlenada: b.filledQty,
        precioMedio: b.filledAvgPrice,
      });
    }
  }
}

/** Evento `llenada` de la salida y cierre del lote con PnL neto y etiqueta (REQ-25). Idempotente. */
async function cerrarSalida(db: NodePgDatabase, o: Orden, b: OrdenBroker, ahora: Date): Promise<boolean> {
  const precio = Number(b.filledAvgPrice);
  if (!o.lote_id || !(precio > 0)) throw new Error("salida llenada sin lote o precio válidos");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sf:decision'))`);
    const [ya] = await filas<{ n: string }>(tx, sql`SELECT count(*)::text AS n FROM cierres_lote WHERE lote_id = ${o.lote_id}`);
    if (Number(ya.n) > 0) return false;
    const [lote] = await filas<Lote>(
      tx,
      sql`SELECT id, activo, abierto_en, round(nocional_entrada_usd * 100)::text AS nocional_c,
          cantidad_neta::text, stop_loss::text, take_profit::text FROM lotes WHERE id = ${o.lote_id}`,
    );
    const [inicial] = await filas<{ detalle: string }>(
      tx,
      sql`SELECT detalle FROM eventos_orden WHERE orden_id = ${o.id} AND estado = 'pendiente_envio' ORDER BY id LIMIT 1`,
    );
    const motivo = inicial?.detalle as MotivoCierre;
    if (motivo !== "stop_loss" && motivo !== "take_profit") throw new Error("la salida no registra su motivo de cierre");

    await tx.insert(eventosOrden).values({
      ordenId: o.id,
      momento: ahora,
      estado: "llenada",
      brokerOrderId: b.id,
      respuesta: b.raw,
      cantidadLlenada: b.filledQty,
      precioMedio: b.filledAvgPrice,
    });
    const c = cerrarLote({
      nocionalEntradaC: Number(lote.nocional_c),
      cantidadNeta: Number(lote.cantidad_neta),
      precioSalida: precio,
      motivo,
      abiertoEn: new Date(lote.abierto_en),
      cerradoEn: ahora,
    });
    await tx.insert(cierresLote).values({
      loteId: lote.id,
      ordenSalidaId: o.id,
      cerradoEn: ahora,
      precioSalida: String(precio),
      motivoCierre: c.motivo,
      pnlNetoUsd: deCentavos(c.pnlNetoC),
      pnlNetoPct: c.pnlNetoPct.toFixed(6),
      duracionS: c.duracionS,
      etiquetaExito: c.etiquetaExito,
    });
    return true;
  });
}

/** Protecciones (REQ-17): un lote abierto, sin salida viva y con precio fresco, vende `cantidad_neta` si toca un nivel. */
async function proteger(
  deps: DepsVigilante,
  db: NodePgDatabase,
  cuenta: { ventas: number; cierres: number },
  log: (l: Record<string, unknown>) => void,
  abortado: () => boolean,
  falla: (e: unknown) => Promise<void>,
) {
  const abiertos = await filas<Lote & { n_salidas: string }>(
    db,
    sql`SELECT l.id, l.activo, l.abierto_en, round(l.nocional_entrada_usd * 100)::text AS nocional_c,
          l.cantidad_neta::text, l.stop_loss::text, l.take_profit::text,
          (SELECT count(*) FROM ordenes s WHERE s.lote_id = l.id AND s.tramo = 'salida')::text AS n_salidas
        FROM lotes l
        WHERE NOT EXISTS (SELECT 1 FROM cierres_lote c WHERE c.lote_id = l.id)
          AND NOT EXISTS (SELECT 1 FROM v_ordenes s WHERE s.lote_id = l.id AND s.tramo = 'salida' AND s.estado IN ${sql.raw(VIVOS)})
        ORDER BY l.abierto_en, l.id`,
  );
  const precios = new Map(
    (await filas<{ activo: string; bid: string | null; leido_en: Date | null; fuente_ts: Date | null }>(db, sql`SELECT activo, bid::text, leido_en, fuente_ts FROM lecturas_mercado`)).map(
      (p) => [p.activo, p],
    ),
  );

  for (const l of abiertos) {
    if (abortado()) return;
    const ahora = deps.ahora();
    const p = precios.get(l.activo);
    if (!esActivo(l.activo) || !p?.leido_en || p.bid === null) continue;
    if (ahora.getTime() - new Date(p.leido_en).getTime() >= PRECIO_FRESCO_MS) continue;
    const bid = Number(p.bid);
    const motivo: MotivoCierre | null = bid <= Number(l.stop_loss) ? "stop_loss" : bid >= Number(l.take_profit) ? "take_profit" : null;
    if (!motivo) continue;

    // Nunca se pide más de lo que el broker deja vender: su comisión en especie puede superar la del modelo y,
    // en el último lote del activo, la posición no tiene holgura. Sin lectura o sin saldo no se crea la orden.
    let cantidad = l.cantidad_neta;
    try {
      const disponible = await deps.broker.cantidadDisponible(l.activo as Activo);
      if (!(Number(disponible) > 0)) {
        log({ evento: "venta_sin_saldo", lote: l.id, motivo, disponible });
        continue;
      }
      if (Number(disponible) < Number(cantidad)) cantidad = disponible;
    } catch (e) {
      if (!(e instanceof ErrorBroker)) throw e;
      await falla(new Error(`no se pudo leer la cantidad disponible de ${l.activo} (lote ${l.id}): ${e.message}`));
      continue;
    }

    const clientOrderId = `sf-x-${l.id.replaceAll("-", "")}-${Number(l.n_salidas) + 1}`;
    const [orden] = await db.transaction(async (tx) => {
      const o = await tx
        .insert(ordenes)
        .values({ loteId: l.id, tramo: "salida", clientOrderId, activo: l.activo, lado: "sell", cantidad, creadaEn: ahora, precioDisparo: String(bid), precioDisparoTs: p.fuente_ts ? new Date(p.fuente_ts) : null })
        .returning({ id: ordenes.id });
      await tx.insert(eventosOrden).values({ ordenId: o[0].id, momento: ahora, estado: "pendiente_envio", detalle: motivo });
      return o;
    });
    cuenta.ventas++;
    log({ evento: "venta", lote: l.id, motivo, bid });

    const o: Orden = { id: orden.id, tramo: "salida", client_order_id: clientOrderId, activo: l.activo, lote_id: l.id, creada_en: ahora, estado: "pendiente_envio" };
    const e = await deps.broker.enviarOrden({ clientOrderId, simbolo: l.activo as Activo, lado: "sell", cantidad });
    const evento = (x: Partial<typeof eventosOrden.$inferInsert> & Pick<typeof eventosOrden.$inferInsert, "estado">) =>
      db.insert(eventosOrden).values({ ordenId: o.id, momento: deps.ahora(), ...x });
    if (e.tipo === "incierta") await evento({ estado: "desconocido", detalle: e.causa });
    else if (e.tipo === "rechazada") {
      await evento({ estado: "rechazada", respuesta: { status: e.status, cuerpo: e.cuerpo }, detalle: `HTTP ${e.status}` });
      // 'rechazada' no es viva: se reintenta cada vuelta, así que no puede pasar en silencio.
      const mensaje = (e.cuerpo as { message?: unknown } | null)?.message;
      await falla(new Error(`salida rechazada por el broker (lote ${l.id}): HTTP ${e.status}${typeof mensaje === "string" ? ` ${mensaje}` : ""}`));
    } else {
      await evento({ estado: "enviada", brokerOrderId: e.orden.id, respuesta: e.orden.raw, cantidadLlenada: e.orden.filledQty, precioMedio: e.orden.filledAvgPrice });
      if (estadoDe(e.orden.status) === "llenada" && (await cerrarSalida(db, { ...o, estado: "enviada" }, e.orden, deps.ahora()))) cuenta.cierres++;
    }
  }
}

async function main() {
  const env = cargarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  try {
    const broker =
      env.APCA_API_BASE_URL === URL_PAPER
        ? new AlpacaBroker({ keyId: env.APCA_API_KEY_ID, secretKey: env.APCA_API_SECRET_KEY, baseUrl: env.APCA_API_BASE_URL })
        : ({
            enviarOrden: () => Promise.reject(new Error("broker no disponible fuera de paper")),
            consultarOrden: () => Promise.reject(new Error("broker no disponible fuera de paper")),
            cantidadDisponible: () => Promise.reject(new Error("broker no disponible fuera de paper")),
          } satisfies Broker);
    const r = await ejecutarVigilante({
      pool,
      broker,
      datos: new AlpacaDatos({ keyId: env.APCA_API_KEY_ID, secretKey: env.APCA_API_SECRET_KEY }),
      ahora: () => new Date(),
      env,
      secretos: [env.APCA_API_SECRET_KEY, env.APCA_API_KEY_ID],
    });
    if (r.estado === "error") process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(JSON.stringify({ evento: "vigilante_fatal", error: e instanceof Error ? e.message : "vigilante fallido" }));
    process.exit(1);
  });
}
