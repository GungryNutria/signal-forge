import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { urlDePrueba } from "./arnes";

// Valores señuelo: ninguno es un secreto real.
export const SENUELO = {
  token: `sfi_${"T".repeat(43)}`,
  usuario: "sf-usuario-senuelo",
  contrasena: "sf-contrasena-senuelo",
};

export type Servidor = { base: string; detener: () => void };

/** Arranca `next start` (requiere `npm run build` previo) con env señuelo y la base de prueba. */
export async function arrancarServidor(puerto: number, tokenSha256: string): Promise<Servidor> {
  if (!existsSync(".next/BUILD_ID")) throw new Error("Falta .next: corre `npm run build` antes");
  const hijo: ChildProcess = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(puerto), "-H", "127.0.0.1"],
    {
      env: {
        ...process.env,
        DATABASE_URL: urlDePrueba(),
        APCA_API_KEY_ID: "sf-senuelo",
        APCA_API_SECRET_KEY: "sf-senuelo",
        APCA_API_BASE_URL: "https://paper-api.alpaca.markets",
        DASHBOARD_USUARIO: SENUELO.usuario,
        DASHBOARD_CONTRASENA: SENUELO.contrasena,
        INVESTIGADOR_TOKEN_SHA256: tokenSha256,
        TRADING_PAUSADO: "false",
        APP_ENV: "test",
      },
      stdio: "ignore",
    },
  );
  const base = `http://127.0.0.1:${puerto}`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/api/health`);
      return { base, detener: () => hijo.kill() };
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  hijo.kill();
  throw new Error("El servidor no arrancó");
}
