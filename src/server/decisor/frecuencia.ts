import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/cliente";

export const MAX_PETICIONES = 30;
export const VENTANA_MIN = 60;

/**
 * RNF-5: 30 peticiones por 60 min móviles para el token del decisor. Solo hay un token, así que se cuentan las filas
 * de la ventana en `contextos_decisor` y `decisiones`. Devuelve los segundos hasta que la más vieja salga de la ventana
 * si ya se alcanzó el límite, o `null` si hay lugar.
 */
export async function segundosParaPoderEnviar(db: Db, ahora: Date): Promise<number | null> {
  const desde = new Date(ahora.getTime() - VENTANA_MIN * 60_000).toISOString();
  const [{ n, primera }] = (
    await db.execute(
      sql`SELECT count(*)::int AS n, min(t) AS primera FROM (
            SELECT creado_en AS t FROM contextos_decisor WHERE creado_en > ${desde}::timestamptz
            UNION ALL
            SELECT recibida_en AS t FROM decisiones WHERE recibida_en > ${desde}::timestamptz
          ) x`,
    )
  ).rows as { n: number; primera: Date | null }[];
  if (n < MAX_PETICIONES) return null;
  const venceEnS = primera ? VENTANA_MIN * 60 - (ahora.getTime() - new Date(primera).getTime()) / 1000 : 60;
  return Math.max(1, Math.ceil(venceEnS));
}
