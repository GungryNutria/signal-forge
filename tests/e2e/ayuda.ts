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
  fallaMetricas: 3198,
  fallaEjecuciones: 3199,
  fallaSeriePrecio: 3200,
  fallaOperacionesPrecio: 3201,
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

/**
 * AC-UX-8 y AC-UX-31: con la red limitada ("3G lento"), mientras hay marcadores de carga ningún bloque muestra cifras.
 * Devuelve cuántas veces se vio un marcador (debe ser al menos una).
 */
export async function vigilarCarga(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext, ruta: string) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 });
  const dinero = /\d[\d,]*\.\d{2}\s*USD|\d\s*%|\b0\.00\b/;
  const textosConDato: string[] = [];
  let visto = 0;
  const navegacion = page.goto(ruta, { waitUntil: "commit" });
  const fin = Date.now() + 20_000;
  while (Date.now() < fin) {
    const l = await page
      .evaluate(() => ({
        esqueletos: document.querySelectorAll("[data-cargando]").length,
        textos: [...document.querySelectorAll("[aria-busy='true']")].map((e) => (e as HTMLElement).innerText),
      }))
      .catch(() => null);
    if (l && l.esqueletos > 0) {
      visto++;
      for (const t of l.textos) if (dinero.test(t)) textosConDato.push(t);
    }
    if (l && l.esqueletos === 0 && visto > 0) break;
    await page.waitForTimeout(100);
  }
  await navegacion;
  return { visto, textosConDato };
}

/**
 * `PRECIO_CONOCIDO` de `scripts/sembrar.ts` (spec 002). Playwright carga los tests como CommonJS y el script usa
 * `import.meta`, así que se lee con tsx y se devuelve como JSON: constantes y los puntos de BTC/USD de `precio-serie`.
 */
export function precioConocido(): {
  puntosBtc: { t: string; cierre: string; sma20: string; cierrePrevio: string; resultado: string; hueco: boolean }[];
  sl: { precio: number; salida: number };
  tp: { precio: number; salida: number };
  abierta: { precio: number; niveles: { stopLoss: number; takeProfit: number }; regla: { close_ultimo: number; close_previo: number; sma20: number } };
  desdeS3: { precio: number; entradaHace: number; rango: string; abierta: boolean }[];
  abiertas: { precio: number[]; entradaHace: number[] };
} {
  const codigo = `import { PRECIO_CONOCIDO as K } from "./scripts/sembrar";
const n = (f: (i: number) => number) => Array.from({ length: 10 }, (_, i) => f(i));
console.log(JSON.stringify({ puntosBtc: K.puntosBtc(new Date()), sl: K.sl, tp: K.tp, abierta: K.abierta, desdeS3: K.desdeS3, abiertas: { precio: n(K.abiertas.precio), entradaHace: n(K.abiertas.entradaHace) } }));`;
  const salida = execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--eval", codigo], { env: { ...process.env, APP_ENV: "test" }, encoding: "utf8" });
  return JSON.parse(salida.trim().split("\n").at(-1) as string);
}
