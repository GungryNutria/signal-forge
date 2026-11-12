import type { Pool } from "pg";
import { esActivo, type Activo } from "@/core/activos";
import { aplicarTope } from "@/core/hipotetico";
import { MODOS, type Modo } from "@/core/modos";

const POR_LOTE = 500;

/** Una fila de `v_dataset` o `v_dataset_decisor`. Se entrega tal como está en la vista. */
export type FilaDataset = Record<string, unknown>;

export type Proponente = "ciclo" | "decisor";
export type FiltroDataset = {
  activo?: Activo;
  proponente?: Proponente;
  modo?: Modo;
  /** N vigente (REQ-22) para `hip_cuenta_para_regla`. Sin él, esa columna sale `null`. */
  topeN?: number;
};

type Vista = { nombre: "v_dataset" | "v_dataset_decisor"; t: string; id: string };
const CICLO: Vista = { nombre: "v_dataset", t: "evaluada_en", id: "evaluacion_id" };
const DECISOR: Vista = { nombre: "v_dataset_decisor", t: "recibida_en", id: "decision_id" };

/** Recorre una vista en orden cronológico, por lotes y solo con SELECT. */
async function* recorrer(pool: Pool, v: Vista, f: FiltroDataset): AsyncGenerator<FilaDataset> {
  let ultimo: string | null = null;
  for (;;) {
    const { rows }: { rows: FilaDataset[] } = await pool.query(
      `SELECT * FROM ${v.nombre}
       WHERE ($1::text IS NULL OR activo = $1)
         AND ($2::text IS NULL OR modo = $2)
         AND ($3::uuid IS NULL OR (${v.t}, ${v.id}) > (SELECT ${v.t}, ${v.id} FROM ${v.nombre} WHERE ${v.id} = $3))
       ORDER BY ${v.t}, ${v.id}
       LIMIT ${POR_LOTE}`,
      [f.activo ?? null, f.modo ?? null, ultimo],
    );
    yield* rows;
    if (rows.length < POR_LOTE) return;
    ultimo = rows[rows.length - 1][v.id] as string;
  }
}

/**
 * REQ-22 y REQ-25: qué señales registradas cuentan para la regla con N fijo. Se calcula con todas las señales de la
 * base (no solo las filtradas), porque el tope depende de las anteriores del mismo activo.
 */
async function cuentaParaRegla(pool: Pool, n: number | undefined): Promise<Map<string, boolean | null>> {
  const { rows } = await pool.query(
    `SELECT evaluacion_id, activo, evaluada_en AS t0, hip_tocado_en AS "tocadoEn"
     FROM v_dataset WHERE resultado = 'senal_registrada' ORDER BY evaluada_en, evaluacion_id`,
  );
  if (n === undefined) return new Map(rows.map((r) => [r.evaluacion_id as string, null]));
  return new Map(aplicarTope(rows as { evaluacion_id: string; activo: string; t0: Date; tocadoEn: Date | null }[], n).map((s) => [s.evaluacion_id, s.cuenta]));
}

/**
 * REQ-31, REQ-35: filas del ciclo (`v_dataset`, una por evaluación) y después las del decisor (`v_dataset_decisor`, una
 * por decisión), cada una con su `proponente` y su `modo`. Sin `proponente` salen las dos. Solo SELECT, ninguna fuente
 * externa. Las filas de señales registradas llevan además `hip_cuenta_para_regla`.
 */
export async function* filasDataset(pool: Pool, f: FiltroDataset = {}): AsyncGenerator<FilaDataset> {
  if (f.activo !== undefined && !esActivo(f.activo)) throw new Error(`activo inválido: ${String(f.activo)}`);
  if (f.modo !== undefined && !(MODOS as readonly string[]).includes(f.modo)) throw new Error(`modo inválido: ${String(f.modo)}`);
  if (f.proponente !== undefined && f.proponente !== "ciclo" && f.proponente !== "decisor") throw new Error(`proponente inválido: ${String(f.proponente)}`);
  if (f.proponente !== "decisor") {
    const cuenta = await cuentaParaRegla(pool, f.topeN);
    for await (const fila of recorrer(pool, CICLO, f)) {
      yield cuenta.has(fila.evaluacion_id as string) ? { ...fila, hip_cuenta_para_regla: cuenta.get(fila.evaluacion_id as string) } : fila;
    }
  }
  if (f.proponente !== "ciclo") yield* recorrer(pool, DECISOR, f);
}
