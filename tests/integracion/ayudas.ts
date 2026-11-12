import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { BrokerSimulado } from "@/server/broker/simulado";
import type { CtxPropuesta } from "@/server/propuestas/procesar";
import { abrirPool } from "./arnes";

export const AHORA = new Date("2026-11-06T12:00:00Z");
export const URL_REAL = "https://api.alpaca.markets";

/** `max`: N de R11. Por defecto alto, para que los tests de otras reglas puedan abrir varias entradas del mismo activo. */
export function crearEntorno(env: Partial<CtxPropuesta["env"]> = {}, max = 100) {
  const pool = abrirPool(12);
  const broker = new BrokerSimulado();
  broker.precios = { "BTC/USD": 100_000, "SOL/USD": 200 };
  const ctx: CtxPropuesta = {
    db: drizzle(pool),
    broker,
    ahora: () => AHORA,
    maxEntradasAbiertasPorActivo: max,
    env: { APCA_API_BASE_URL: "https://paper-api.alpaca.markets", TRADING_PAUSADO: "false", ...env },
    esperar: async () => {},
  };
  return { pool, broker, ctx };
}

let n = 0;
/** Compra válida con clave y ejecución nuevas; `extra` pisa cualquier campo. */
export function compra(extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    clave_idempotencia: `test:${n}:${randomUUID()}`,
    activo: "BTC/USD",
    lado: "buy",
    nocional_usd: 500,
    tipo_orden: "mercado",
    proponente: "tendencia-sma-v1",
    ejecucion_id: randomUUID(),
    version_regla: "tendencia-sma-v1",
    justificacion: { entradas: { sma: 1 }, resultado: { senal: true } },
    ...extra,
  };
}

export type OpcionesCierre = {
  /** Distingue las claves únicas cuando se siembran varios. */
  n: number;
  motivo: "stop_loss" | "take_profit";
  precioSalida: number;
  pnlNetoUsd: number;
  /** Bid y hora de la quote que disparó la salida; sin él, el cierre es anterior a la medición (REQ-15). */
  disparo?: { precio: number; ts: Date };
  /** Arreglo `reglas` de la propuesta: `null` = no llegó al riesgo. Por omisión, 11 reglas que cumplen. */
  reglas?: unknown[] | null;
  /** Con `true` la propuesta cuelga de una evaluación (la necesita `v_dataset`). */
  evaluacion?: boolean;
  /** La propuesta nace de esta decisión del decisor (`v_dataset_decisor`). */
  decisionId?: string;
};

export const reglasCumplen = (cuantas: 10 | 11) =>
  Array.from({ length: cuantas }, (_, i) => ({ regla: `R${i + 1}`, aplica: true, cumple: true, observado: "x", limite: "y" }));

/**
 * Siembra por SQL una entrada de BTC/USD (q 0.005, qn 0.0049875, P 100000, stop 98000, take profit 104000) con su lote
 * cerrado, para comprobar `v_cierres` y `v_dataset` con números hechos a mano.
 */
export async function sembrarCierre(pool: Pool, o: OpcionesCierre): Promise<{ loteId: string; propuestaId: string; evaluacionId: string | null }> {
  const q = async (texto: string, valores: unknown[] = []) => (await pool.query(texto, valores)).rows;
  let evaluacionId: string | null = null;
  if (o.evaluacion) {
    const [ej] = await q("INSERT INTO ejecuciones (ranura, version_regla) VALUES (now(), 'tendencia-sma-v1') RETURNING id");
    [{ id: evaluacionId }] = await q(
      "INSERT INTO evaluaciones (ejecucion_id, activo, resultado, version_regla, foto) VALUES ($1, 'BTC/USD', 'propuesta', 'tendencia-sma-v1', '{}') RETURNING id",
      [ej.id],
    );
  }
  const reglas = o.reglas === undefined ? reglasCumplen(11) : o.reglas;
  const [p] = await q(
    // Sin `decisionId` no se menciona la columna: así también sirve contra el esquema anterior a la migración 0005.
    `INSERT INTO propuestas (clave_idempotencia, es_original, evaluacion_id, activo, entrada_cruda, decision, motivo, reglas${o.decisionId ? ", decision_id" : ""})
     VALUES ($1, true, $2, 'BTC/USD', '{}', 'ejecutada', 'aprobada', $3${o.decisionId ? ", $4" : ""}) RETURNING id`,
    [`sembrada:${o.n}`, evaluacionId, reglas === null ? null : JSON.stringify(reglas), ...(o.decisionId ? [o.decisionId] : [])],
  );
  const [oe] = await q(
    "INSERT INTO ordenes (propuesta_id, tramo, client_order_id, activo, lado, nocional_usd) VALUES ($1, 'entrada', $2, 'BTC/USD', 'buy', 500) RETURNING id",
    [p.id, `sf-e-sembrada-${o.n}`],
  );
  await q("INSERT INTO eventos_orden (orden_id, estado) VALUES ($1, 'llenada')", [oe.id]);
  const [lote] = await q(
    `INSERT INTO lotes (propuesta_id, orden_entrada_id, activo, precio_entrada, cantidad_llenada, cantidad_neta,
       nocional_entrada_usd, comision_bps, stop_loss, take_profit)
     VALUES ($1, $2, 'BTC/USD', 100000, 0.005, 0.0049875, 500, 25, 98000, 104000) RETURNING id`,
    [p.id, oe.id],
  );
  // Sin `disparo` no se mencionan las columnas nuevas: así también sirve contra el esquema anterior a la migración 0002.
  const [os] = await q(
    o.disparo
      ? `INSERT INTO ordenes (lote_id, tramo, client_order_id, activo, lado, cantidad, precio_disparo, precio_disparo_ts)
         VALUES ($1, 'salida', $2, 'BTC/USD', 'sell', 0.0049875, $3, $4) RETURNING id`
      : `INSERT INTO ordenes (lote_id, tramo, client_order_id, activo, lado, cantidad)
         VALUES ($1, 'salida', $2, 'BTC/USD', 'sell', 0.0049875) RETURNING id`,
    [lote.id, `sf-x-sembrada-${o.n}`, ...(o.disparo ? [o.disparo.precio, o.disparo.ts] : [])],
  );
  await q(
    `INSERT INTO cierres_lote (lote_id, orden_salida_id, precio_salida, motivo_cierre, pnl_neto_usd, pnl_neto_pct,
       duracion_s, etiqueta_exito)
     VALUES ($1, $2, $3, $4, $5, $6, 60, $7)`,
    [lote.id, os.id, o.precioSalida, o.motivo, o.pnlNetoUsd, o.pnlNetoUsd / 500, o.pnlNetoUsd > 0 ? 1 : 0],
  );
  return { loteId: lote.id, propuestaId: p.id, evaluacionId };
}
