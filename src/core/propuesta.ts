import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Propuesta de entrada (REQ-8). `activo` y `tipo_orden` aceptan valores que R1 y R10 deben poder rechazar
 * con su regla; `lado` solo buy o sell (un lado inválido es "propuesta inválida", AC-8).
 */
export const PropuestaV1 = z
  .strictObject({
    clave_idempotencia: z.string().min(1).max(128).regex(/^[A-Za-z0-9:/_.\-]+$/),
    activo: z.string().min(1).max(32),
    lado: z.enum(["buy", "sell"]),
    nocional_usd: z.number().positive().finite().nullish(),
    cantidad: z.number().positive().finite().nullish(),
    tipo_orden: z.enum(["mercado", "limite", "stop_limite"]),
    proponente: z.string().min(1).max(64),
    ejecucion_id: z.uuid(),
    version_regla: z.string().min(1).max(64),
    justificacion: z.looseObject({
      entradas: z.record(z.string(), z.unknown()),
      resultado: z.record(z.string(), z.unknown()),
    }),
  })
  .refine((p) => (p.lado === "buy" ? p.nocional_usd != null : p.cantidad != null), {
    message: "una compra lleva nocional_usd y una venta lleva cantidad",
  });
export type PropuestaV1 = z.infer<typeof PropuestaV1>;

/** JSON con las claves ordenadas en todos los niveles: misma información, mismos bytes. */
export function jsonCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valor);
}

/** Huella de contenido (REQ-12): la justificación y la ejecución quedan fuera porque cambian entre reintentos. */
export function huellaPropuesta(p: PropuestaV1): string {
  return createHash("sha256")
    .update(
      jsonCanonico({
        activo: p.activo,
        lado: p.lado,
        nocional_usd: p.nocional_usd ?? null,
        cantidad: p.cantidad ?? null,
        tipo_orden: p.tipo_orden,
        proponente: p.proponente,
        version_regla: p.version_regla,
      }),
    )
    .digest("hex");
}
