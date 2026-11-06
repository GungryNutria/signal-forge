import { defineConfig } from "@playwright/test";

// E2E contra `next build && next start` con variables señuelo. Las specs de UI usan la base de
// E2E_DATABASE_URL (en CI, el service container); basic-auth.spec.ts no toca la base.
const PUERTO = 3192;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  use: { baseURL: `http://127.0.0.1:${PUERTO}` },
  webServer: {
    command: `npm run build && npm run start -- -p ${PUERTO} -H 127.0.0.1`,
    port: PUERTO, // /api/health da 503 sin base, así que se espera el puerto y no un 2xx
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://sf:sf@127.0.0.1:1/sf_e2e",
      APCA_API_KEY_ID: "sf-senuelo",
      APCA_API_SECRET_KEY: "sf-senuelo",
      APCA_API_BASE_URL: "https://paper-api.alpaca.markets",
      DASHBOARD_USUARIO: "sf-usuario-senuelo",
      DASHBOARD_CONTRASENA: "sf-contrasena-senuelo",
      INVESTIGADOR_TOKEN_SHA256: "0".repeat(64),
      TRADING_PAUSADO: "false",
      APP_ENV: "test",
    },
  },
});
