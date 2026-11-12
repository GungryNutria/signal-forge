import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { esActivo, type Activo } from "@/core/activos";
import { MODOS, type Modo } from "@/core/modos";
import { filasDataset, type Proponente } from "@/server/dataset";
import { esquemaEnv, leerMaxEntradasAbiertas } from "@/server/env";

/** `--activo`, `--proponente` y `--modo`, cada uno como `--x valor` o `--x=valor`. Cualquier otro argumento es un error. */
export function leerArgumentos(argv: readonly string[]): { activo?: Activo; proponente?: Proponente; modo?: Modo } {
  const v: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(activo|proponente|modo)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`argumento desconocido: ${argv[i]}`);
    v[m[1]] = m[2] ?? argv[++i];
  }
  if (v.activo !== undefined && !esActivo(v.activo)) throw new Error("--activo debe ser BTC/USD o SOL/USD");
  if (v.proponente !== undefined && v.proponente !== "ciclo" && v.proponente !== "decisor") throw new Error("--proponente debe ser ciclo o decisor");
  if (v.modo !== undefined && !(MODOS as readonly string[]).includes(v.modo)) throw new Error("--modo debe ser ejecuta, solo_registra o apagado");
  return v as { activo?: Activo; proponente?: Proponente; modo?: Modo };
}

export const leerActivo = (argv: readonly string[]): Activo | undefined => leerArgumentos(argv).activo;

async function main() {
  const filtro = leerArgumentos(process.argv.slice(2));
  const { DATABASE_URL } = esquemaEnv.pick({ DATABASE_URL: true }).parse(process.env);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    // N vigente para `hip_cuenta_para_regla` (REQ-22): solo hace falta con filas del ciclo. Inválida → error.
    const topeN = filtro.proponente === "decisor" ? undefined : leerMaxEntradasAbiertas();
    // JSONL en stdout, una fila por evaluación del ciclo y después una por decisión; respeta la contrapresión si se redirige a un archivo.
    for await (const fila of filasDataset(pool, { ...filtro, topeN })) {
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
