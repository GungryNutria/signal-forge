import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Activo } from "@/core/activos";
import type { Snapshot } from "@/server/broker/tipos";
import { lecturasMercado, muestrasPrecio } from "@/server/db/esquema";

/** Upsert de `lecturas_mercado`: el precio leído o, si la lectura falló, solo el error (AC-6). */
export async function guardarLectura(
  db: NodePgDatabase,
  activo: Activo,
  lectura: Snapshot | { error: string },
  t: Date,
): Promise<void> {
  if ("error" in lectura) {
    await db
      .insert(lecturasMercado)
      .values({ activo, ultimoErrorEn: t, ultimoError: lectura.error })
      .onConflictDoUpdate({ target: lecturasMercado.activo, set: { ultimoErrorEn: t, ultimoError: lectura.error } });
    return;
  }
  const d = { bid: String(lectura.bid), ask: String(lectura.ask), ultimo: String(lectura.ultimo), fuenteTs: lectura.tsQuote, leidoEn: t };
  await db.insert(lecturasMercado).values({ activo, ...d }).onConflictDoUpdate({ target: lecturasMercado.activo, set: d });
  // Muestra del bid y el ask para los resultados hipotéticos (REQ-20). Un quote sin cambio repite `fuente_ts` y no duplica.
  // Un fallo aquí no debe detener al vigilante (RNF-7): la muestra que falte aparece como hueco.
  try {
    await db
      .insert(muestrasPrecio)
      .values({ activo, fuenteTs: lectura.tsQuote, bid: d.bid, ask: d.ask, leidoEn: t })
      .onConflictDoNothing({ target: [muestrasPrecio.activo, muestrasPrecio.fuenteTs] });
  } catch {
    // intencional
  }
}
