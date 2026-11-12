// Empaqueta los procesos que corren fuera de Next (Scheduled Tasks y arranque) en dist/*.mjs.
// ciclo, vigilante y dataset se omiten mientras no exista su fuente (T-6, T-7, T-10).
import { existsSync } from "node:fs";
import { build } from "esbuild";

const procesos = ["ciclo", "vigilante", "migrar", "dataset", "seguimiento"].filter((p) => {
  const hay = existsSync(`src/procesos/${p}.ts`);
  if (!hay) console.log(`build:procesos: omito ${p} (sin src/procesos/${p}.ts)`);
  return hay;
});

await build({
  entryPoints: Object.fromEntries(procesos.map((p) => [p, `src/procesos/${p}.ts`])),
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // Autocontenido: la imagen final no necesita node_modules para los procesos.
  external: ["pg-native"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  sourcemap: false,
  logLevel: "info",
});
