import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integración: Postgres real en TEST_DATABASE_URL. Cada archivo recrea public y migra
// (tests/integracion/setup.ts), así que los archivos corren de uno en uno.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integracion/**/*.test.ts"],
    setupFiles: ["tests/integracion/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
