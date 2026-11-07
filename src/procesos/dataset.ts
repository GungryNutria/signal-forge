import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { esActivo, type Activo } from "@/core/activos";
import { esquemaEnv } from "@/server/env";
import { filasDataset } from "@/server/dataset";

/** `--activo BTC/USD` o `--activo=BTC/USD`. Cualquier otro argumento es un error. */
export function leerActivo(argv: readonly string[]): Activo | undefined {
  let activo: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--activo") activo = argv[++i];
    else if (a.startsWith("--activo=")) activo = a.slice("--activo=".length);
    else throw new Error(`argumento desconocido: ${a}`);
  }
  if (activo === undefined) return undefined;
  if (!esActivo(activo)) throw new Error("--activo debe ser BTC/USD o SOL/USD");
  return activo;
}

async function main() {
  const activo = leerActivo(process.argv.slice(2));
  const { DATABASE_URL } = esquemaEnv.pick({ DATABASE_URL: true }).parse(process.env);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    // JSONL en stdout, una evaluación por línea; respeta la contrapresión si se redirige a un archivo.
    for await (const fila of filasDataset(pool, { activo })) {
      if (!process.stdout.write(`${JSON.stringify(fila)}\n`)) await once(process.stdout, "drain");
    }
  } finally {
    await pool.end();
  }
}

// Solo corre como proceso (`node dist/dataset.mjs`); importarlo desde los tests no ejecuta nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "dataset fallido");
    process.exit(1);
  });
}
