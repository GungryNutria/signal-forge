import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit: sin base de datos. Los de integración usan vitest.integracion.config.mts.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"] },
});
