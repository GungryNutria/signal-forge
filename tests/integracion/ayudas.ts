import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
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
