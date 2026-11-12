import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Reglas de dependencia del plan (§Estructura del repo). Se aplican sobre el texto del import.
const restringir = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // core: puro. Solo importa core y zod (más node:crypto, para la huella SHA-256 de propuesta.ts).
  // Los tests quedan fuera para poder importar vitest.
  {
    files: ["src/core/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: restringir({
      regex: "^(?!zod$|node:crypto$|\\./|@/core/).*",
      message: "core solo puede importar core, zod y node:crypto.",
    }),
  },
  {
    files: ["src/core/*/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: restringir({
      regex: "^(?!zod$|node:crypto$|\\.{1,2}/|@/core/).*|^\\.\\./\\.\\./",
      message: "core solo puede importar core, zod y node:crypto.",
    }),
  },
  // procesos: importan core y server/*, excepto server/consultas; corren fuera de Next.
  {
    files: ["src/procesos/**/*.ts"],
    rules: restringir(
      { regex: "(^|/)server/consultas(/|$)", message: "procesos no importa server/consultas." },
      { regex: "^(next|server-only)(/|$)", message: "procesos corre fuera de Next." },
      { regex: "(^@/|/)app/", message: "procesos no importa app." },
    ),
  },
  // app: solo core, server/consultas, server/investigaciones y server/decisor.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/proxy.ts"],
    rules: restringir(
      {
        regex: "(^@/|/)server/(?!consultas(/|$)|investigaciones(/|$)|decisor(/|$))",
        message: "app solo importa server/consultas, server/investigaciones y server/decisor.",
      },
      { regex: "(^@/|/)procesos/", message: "app no importa procesos." },
      { regex: "^(pg|drizzle-orm)(/|$)", message: "app accede a la base solo vía server/*." },
    ),
  },
  // consultas de solo lectura: nunca tocan el broker (spec 002, AC-16).
  {
    files: ["src/server/consultas/**/*.ts"],
    rules: restringir({ regex: "(^@/|/)server/broker(/|$)", message: "las consultas del dashboard no importan el broker." }),
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generados o de terceros:
    "dist/**",
    "drizzle/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
