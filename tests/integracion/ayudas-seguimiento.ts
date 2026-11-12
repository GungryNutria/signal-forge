import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

// Siembra por SQL de lo que lee `seguimiento` y el dataset: señales registradas, decisiones, modos y muestras de precio.
const MIN = 60_000;

const q = async (pool: Pool, texto: string, valores: unknown[] = []) => (await pool.query(texto, valores)).rows;

/** Una evaluación con `senal_registrada` cuyo precio de compra (ask de la foto) es `ask`. Devuelve su id. */
export async function sembrarSenal(
  pool: Pool,
  o: { activo?: string; t0: Date; ask: number | null; resultado?: string; modo?: string },
): Promise<string> {
  const [ej] = await q(pool, "INSERT INTO ejecuciones (ranura, inicio, version_regla) VALUES ($1, $1, 'tendencia-sma-v1') RETURNING id", [o.t0]);
  const foto = { version: "foto-v2", mercado: { ask: o.ask === null ? null : { valor: o.ask, ts: o.t0.toISOString() } } };
  const [ev] = await q(
    pool,
    `INSERT INTO evaluaciones (ejecucion_id, activo, evaluada_en, resultado, version_regla, foto, modo)
     VALUES ($1, $2, $3, $4, 'tendencia-sma-v1', $5, $6) RETURNING id`,
    [ej.id, o.activo ?? "BTC/USD", o.t0, o.resultado ?? "senal_registrada", JSON.stringify(foto), o.modo ?? "solo_registra"],
  );
  return ev.id;
}

/** Un contexto del decisor creado en `creadoEn`, con el ask de cada activo. */
export async function sembrarContexto(
  pool: Pool,
  creadoEn: Date,
  mercado: Partial<Record<"BTC/USD" | "SOL/USD", { ask: number | null; datos?: "disponibles" | "no_disponibles" }>> = {},
): Promise<string> {
  const activos = Object.fromEntries(
    (["BTC/USD", "SOL/USD"] as const).map((a) => {
      const m = mercado[a] ?? { ask: a === "BTC/USD" ? 100_000 : 200 };
      return [a, { datos: m.datos ?? "disponibles", mercado: { ask: m.ask === null ? null : { valor: m.ask, ts: creadoEn.toISOString() } } }];
    }),
  );
  const [c] = await q(
    pool,
    "INSERT INTO contextos_decisor (creado_en, token_huella, version, contenido) VALUES ($1, repeat('a', 16), 'contexto-v1', $2) RETURNING id",
    [creadoEn, JSON.stringify({ version: "contexto-v1", activos })],
  );
  return c.id;
}

export type OpcionesDecision = {
  ranura: Date;
  activo: "BTC/USD" | "SOL/USD";
  decision?: "comprar" | "no_comprar";
  valida?: boolean;
  motivo?: string | null;
  contextoId?: string;
  recibidaEn?: Date;
  modo?: string;
};

/** Una decisión (válida por omisión) con todos los campos que exige el CHECK. Devuelve su id. */
export async function sembrarDecision(pool: Pool, o: OpcionesDecision): Promise<string> {
  const valida = o.valida ?? true;
  const recibida = o.recibidaEn ?? new Date(o.ranura.getTime() + 5 * MIN);
  const contextoId = o.contextoId ?? (await sembrarContexto(pool, new Date(recibida.getTime() - MIN)));
  const [d] = await q(
    pool,
    `INSERT INTO decisiones (recibida_en, ranura, estado, motivo, valida, es_original, clave_idempotencia, huella_contenido,
       ejecucion_decisor, version_instrucciones, contexto_id, activo, decision, confianza, razonamiento, modo_configurado, modo_efectivo)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'x', 'decisor-v1@prueba', $8, $9, $10, 0.7, 'Texto', 'solo_registra', $11) RETURNING id`,
    [
      recibida, o.ranura, valida ? "aceptada" : "rechazada", o.motivo ?? (valida ? null : "decision_invalida"), valida,
      valida ? `dec:${randomUUID()}` : null, valida ? "a".repeat(64) : null, contextoId, o.activo,
      valida ? (o.decision ?? "no_comprar") : null, o.modo ?? "solo_registra",
    ],
  );
  return d.id;
}

/** Un evento de modos: el decisor con ese modo efectivo y el ciclo en `ejecuta`. */
export async function sembrarModo(pool: Pool, momento: Date, decisor: "ejecuta" | "solo_registra" | "apagado") {
  await q(pool, "INSERT INTO eventos (momento, tipo, detalle) VALUES ($1, 'modo_proponentes', $2)", [
    momento,
    JSON.stringify({
      ciclo: { configurado: "ejecuta", efectivo: "ejecuta", motivo: null },
      decisor: { configurado: decisor, efectivo: decisor, motivo: null },
    }),
  ]);
}

/** Variables que dan los modos que dejó el último `sembrarModo`. */
export const FUENTE_DECISOR = (decisor: "ejecuta" | "solo_registra" | "apagado") => ({ MODO_CICLO: "ejecuta", MODO_DECISOR: decisor });

/** Muestras de bid (ask = bid + 1) de un activo, una cada `cadaS` segundos desde `desde`. */
export async function sembrarMuestras(pool: Pool, activo: string, desde: Date, bids: number[], cadaS = 60) {
  for (const [i, bid] of bids.entries()) {
    const t = new Date(desde.getTime() + i * cadaS * 1000);
    await q(pool, "INSERT INTO muestras_precio (activo, fuente_ts, bid, ask, leido_en) VALUES ($1, $2, $3, $4, $2)", [activo, t, bid, bid + 1]);
  }
}
