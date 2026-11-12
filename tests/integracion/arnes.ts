import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export function urlDePrueba(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Falta TEST_DATABASE_URL (ver .env.example)");
  // El arnés borra el esquema public: solo corre contra bases desechables.
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error("TEST_DATABASE_URL debe apuntar a una base cuyo nombre contenga 'test'");
  }
  return url;
}

export function abrirPool(max = 5): Pool {
  return new Pool({ connectionString: urlDePrueba(), max });
}

/** Deja la base como recién creada: recrea public, borra el registro de migraciones y migra. */
export async function reiniciarBase(): Promise<void> {
  const pool = abrirPool(1);
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("CREATE SCHEMA public");
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

const TABLAS = [
  "ejecuciones",
  "ejecuciones_cierre",
  "evaluaciones",
  "propuestas",
  "ordenes",
  "eventos_orden",
  "lotes",
  "cierres_lote",
  "investigaciones",
  "eventos",
  "lecturas_mercado",
  "contextos_decisor",
  "decisiones",
];

/** Vacía todas las tablas sin recrear el esquema (más rápido que `reiniciarBase`). Pide superusuario: desactiva los triggers de solo inserción. */
export async function vaciarBase(): Promise<void> {
  const pool = abrirPool(1);
  const c = await pool.connect();
  try {
    await c.query("SET session_replication_role = replica");
    await c.query(`TRUNCATE ${TABLAS.join(", ")} CASCADE`);
  } finally {
    await c.query("SET session_replication_role = DEFAULT");
    c.release();
    await pool.end();
  }
}
