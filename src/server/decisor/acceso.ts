import { identificarToken } from "@/server/investigaciones/auth";
import { registrarAuthFallida } from "@/server/investigaciones/recibir";
import type { Db } from "@/server/db/cliente";
import { segundosParaPoderEnviar } from "./frecuencia";

export const json = (cuerpo: unknown, status: number, headers?: HeadersInit) =>
  Response.json(cuerpo, { status, headers });

/** Primeros 16 hex del hash del token del decisor: a qué token se entregó un contexto (REQ-9). */
export const huellaToken = (hashDecisor: string | undefined) => (hashDecisor ?? "").slice(0, 16);

/**
 * REQ-1 y RNF-5, en este orden: sin token válido, 401 (solo un evento sin contenido); token del investigador, 403;
 * demasiadas peticiones, 429 con `Retry-After`. `null` = puede seguir.
 */
export async function controlarAcceso(
  request: Request,
  db: Db,
  hashes: { investigador?: string; decisor?: string },
  ahora: Date,
): Promise<Response | null> {
  const rol = identificarToken(request.headers.get("authorization"), hashes);
  if (rol === null) {
    await registrarAuthFallida(db, request);
    return json({ error: "no_autorizado" }, 401);
  }
  if (rol === "investigador") return json({ error: "prohibido" }, 403);
  const espera = await segundosParaPoderEnviar(db, ahora);
  if (espera !== null) return json({ error: "limite_frecuencia" }, 429, { "Retry-After": String(espera) });
  return null;
}
