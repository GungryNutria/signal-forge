import { z } from "zod";

export const esquemaEnv = z.object({
  DATABASE_URL: z.string().min(1),
  APCA_API_KEY_ID: z.string().min(1),
  APCA_API_SECRET_KEY: z.string().min(1),
  // Se valida como URL; que sea la de paper lo comprueban el broker y procesarPropuesta (REQ-15).
  APCA_API_BASE_URL: z.url(),
  DASHBOARD_USUARIO: z.string().min(1),
  DASHBOARD_CONTRASENA: z.string().min(1),
  INVESTIGADOR_TOKEN_SHA256: z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 en hex minúsculas"),
  TRADING_PAUSADO: z.enum(["true", "false"]),
  APP_ENV: z.enum(["produccion", "desarrollo", "test"]),
});

export type Env = z.infer<typeof esquemaEnv>;

/** Valida las variables al arrancar un proceso. El error nombra las variables, nunca sus valores. */
export function cargarEnv(fuente: Record<string, string | undefined> = process.env): Env {
  const r = esquemaEnv.safeParse(fuente);
  if (!r.success) {
    const campos = [...new Set(r.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Variables de entorno inválidas o ausentes: ${campos}`);
  }
  return r.data;
}

/**
 * N de R11 (REQ-8). Ausente o vacío → 1. Inválido → lanza, sin el valor. Fuera de `esquemaEnv` a propósito (RNF-4):
 * un valor mal escrito debe detener solo las entradas, nunca el vigilante, que llama a `cargarEnv`.
 */
export function leerMaxEntradasAbiertas(fuente: Record<string, string | undefined> = process.env): number {
  const v = fuente.MAX_ENTRADAS_ABIERTAS_POR_ACTIVO;
  if (v === undefined || v === "") return 1;
  if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) throw new Error("MAX_ENTRADAS_ABIERTAS_POR_ACTIVO inválida");
  return Number(v);
}
