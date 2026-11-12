import { ACTIVOS, type Activo } from "@/core/activos";
import type {
  Decision,
  EstadoOperacion,
  FiltroEjecuciones,
  FiltroPropuestas,
  Proponente,
  ResultadoFiltroEjecuciones,
} from "@/server/consultas/tipos";
import { consultaDePrecio } from "./precio";

// Filtros y cursor viajan en la URL (`searchParams`) y se validan aquí: lo que no esté en la lista se ignora.
// Solo tipos de la consulta (sin `server-only`).
export type Params = Record<string, string | string[] | undefined>;

export const PROPONENTES: readonly Proponente[] = ["ciclo", "decisor"];
export const DECISIONES: readonly Decision[] = ["ejecutada", "rechazada", "conflicto", "error"];
export const ESTADOS: readonly EstadoOperacion[] = [
  "pendiente_llenado",
  "abierta",
  "cerrada_tp",
  "cerrada_sl",
  "desconocido",
  "rechazada_broker",
];
export const RESULTADOS: readonly ResultadoFiltroEjecuciones[] = [
  "sin_senal",
  "propuesta",
  "datos_no_disponibles",
  "error",
  "omitida_solapamiento",
];

const uno = (p: Params, k: string): string | undefined => {
  const v = p[k];
  return Array.isArray(v) ? v[0] : v;
};
const en = <T extends string>(lista: readonly T[], v: string | undefined): T | undefined => lista.find((x) => x === v);
const cursorValido = (v: string | undefined) => (v && /^[ad]:[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export type ValoresPropuestas = { proponente?: Proponente; activo?: Activo; decision?: Decision; estado?: EstadoOperacion; cursor?: string };
export function leerPropuestas(p: Params): { filtro: FiltroPropuestas; valores: ValoresPropuestas } {
  const valores: ValoresPropuestas = {
    proponente: en(PROPONENTES, uno(p, "proponente")),
    activo: en(ACTIVOS, uno(p, "activo")),
    decision: en(DECISIONES, uno(p, "decision")),
    estado: en(ESTADOS, uno(p, "estado")),
    cursor: cursorValido(uno(p, "cursor")),
  };
  const { cursor, ...resto } = valores;
  return { filtro: { ...resto, antes: cursor }, valores };
}

export type ValoresEjecuciones = { activo?: Activo; resultado?: ResultadoFiltroEjecuciones; cursor?: string };
export function leerEjecuciones(p: Params): { filtro: FiltroEjecuciones; valores: ValoresEjecuciones } {
  const valores: ValoresEjecuciones = {
    activo: en(ACTIVOS, uno(p, "activo")),
    resultado: en(RESULTADOS, uno(p, "resultado")),
    cursor: cursorValido(uno(p, "cursor")),
  };
  const { cursor, ...resto } = valores;
  return { filtro: { ...resto, antes: cursor }, valores };
}

export const leerActivo = (p: Params): Activo | undefined => en(ACTIVOS, uno(p, "activo"));

/** `?activo=BTC%2FUSD&cursor=…` o `""` si no hay nada. */
export function consulta(valores: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(valores)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Los filtros y la posición de la lista que se dejó, tomados de `?v=` y revalidados (nunca se refleja texto libre). */
export function volverAPropuestas(v: string | undefined): string {
  return consulta(leerPropuestas(Object.fromEntries(new URLSearchParams(v ?? ""))).valores);
}
export function volverAEjecuciones(v: string | undefined): string {
  return consulta(leerEjecuciones(Object.fromEntries(new URLSearchParams(v ?? ""))).valores);
}
export const paramV = (p: Params): string | undefined => uno(p, "v");
/** De dónde se llegó al detalle de una propuesta: solo "ejecuciones" cambia el enlace de regreso. */
export const vienedeEjecuciones = (p: Params): boolean => uno(p, "de") === "ejecuciones";
/** `?activo=…&rango=…&op=…` de la gráfica que se dejó, tomado de `?v=` y revalidado con `leerPrecio`. */
export const volverAPrecio = (v: string | undefined): string => consultaDePrecio(v);
/** Con `de=precio` el "← Volver" del detalle regresa a S6. */
export const vienedePrecio = (p: Params): boolean => uno(p, "de") === "precio";
