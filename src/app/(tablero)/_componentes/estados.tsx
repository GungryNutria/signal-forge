import type { Decision, EstadoEjecucion, EstadoOperacion, EstadoRanura, ResultadoActivo, ResultadoDecisorActivo } from "@/server/consultas/tipos";
import { motivoDecision, nombreCorto } from "../_lib/formato";
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

/** "Rechazada (R11 entradas abiertas)": junto a la decisión, la regla principal con su nombre corto (AC-UX-5). */
const decisionConRegla = (r: ResultadoActivo, texto: string): string =>
  r.decision === "rechazada" && r.reglaPrincipal ? `${texto} (${nombreCorto(r.reglaPrincipal)})` : texto;

/** Resultado de un activo en una ejecución (REQ-37). "Sin señal" es neutro: no es error ni alerta. */
export function ChipResultado({ r }: { r: ResultadoActivo | null }) {
  if (r === null) return <Chip>En curso</Chip>;
  switch (r.resultado) {
    case "sin_senal":
      return <Chip>Sin señal</Chip>;
    case "propuesta": {
      const d = r.decision ? DECISION[r.decision] : null;
      return <Chip tono={d && d.tono !== "solido" ? d.tono : "neutro"}>Propuesta{d ? `: ${decisionConRegla(r, d.texto)}` : ""}</Chip>;
    }
    case "datos_no_disponibles":
      return <Chip tono="warn">Datos no disponibles</Chip>;
    case "error":
      return <Chip tono="neg">Error</Chip>;
    case "senal_registrada":
      return <Chip>Señal (solo registro)</Chip>;
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
      return `Propuesta${r.decision ? `: ${decisionConRegla(r, DECISION[r.decision].texto)}` : ""}`;
    case "datos_no_disponibles":
      return "Datos no disponibles";
    case "error":
      return "Error";
    case "senal_registrada":
      return "Señal (solo registro)";
  }
}

export const textoOperacion = (e: EstadoOperacion): string => OPERACION[e].texto;

export const esOmitida =(estado: EstadoEjecucion) => estado === "omitida_solapamiento";

const RANURA: Record<EstadoRanura, { texto: string; tono: Tono }> = {
  completa: { texto: "Completa", tono: "neutro" },
  parcial: { texto: "Parcial", tono: "warn" },
  invalida: { texto: "Inválida", tono: "warn" },
  sin_llegar: { texto: "Sin llegar", tono: "warn" },
  apagado: { texto: "Apagado", tono: "neutro" },
};
export const ChipRanura = ({ estado }: { estado: EstadoRanura }) => <Chip tono={RANURA[estado].tono}>{RANURA[estado].texto}</Chip>;

/** Resultado de un activo en una ranura del decisor (REQ-26): "No comprar" es neutro, nunca error ni alerta. */
function vistaDecisor(r: ResultadoDecisorActivo): { texto: string; tono: Tono } {
  switch (r.tipo) {
    case "comprar": {
      if (r.propuesta === null) return { texto: "Comprar (solo registro)", tono: "neutro" };
      const d = DECISION[r.propuesta.decision];
      const regla = r.propuesta.reglaPrincipal ? ` (${nombreCorto(r.propuesta.reglaPrincipal)})` : "";
      return { texto: `Comprar: ${d.texto}${r.propuesta.decision === "rechazada" ? regla : ""}`, tono: d.tono };
    }
    case "comprar_rechazada":
      return { texto: `Comprar: Rechazada (${motivoDecision(r.motivo)})`, tono: "neutro" };
    case "no_comprar":
      return { texto: "No comprar", tono: "neutro" };
    case "invalida":
      return { texto: `Inválida (${motivoDecision(r.motivo)})`, tono: "warn" };
    case "sin_decision":
      return { texto: "Sin decisión", tono: "neutro" };
  }
}
/** Texto plano del resultado de una ranura, para nombres accesibles. */
export const textoResultadoDecisor = (r: ResultadoDecisorActivo): string => vistaDecisor(r).texto;
export function ChipResultadoDecisor({ r }: { r: ResultadoDecisorActivo }) {
  const v = vistaDecisor(r);
  return <Chip tono={v.tono}>{v.texto}</Chip>;
}
