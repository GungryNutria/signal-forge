import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { esquemaEnv } from "@/server/env";

export type Db = NodePgDatabase;

let db: Db | undefined;

/** Conexión perezosa: nada se lee de process.env al importar el módulo (el build no tiene base). */
export function obtenerDb(): Db {
  if (!db) {
    const { DATABASE_URL } = esquemaEnv.pick({ DATABASE_URL: true }).parse(process.env);
    db = drizzle(new Pool({ connectionString: DATABASE_URL, max: 5 }));
  }
  return db;
}
