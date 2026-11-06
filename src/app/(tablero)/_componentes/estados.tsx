import type { Decision, EstadoEjecucion, EstadoOperacion, ResultadoActivo } from "@/server/consultas/tipos";
import { Chip, type Tono } from "./chip";

// Vocabulario fijo de la spec (Criterios de UX): se escribe palabra por palabra, igual en todas las superficies.

const DECISION: Record<Decision, { texto: string; tono: Tono }> = {
  ejecutada: { texto: "Ejecutada", tono: "solido" },
  rechazada: { texto: "Rechazada", tono: "neutro" },
  conflicto: { texto: "Conflicto", tono: "warn" },
  error: { texto: "Error", tono: "neg" },
};

const OPERACION: Record<EstadoOperacion, { texto: string; tono: Tono }> = {
  pendiente_llenado: { texto: "Pendiente de llenado", tono: "neutro" },
  abierta: { texto: "Abierta", tono: "info" },
  cerrada_tp: { texto: "Cerrada por take profit", tono: "pos" },
  cerrada_sl: { texto: "Cerrada por stop loss", tono: "neg" },
  desconocido: { texto: "Estado desconocido", tono: "warn" },
  rechazada_broker: { texto: "Rechazada por el broker", tono: "warn" },
};

export const ChipDecision = ({ decision }: { decision: Decision }) => (
  <Chip tono={DECISION[decision].tono}>{DECISION[decision].texto}</Chip>
);

export const ChipOperacion = ({ estado }: { estado: EstadoOperacion }) => (
  <Chip tono={OPERACION[estado].tono}>{OPERACION[estado].texto}</Chip>
);

/** Resultado de un activo en una ejecución (REQ-37). "Sin señal" es neutro: no es error ni alerta. */
export function ChipResultado({ r }: { r: ResultadoActivo | null }) {
  if (r === null) return <Chip>En curso</Chip>;
  switch (r.resultado) {
    case "sin_senal":
      return <Chip>Sin señal</Chip>;
    case "propuesta": {
      const d = r.decision ? DECISION[r.decision] : null;
      return <Chip tono={d && d.tono !== "solido" ? d.tono : "neutro"}>Propuesta{d ? `: ${d.texto}` : ""}</Chip>;
    }
    case "datos_no_disponibles":
      return <Chip tono="warn">Datos no disponibles</Chip>;
    case "error":
      return <Chip tono="neg">Error</Chip>;
  }
}

export const ChipOmitida = () => <Chip>Omitida por solapamiento</Chip>;

/** Texto plano del resultado, para frases ("Sin señal en BTC/USD y SOL/USD"). */
export function textoResultado(r: ResultadoActivo | null): string {
  if (r === null) return "En curso";
  switch (r.resultado) {
    case "sin_senal":
      return "Sin señal";
    case "propuesta":
      return `Propuesta${r.decision ? `: ${DECISION[r.decision].texto}` : ""}`;
    case "datos_no_disponibles":
      return "Datos no disponibles";
    case "error":
      return "Error";
  }
}

export const esOmitida = (estado: EstadoEjecucion) => estado === "omitida_solapamiento";
