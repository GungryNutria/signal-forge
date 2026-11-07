import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { esquemaEnv } from "@/server/env";

async function main() {
  // Corre al arrancar el contenedor y solo necesita la base.
  const { DATABASE_URL } = esquemaEnv.pick({ DATABASE_URL: true }).parse(process.env);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    console.log("migraciones aplicadas");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "migración fallida");
  process.exit(1);
});
