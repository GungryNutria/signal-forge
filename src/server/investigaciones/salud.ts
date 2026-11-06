import { sql } from "drizzle-orm";
import { obtenerDb } from "@/server/db/cliente";

/** `select 1` contra la base, para el healthcheck. Nunca lanza ni devuelve datos. */
export async function baseDisponible(): Promise<boolean> {
  try {
    await obtenerDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
