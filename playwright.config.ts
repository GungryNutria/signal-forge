import { defineConfig } from "@playwright/test";
import { PUERTOS } from "./tests/e2e/ayuda";

// E2E contra `next build && next start` con variables señuelo. Las specs de UI usan la base de
// E2E_DATABASE_URL (en CI, el service container; su nombre debe contener "test" o "e2e" para que `sembrar.ts
// --reiniciar` la acepte) y se saltan si no está; basic-auth.spec.ts no toca la base.
//
// Los escenarios se siembran por test sobre una sola base, así que las specs corren en serie (workers: 1). Las
// variables que se leen al arrancar el servidor (pausa manual y fallas inyectadas, AC-UX-3 y AC-UX-9) llevan cada
// una su propio servidor, con el mismo build. Playwright los levanta en orden: el primero compila.
const PUERTO = PUERTOS.normal;

const entorno = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://sf:sf@127.0.0.1:1/sf_e2e",
  APCA_API_KEY_ID: "sf-senuelo",
  APCA_API_SECRET_KEY: "sf-senuelo",
  APCA_API_BASE_URL: "https://paper-api.alpaca.markets",
  DASHBOARD_USUARIO: "sf-usuario-senuelo",
  DASHBOARD_CONTRASENA: "sf-contrasena-senuelo",
  INVESTIGADOR_TOKEN_SHA256: "0".repeat(64),
  TRADING_PAUSADO: "false",
  APP_ENV: "test",
};

const iniciar = (puerto: number, extra: Record<string, string> = {}) => ({
  command: `npm run start -- -p ${puerto} -H 127.0.0.1`,
  port: puerto, // /api/health da 503 sin base, así que se espera el puerto y no un 2xx
  timeout: 240_000,
  reuseExistingServer: !process.env.CI,
  env: { ...entorno, ...extra },
});

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${PUERTO}` },
  webServer: [
    { ...iniciar(PUERTOS.normal), command: `npm run build && npm run start -- -p ${PUERTOS.normal} -H 127.0.0.1` },
    iniciar(PUERTOS.pausaManual, { TRADING_PAUSADO: "true" }),
    iniciar(PUERTOS.fallaEstado, { SF_FALLA_INYECTADA: "estadoSistema" }),
    iniciar(PUERTOS.fallaInvestigaciones, { SF_FALLA_INYECTADA: "ultimasInvestigaciones" }),
    iniciar(PUERTOS.fallaPropuestas, { SF_FALLA_INYECTADA: "listarPropuestas" }),
    iniciar(PUERTOS.fallaCartera, { SF_FALLA_INYECTADA: "resumenCartera" }),
    iniciar(PUERTOS.fallaMetricas, { SF_FALLA_INYECTADA: "metricas" }),
    iniciar(PUERTOS.fallaEjecuciones, { SF_FALLA_INYECTADA: "listarEjecuciones" }),
    iniciar(PUERTOS.fallaSeriePrecio, { SF_FALLA_INYECTADA: "seriePrecio" }),
    iniciar(PUERTOS.fallaOperacionesPrecio, { SF_FALLA_INYECTADA: "operacionesPrecio" }),
    iniciar(PUERTOS.tope2, { MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: "2" }), // AC-UX-6: S1 frente a un tope de 2
    // Spec 004: los modos se leen al arrancar, así que cada combinación lleva su servidor.
    iniciar(PUERTOS.decisorEjecuta, { MODO_CICLO: "solo_registra", MODO_DECISOR: "ejecuta" }),
    iniciar(PUERTOS.decisorSoloRegistra, { MODO_CICLO: "ejecuta", MODO_DECISOR: "solo_registra" }),
    iniciar(PUERTOS.dosEjecutan, { MODO_CICLO: "ejecuta", MODO_DECISOR: "ejecuta" }),
    iniciar(PUERTOS.decisorSinR11, { MODO_CICLO: "solo_registra", MODO_DECISOR: "ejecuta", MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: "0" }),
    iniciar(PUERTOS.cicloSoloRegistra, { MODO_CICLO: "solo_registra" }),
    iniciar(PUERTOS.modosInvalidos, { MODO_CICLO: "desconocido" }),
    iniciar(PUERTOS.fallaComparacion, { MODO_CICLO: "solo_registra", MODO_DECISOR: "ejecuta", SF_FALLA_INYECTADA: "comparacion" }),
    iniciar(PUERTOS.fallaRanuras, { MODO_CICLO: "solo_registra", MODO_DECISOR: "ejecuta", SF_FALLA_INYECTADA: "listarRanuras" }),
  ],
});
