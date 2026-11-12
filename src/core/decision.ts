import { createHash } from "node:crypto";
import { z } from "zod";
import { ACTIVOS, type Activo } from "./activos";
import { jsonCanonico, type PropuestaV1 } from "./propuesta";
import { TENDENCIA_SMA_V1 } from "./regla/tendencia-sma-v1";

/** Contrato de `POST /api/v1/decisor/decisiones` (REQ-7, REQ-12). Estricto: no hay campo para tamaño, lado, tipo ni niveles. */
export const DecisionV1 = z.strictObject({
  clave_idempotencia: z.string().min(1).max(128).regex(/^[A-Za-z0-9:/_.\-]+$/),
  ejecucion_id: z.string().min(1).max(64),
  version_instrucciones: z.string().max(64).regex(/^decisor-v\d+@[A-Za-z0-9._\-]{1,48}$/),
  contexto_id: z.uuid(),
  activo: z.enum(ACTIVOS),
  decision: z.enum(["comprar", "no_comprar"]),
  confianza: z.number().finite().min(0).max(1),
  razonamiento: z.string().trim().min(1).max(2000),
});
export type DecisionV1 = z.infer<typeof DecisionV1>;

/** Huella de contenido (REQ-8): SHA-256 del JSON canónico de todos los campos menos la clave. */
export function huellaDecision(d: DecisionV1): string {
  const resto: Record<string, unknown> = { ...d };
  delete resto.clave_idempotencia;
  return createHash("sha256").update(jsonCanonico(resto)).digest("hex");
}

/**
 * La única forma de convertir una decisión `comprar` en propuesta (REQ-10, REQ-12): tamaño, lado y tipo salen de la
 * regla fija, nunca de lo que dijo el decisor. La clave depende de la ranura y del activo, así que un reenvío es el
 * mismo reintento para el camino común.
 */
export function propuestaDe(d: {
  id: string;
  ranura: Date;
  activo: Activo;
  versionInstrucciones: string;
  contextoId: string;
  confianza: number;
}): PropuestaV1 {
  return {
    clave_idempotencia: `decisor:${d.ranura.toISOString().replace(".000Z", "Z")}:${d.activo}`,
    activo: d.activo,
    lado: "buy",
    nocional_usd: TENDENCIA_SMA_V1.nocionalUsd,
    tipo_orden: TENDENCIA_SMA_V1.tipoOrden,
    proponente: "decisor",
    ejecucion_id: d.id,
    version_regla: d.versionInstrucciones,
    justificacion: {
      entradas: { decision_id: d.id, contexto_id: d.contextoId },
      resultado: { decision: "comprar", confianza: d.confianza },
    },
  };
}
