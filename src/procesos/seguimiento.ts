import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Activo } from "@/core/activos";
import { COMISION_BPS, nivelesLote } from "@/core/pnl";
import { type Intervalo, pnlANivel, resolverHipotetico, VERSION_HIPOTETICO } from "@/core/hipotetico";
import { TENDENCIA_SMA_V1 } from "@/core/regla/tendencia-sma-v1";
import { ranuraDecisor } from "@/core/tiempo";
import { activacionDecisor, modosActuales, registrarModos } from "@/server/modos";
import { esquemaEnv } from "@/server/env";

const HORA_MS = 3_600_000;
const POR_VUELTA = 200;

export type DepsSeguimiento = {
  pool: Pool;
  ahora: () => Date;
  log?: (linea: Record<string, unknown>) => void;
  /** Variables de las que salen los modos (D-4); por defecto `process.env`. */
  fuente?: Record<string, string | undefined>;
};

export type ResultadoSeguimiento = {
  estado: "completada" | "omitida_solapamiento" | "error";
  ranuras: number;
  hipoteticos: number;
};

type Pendiente = {
  origen: "senal_registrada" | "entrada_evitada";
  evaluacion_id: string | null;
  decision_id: string | null;
  activo: Activo;
  t0: Date;
  ask: string | null;
  datos: string | null;
};

const filas = async <T>(db: Pick<NodePgDatabase, "execute">, c: ReturnType<typeof sql>) => (await db.execute(c)).rows as T[];

/**
 * Proceso `seguimiento` (plan §5), Scheduled Task cada 5 min: registra los modos, cierra las ranuras terminadas del decisor
 * (REQ-26) y resuelve los resultados hipotéticos (REQ-20). Solo usa la base: ninguna llamada externa, y no toma
 * `sf:decision` ni `sf:vigilante` (RNF-7). Su candado es propio.
 */
export async function ejecutarSeguimiento(deps: DepsSeguimiento): Promise<ResultadoSeguimiento> {
  const log = deps.log ?? ((x) => console.log(JSON.stringify(x)));
  const db = drizzle(deps.pool);
  const conexion = await deps.pool.connect();
  let tieneCandado = false;
  try {
    const { rows } = await conexion.query("SELECT pg_try_advisory_lock(hashtext('sf:seguimiento')) AS ok");
    tieneCandado = rows[0].ok === true;
    if (!tieneCandado) {
      log({ evento: "seguimiento", estado: "omitida_solapamiento" });
      return { estado: "omitida_solapamiento", ranuras: 0, hipoteticos: 0 };
    }
    const ahora = deps.ahora();
    let modos;
    try {
      modos = modosActuales(deps.fuente);
    } catch {
      log({ evento: "seguimiento_modos_invalidos" });
    }
    if (modos) await registrarModos(db, modos, ahora);
    const ranuras = await cerrarRanuras(db, ahora);
    const hipoteticos = await resolverHipoteticos(db, ahora);
    log({ evento: "seguimiento", estado: "completada", ranuras, hipoteticos });
    return { estado: "completada", ranuras, hipoteticos };
  } catch (e) {
    log({ evento: "seguimiento", estado: "error", error: e instanceof Error ? e.message : "seguimiento fallido" });
    return { estado: "error", ranuras: 0, hipoteticos: 0 };
  } finally {
    if (tieneCandado) await conexion.query("SELECT pg_advisory_unlock(hashtext('sf:seguimiento'))").catch(() => {});
    conexion.release();
  }
}

/** REQ-26: una fila por cada ranura terminada desde la de la activación que aún no la tenga. */
async function cerrarRanuras(db: NodePgDatabase, ahora: Date): Promise<number> {
  const activacion = await activacionDecisor(db);
  if (!activacion) return 0;
  const primera = ranuraDecisor(activacion).getTime();
  // La última terminada es la anterior a la que contiene `ahora`.
  const ultima = ranuraDecisor(ahora).getTime() - HORA_MS;
  if (ultima < primera) return 0;
  const cerradas = new Set(
    (await filas<{ ranura: Date }>(db, sql`SELECT ranura FROM ranuras_decisor WHERE ranura >= ${new Date(primera).toISOString()}::timestamptz`)).map(
      (r) => new Date(r.ranura).getTime(),
    ),
  );
  let n = 0;
  for (let r = primera; r <= ultima; r += HORA_MS) {
    if (cerradas.has(r)) continue;
    const inicio = new Date(r).toISOString();
    const fin = new Date(r + HORA_MS).toISOString();
    const envios = await filas<{ id: string; activo: string | null; valida: boolean }>(
      db,
      sql`SELECT id, activo, valida FROM decisiones WHERE ranura = ${inicio}::timestamptz ORDER BY recibida_en, id`,
    );
    const porActivo: Record<string, string | null> = { "BTC/USD": null, "SOL/USD": null };
    for (const d of envios) if (d.valida && d.activo && porActivo[d.activo] === null) porActivo[d.activo] = d.id;
    const validas = Object.values(porActivo).filter((v) => v !== null).length;
    let estado: string;
    if (validas === 2) estado = "completa";
    else if (validas === 1) estado = "parcial";
    else {
      // Sin válidas: apagado si el decisor lo estaba al terminar la ranura; si no, inválida con envíos o sin llegar.
      const [modo] = await filas<{ efectivo: string }>(
        db,
        sql`SELECT detalle->'decisor'->>'efectivo' AS efectivo FROM eventos
            WHERE tipo = 'modo_proponentes' AND momento <= ${fin}::timestamptz ORDER BY id DESC LIMIT 1`,
      );
      estado = !modo || modo.efectivo === "apagado" ? "apagado" : envios.length > 0 ? "invalida" : "sin_llegar";
    }
    await db.execute(
      sql`INSERT INTO ranuras_decisor (ranura, cerrada_en, estado, detalle)
          VALUES (${inicio}::timestamptz, ${ahora.toISOString()}::timestamptz, ${estado}, ${JSON.stringify(porActivo)}::jsonb)
          ON CONFLICT (ranura) DO NOTHING`,
    );
    n++;
  }
  return n;
}

/**
 * REQ-20: resuelve las señales registradas y las entradas evitadas que aún no tienen resultado, de la más vieja a la más
 * nueva. Una fila solo cuando toca un nivel (o no hay precio de entrada); mientras tanto sigue pendiente.
 */
async function resolverHipoteticos(db: NodePgDatabase, ahora: Date): Promise<number> {
  const pendientes = await filas<Pendiente>(
    db,
    sql`SELECT * FROM (
          SELECT 'senal_registrada' AS origen, e.id AS evaluacion_id, NULL::uuid AS decision_id, e.activo, e.evaluada_en AS t0,
                 e.foto->'mercado'->'ask'->>'valor' AS ask, NULL::text AS datos
          FROM evaluaciones e
          WHERE e.resultado = 'senal_registrada'
            AND NOT EXISTS (SELECT 1 FROM resultados_hipoteticos h WHERE h.evaluacion_id = e.id)
          UNION ALL
          SELECT 'entrada_evitada', NULL::uuid, d.id, d.activo, cx.creado_en,
                 cx.contenido->'activos'->d.activo->'mercado'->'ask'->>'valor', cx.contenido->'activos'->d.activo->>'datos'
          FROM decisiones d JOIN contextos_decisor cx ON cx.id = d.contexto_id
          WHERE d.valida AND d.decision = 'no_comprar'
            AND NOT EXISTS (SELECT 1 FROM resultados_hipoteticos h WHERE h.decision_id = d.id)
        ) x ORDER BY t0, origen LIMIT ${POR_VUELTA}`,
  );
  if (pendientes.length === 0) return 0;

  // Las muestras de cada activo se leen una vez, desde el t0 más viejo de la vuelta.
  const muestras = new Map<Activo, Intervalo[]>();
  for (const activo of new Set(pendientes.map((p) => p.activo))) {
    const desde = new Date(Math.min(...pendientes.filter((p) => p.activo === activo).map((p) => new Date(p.t0).getTime())));
    const rs = await filas<{ fuente_ts: Date; bid: string }>(
      db,
      sql`SELECT fuente_ts, bid FROM muestras_precio
          WHERE activo = ${activo} AND fuente_ts > ${desde.toISOString()}::timestamptz AND fuente_ts <= ${ahora.toISOString()}::timestamptz
          ORDER BY fuente_ts`,
    );
    muestras.set(
      activo,
      rs.map((r) => ({ desde: new Date(r.fuente_ts), hasta: new Date(r.fuente_ts), min: Number(r.bid), max: Number(r.bid) })),
    );
  }

  const nocional = TENDENCIA_SMA_V1.nocionalUsd;
  let n = 0;
  for (const p of pendientes) {
    const t0 = new Date(p.t0);
    // Sin precio de entrada no se inventa uno (O-2 del plan); una decisión con datos no disponibles tampoco lo tiene (D-12).
    const precio = p.ask !== null && p.datos !== "no_disponibles" ? Number(p.ask) : NaN;
    const base = [p.origen, p.evaluacion_id, p.decision_id, p.activo, t0.toISOString(), nocional, COMISION_BPS, VERSION_HIPOTETICO] as const;
    if (!(precio > 0)) {
      await insertarHipotetico(db, base, ahora, { resultado: "sin_precio_entrada" });
      n++;
      continue;
    }
    const datos = (muestras.get(p.activo) ?? []).filter((m) => m.desde.getTime() > t0.getTime());
    const h = resolverHipotetico({ t0, precioEntrada: precio }, datos, ahora);
    if (h.resultado === "pendiente") continue;
    const niveles = nivelesLote(precio);
    const nivel = h.resultado === "stop_loss" ? niveles.stopLoss : niveles.takeProfit;
    const pnl = pnlANivel(precio, nivel, nocional);
    await insertarHipotetico(db, base, ahora, {
      resultado: h.resultado,
      precio,
      stopLoss: niveles.stopLoss,
      takeProfit: niveles.takeProfit,
      tocadoEn: h.tocadoEn,
      precioToque: h.precioToque,
      pnl,
      huecos: h.huecos,
    });
    n++;
  }
  return n;
}

async function insertarHipotetico(
  db: NodePgDatabase,
  base: readonly [string, string | null, string | null, Activo, string, number, number, string],
  ahora: Date,
  r: {
    resultado: string;
    precio?: number;
    stopLoss?: number;
    takeProfit?: number;
    tocadoEn?: Date | null;
    precioToque?: number | null;
    pnl?: { usd: string; pct: string };
    huecos?: { desde: Date; hasta: Date }[];
  },
) {
  const [origen, evaluacionId, decisionId, activo, t0, nocional, comision, version] = base;
  const num = (v: number | undefined | null) => (v === undefined || v === null ? null : v.toFixed(10));
  const huecos = (r.huecos ?? []).map((h) => ({ desde: h.desde.toISOString(), hasta: h.hasta.toISOString() }));
  await db.execute(
    sql`INSERT INTO resultados_hipoteticos (origen, evaluacion_id, decision_id, activo, t0, precio_entrada, nocional_usd,
          stop_loss, take_profit, comision_bps, resultado, tocado_en, precio_toque, pnl_a_nivel_usd, pnl_a_nivel_pct,
          etiqueta_exito, huecos, version, calculado_en)
        VALUES (${origen}, ${evaluacionId}::uuid, ${decisionId}::uuid, ${activo}, ${t0}::timestamptz, ${num(r.precio)}, ${nocional},
          ${num(r.stopLoss)}, ${num(r.takeProfit)}, ${comision}, ${r.resultado}, ${r.tocadoEn?.toISOString() ?? null}::timestamptz,
          ${num(r.precioToque)}, ${r.pnl?.usd ?? null}, ${r.pnl?.pct ?? null},
          ${r.pnl ? (Number(r.pnl.usd) > 0 ? 1 : 0) : null}, ${JSON.stringify(huecos)}::jsonb, ${version}, ${ahora.toISOString()}::timestamptz)
        ON CONFLICT DO NOTHING`,
  );
}

async function main() {
  const { DATABASE_URL } = esquemaEnv.pick({ DATABASE_URL: true }).parse(process.env);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const r = await ejecutarSeguimiento({ pool, ahora: () => new Date() });
    if (r.estado === "error") process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(JSON.stringify({ evento: "seguimiento_fatal", error: e instanceof Error ? e.message : "seguimiento fallido" }));
    process.exit(1);
  });
}
