import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

// Ayudas de las specs de UI. Sin dependencias de Playwright: la config también importa los puertos.

export const PUERTOS = {
  normal: 3192,
  pausaManual: 3193,
  fallaEstado: 3194,
  fallaInvestigaciones: 3195,
  fallaPropuestas: 3196,
  fallaCartera: 3197,
} as const;

export const BASE = process.env.E2E_DATABASE_URL;
export const SIN_BASE = "Las specs de UI necesitan E2E_DATABASE_URL (base con 'test' o 'e2e' en el nombre).";
export const CREDENCIALES = { username: "sf-usuario-senuelo", password: "sf-contrasena-senuelo" };
export const url = (puerto: number) => `http://127.0.0.1:${puerto}`;

/** Recrea el esquema de la base de E2E y siembra un escenario de `scripts/sembrar.ts` (horas relativas a ahora). */
export function sembrar(escenario: string): void {
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/sembrar.ts", escenario, "--reiniciar"], {
    env: { ...process.env, APP_ENV: "test", DATABASE_URL: BASE },
    stdio: "pipe",
  });
}

/** Agrega una ejecución más reciente que las del escenario (para probar que la banda muestra sus resultados). */
export async function agregarEjecucion(estado: "completada" | "error" | "omitida_solapamiento" | null, hace: number) {
  const pool = new Pool({ connectionString: BASE, max: 1 });
  try {
    const id = randomUUID();
    const inicio = new Date(Date.now() - hace * 60_000);
    const ranura = new Date(Math.floor(inicio.getTime() / 1_800_000) * 1_800_000);
    await pool.query("INSERT INTO ejecuciones (id, ranura, inicio, version_regla) VALUES ($1, $2, $3, 'tendencia-sma-v1')", [
      id,
      ranura,
      inicio,
    ]);
    if (estado !== null) {
      await pool.query("INSERT INTO ejecuciones_cierre (ejecucion_id, fin, estado, error) VALUES ($1, $2, $3, $4)", [
        id,
        new Date(inicio.getTime() + 20_000),
        estado,
        estado === "error" ? "plazo interno de 120 s agotado" : null,
      ]);
    }
  } finally {
    await pool.end();
  }
}

export const MEDIDAS = [
  { ancho: 1280, alto: 800 },
  { ancho: 390, alto: 844 },
  { ancho: 360, alto: 800 },
] as const;

/** Con CAPTURAS=<carpeta> guarda la página completa (solo se piden a 1280 y 390). */
export async function capturar(page: import("@playwright/test").Page, ancho: number, nombre: string) {
  const carpeta = process.env.CAPTURAS;
  if (!carpeta || ancho === 360) return;
  await page.screenshot({ path: `${carpeta}/${nombre}_${ancho}.png`, fullPage: true });
}
