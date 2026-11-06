import { z } from "zod";
import { ACTIVOS, type Activo } from "./activos";

const esUrlWeb = (s: string) => {
  try {
    const p = new URL(s).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
};

/** Contrato de `POST /api/v1/investigaciones`. Estricto: un campo desconocido invalida la petición. */
export const InvestigacionV1 = z.strictObject({
  clave_idempotencia: z.string().min(1).max(128).regex(/^[A-Za-z0-9:/_.\-]+$/),
  ejecucion_id: z.string().min(1).max(64),
  version_instrucciones: z.string().min(1).max(32),
  activo: z.enum(ACTIVOS),
  sentimiento: z.number().min(-1).max(1),
  noticia_fuerte: z.boolean(),
  confianza: z.number().min(0).max(1),
  resumen: z.string().trim().min(1).max(600),
  fuentes: z.array(z.string().max(500).refine(esUrlWeb, "URL http o https inválida")).max(10),
});
export type InvestigacionV1 = z.infer<typeof InvestigacionV1>;

/** Lo que `seleccionarVigente` necesita de una investigación guardada. */
export type InvestigacionGuardada = {
  id: string;
  activo: string;
  estado: "aceptada" | "rechazada";
  recibidaEn: Date;
};

export const VIGENCIA_MIN = 60;

/**
 * REQ-40: la aceptada más reciente de ese activo, recibida antes de `t` y hace menos de 60 min.
 * Con 60 min exactos ya no se adjunta.
 */
export function seleccionarVigente<I extends InvestigacionGuardada>(
  investigaciones: readonly I[],
  activo: Activo,
  t: Date,
): I | null {
  let mejor: I | null = null;
  for (const i of investigaciones) {
    if (i.estado !== "aceptada" || i.activo !== activo) continue;
    const edadMs = t.getTime() - i.recibidaEn.getTime();
    if (edadMs < 0 || edadMs >= VIGENCIA_MIN * 60_000) continue;
    if (!mejor || i.recibidaEn.getTime() > mejor.recibidaEn.getTime()) mejor = i;
  }
  return mejor;
}
