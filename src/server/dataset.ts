import type { Pool } from "pg";
import { esActivo, type Activo } from "@/core/activos";

const POR_LOTE = 500;

/** Una fila de `v_dataset`: una evaluación del ciclo por activo (REQ-26). Se entrega tal como está en la vista. */
export type FilaDataset = Record<string, unknown>;

/**
 * REQ-26, REQ-35: recorre `v_dataset` en orden cronológico (evaluada_en, id), por lotes y solo con SELECT.
 * No consulta ninguna fuente externa ni transforma lo guardado. `activo` filtra la extracción.
 */
export async function* filasDataset(pool: Pool, f: { activo?: Activo } = {}): AsyncGenerator<FilaDataset> {
  if (f.activo !== undefined && !esActivo(f.activo)) throw new Error(`activo inválido: ${String(f.activo)}`);
  let ultimo: string | null = null;
  for (;;) {
    const { rows }: { rows: (FilaDataset & { evaluacion_id: string })[] } = await pool.query(
      `SELECT * FROM v_dataset
       WHERE ($1::text IS NULL OR activo = $1)
         AND ($2::uuid IS NULL OR (evaluada_en, evaluacion_id) > (SELECT evaluada_en, evaluacion_id FROM v_dataset WHERE evaluacion_id = $2))
       ORDER BY evaluada_en, evaluacion_id
       LIMIT ${POR_LOTE}`,
      [f.activo ?? null, ultimo],
    );
    yield* rows;
    if (rows.length < POR_LOTE) return;
    ultimo = rows[rows.length - 1].evaluacion_id;
  }
}
