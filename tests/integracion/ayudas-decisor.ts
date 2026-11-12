import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { BrokerSimulado, DatosSimulados } from "@/server/broker/simulado";
import type { Barra } from "@/server/broker/tipos";
import { hashToken } from "@/server/investigaciones/auth";
import { recibirContexto, recibirDecision, type DependenciasDecisor } from "@/server/decisor/recibir";
import { abrirPool } from "./arnes";
import { AHORA } from "./ayudas";

// Valores señuelo: ninguno es un secreto real.
export const TOKEN_DECISOR = `sfd_${"D".repeat(43)}`;
export const TOKEN_INVESTIGADOR = `sfi_${"I".repeat(43)}`;
export const HASHES = { investigador: hashToken(TOKEN_INVESTIGADOR), decisor: hashToken(TOKEN_DECISOR) };
export const VERSION = "decisor-v1@claude-haiku-prueba";
const MIN = 60_000;

/** 52 barras de 30 min que terminan en `fin`; la serie crece desde `base`. */
export function barras(fin: Date, base: number): Barra[] {
  return Array.from({ length: 52 }, (_, i) => {
    const c = base + i;
    return { t: new Date(fin.getTime() - (52 - i) * 30 * MIN).toISOString(), o: c, h: c, l: c, c, v: 2 };
  });
}

/** Mercado fresco a `ahora`: barras cerradas hasta `ahora` y quotes de hace 10 s. */
export function mercadoEn(datos: DatosSimulados, ahora: Date) {
  datos.barras = { "BTC/USD": barras(ahora, 100_000), "SOL/USD": barras(ahora, 200) };
  const quote = (p: number) => ({
    bid: p - 1,
    ask: p + 1,
    ultimo: p,
    tsQuote: new Date(ahora.getTime() - 10_000),
    tsTrade: new Date(ahora.getTime() - 20_000),
  });
  datos.instantaneas = { "BTC/USD": quote(100_000), "SOL/USD": quote(200) };
}

export type EntornoDecisor = {
  pool: Pool;
  broker: BrokerSimulado;
  datos: DatosSimulados;
  deps: DependenciasDecisor;
  /** Variables de las que salen los modos y N; se pueden cambiar entre peticiones. */
  fuente: Record<string, string | undefined>;
  /** Reloj simulado de la petición. */
  reloj: { ahora: Date };
  ordenesEnviadas: () => number;
};

/** Entorno de las rutas del decisor: reloj simulado, broker y mercado simulados y una base de pruebas. */
export function crearEntornoDecisor(
  fuente: Record<string, string | undefined> = { MODO_CICLO: "solo_registra", MODO_DECISOR: "ejecuta" },
  env: Partial<DependenciasDecisor["env"]> = {},
): EntornoDecisor {
  const pool = abrirPool(12);
  const broker = new BrokerSimulado();
  broker.precios = { "BTC/USD": 100_000, "SOL/USD": 200 };
  const datos = new DatosSimulados();
  mercadoEn(datos, AHORA);
  const reloj = { ahora: AHORA };
  const deps: DependenciasDecisor = {
    db: drizzle(pool),
    hashes: HASHES,
    ahora: () => reloj.ahora,
    datos,
    broker,
    env: { APCA_API_BASE_URL: "https://paper-api.alpaca.markets", TRADING_PAUSADO: "false", ...env },
    fuente,
    esperar: async () => {},
  };
  return {
    pool,
    broker,
    datos,
    deps,
    fuente,
    reloj,
    ordenesEnviadas: () => broker.llamadas.filter((l) => l.metodo === "enviarOrden").length,
  };
}

export const urlContextos = "http://localhost/api/v1/decisor/contextos";
export const urlDecisiones = "http://localhost/api/v1/decisor/decisiones";

/** Valor completo de la cabecera `Authorization`; `null` = sin cabecera. */
export const BEARER_DECISOR = `Bearer ${TOKEN_DECISOR}`;

export const pedirContexto = (e: EntornoDecisor, autorizacion: string | null = BEARER_DECISOR) =>
  recibirContexto(
    new Request(urlContextos, { method: "POST", headers: autorizacion ? { authorization: autorizacion } : {} }),
    e.deps,
  );

/** Pide un contexto con el token del decisor y devuelve su JSON. */
export async function contexto(e: EntornoDecisor): Promise<{ id: string; activos: Record<string, { datos: string }> }> {
  const res = await pedirContexto(e);
  if (res.status !== 201) throw new Error(`contexto: ${res.status}`);
  return res.json();
}

export const enviarDecision = (e: EntornoDecisor, cuerpo: string | object, autorizacion: string | null = BEARER_DECISOR) =>
  recibirDecision(
    new Request(urlDecisiones, {
      method: "POST",
      headers: { "content-type": "application/json", ...(autorizacion ? { authorization: autorizacion } : {}) },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }),
    e.deps,
  );

let n = 0;
/** Decisión válida con clave nueva; `extra` pisa cualquier campo (un valor `undefined` lo quita). */
export function decisionValida(contextoId: string, extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    clave_idempotencia: `dec:${n}:${randomUUID()}`,
    ejecucion_id: "2026-11-06T11",
    version_instrucciones: VERSION,
    contexto_id: contextoId,
    activo: "BTC/USD",
    decision: "comprar",
    confianza: 0.72,
    razonamiento: "Tendencia al alza con spread bajo.",
    ...extra,
  };
}

export const q = async (e: EntornoDecisor, texto: string, valores: unknown[] = []) =>
  (await e.pool.query(texto, valores)).rows;

/**
 * Siembra por SQL un lote abierto de BTC/USD (o de otro activo) con su propuesta y orden llenada, con hora explícita
 * para que el contexto con reloj simulado lo vea. `proponente`: "decisor" o la regla del ciclo.
 */
export async function sembrarLoteAbierto(
  pool: Pool,
  o: { activo?: string; abiertoEn: Date; proponente?: string; precio?: number; clave?: string },
) {
  const activo = o.activo ?? "BTC/USD";
  const clave = o.clave ?? `sembrada:${randomUUID()}`;
  const precio = o.precio ?? 100_000;
  const [p] = (
    await pool.query(
      `INSERT INTO propuestas (clave_idempotencia, es_original, proponente, activo, entrada_cruda, decision, motivo, recibida_en)
       VALUES ($1, true, $2, $3, '{}', 'ejecutada', 'aprobada', $4) RETURNING id`,
      [clave, o.proponente ?? "tendencia-sma-v1", activo, o.abiertoEn],
    )
  ).rows;
  const [oe] = (
    await pool.query(
      `INSERT INTO ordenes (propuesta_id, tramo, client_order_id, activo, lado, nocional_usd, creada_en)
       VALUES ($1, 'entrada', $2, $3, 'buy', 500, $4) RETURNING id`,
      [p.id, `sf-e-${clave}`, activo, o.abiertoEn],
    )
  ).rows;
  await pool.query("INSERT INTO eventos_orden (orden_id, estado, momento) VALUES ($1, 'llenada', $2)", [oe.id, o.abiertoEn]);
  const cantidad = 500 / precio;
  const [lote] = (
    await pool.query(
      `INSERT INTO lotes (propuesta_id, orden_entrada_id, activo, abierto_en, precio_entrada, cantidad_llenada, cantidad_neta,
         nocional_entrada_usd, comision_bps, stop_loss, take_profit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 500, 25, $8, $9) RETURNING id`,
      [p.id, oe.id, activo, o.abiertoEn, precio, cantidad, cantidad * 0.9975, precio * 0.98, precio * 1.04],
    )
  ).rows;
  return { propuestaId: p.id as string, loteId: lote.id as string, ordenId: oe.id as string };
}

/** Siembra una entrada viva sin lote (orden enviada, sin llenar). */
export async function sembrarEntradaPendiente(pool: Pool, o: { activo?: string; creadaEn: Date; estado?: string }) {
  const activo = o.activo ?? "BTC/USD";
  const [p] = (
    await pool.query(
      `INSERT INTO propuestas (clave_idempotencia, es_original, proponente, activo, entrada_cruda, decision, motivo, recibida_en)
       VALUES ($1, true, 'decisor', $2, '{}', 'ejecutada', 'aprobada', $3) RETURNING id`,
      [`pend:${randomUUID()}`, activo, o.creadaEn],
    )
  ).rows;
  const [oe] = (
    await pool.query(
      `INSERT INTO ordenes (propuesta_id, tramo, client_order_id, activo, lado, nocional_usd, creada_en)
       VALUES ($1, 'entrada', $2, $3, 'buy', 500, $4) RETURNING id`,
      [p.id, `sf-e-pend-${randomUUID()}`, activo, o.creadaEn],
    )
  ).rows;
  await pool.query("INSERT INTO eventos_orden (orden_id, estado, momento) VALUES ($1, $2, $3)", [oe.id, o.estado ?? "enviada", o.creadaEn]);
  return oe.id as string;
}
