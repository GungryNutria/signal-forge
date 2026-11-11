import { ACTIVOS, esActivo } from "./activos";
import { aCentavos, deCentavos, excedePorcentaje } from "./dinero";
import { pnlNetoCentavos } from "./pnl";
import type { PropuestaV1 } from "./propuesta";

/** Estado de la cartera que arma `server/cartera.ts`. Importes en centavos enteros. */
export type EstadoCartera = {
  saldoVirtualC: number;
  exposicionCostoC: number;
  saldoLibreC: number;
  cantidadPorActivo: Readonly<Record<string, number>>;
  entradasHoy: number;
  pausaAutomatica: boolean;
  pausaManual: boolean;
  ordenesDesconocidas: Readonly<Record<string, number>>;
  /** REQ-2: lotes abiertos más entradas vivas sin lote, por activo. */
  entradasAbiertasPorActivo: Readonly<Record<string, number>>;
};

export type IdRegla = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11";

export type ResultadoRegla = {
  regla: IdRegla;
  aplica: boolean;
  cumple: boolean;
  observado: string;
  limite: string;
};

export const MAX_ENTRADAS_DIA = 48;
export const PCT_MAX_OPERACION = 10;
export const PCT_MAX_EXPOSICION = 50;
export const PCT_PAUSA_DIARIA = 3;

const usd = (c: number) => `${deCentavos(c)} USD`;
const activa = (b: boolean) => (b ? "activa" : "inactiva");

/**
 * R1 a R11 de REQ-9 y de la spec 003. Pura y determinista (RNF-2): siempre devuelve las once, con `aplica: false`
 * en las que no corresponden al lado de la propuesta. Aprueba si todas cumplen.
 */
export function evaluarRiesgo(
  p: PropuestaV1,
  e: EstadoCartera,
  config: { maxEntradasAbiertasPorActivo: number },
): { aprobada: boolean; reglas: ResultadoRegla[] } {
  const compra = p.lado === "buy";
  const nocionalC = aCentavos(p.nocional_usd ?? 0);
  const cantidad = p.cantidad ?? 0;
  const enPosicion = e.cantidadPorActivo[p.activo] ?? 0;
  const desconocidas = e.ordenesDesconocidas[p.activo] ?? 0;
  const abiertas = e.entradasAbiertasPorActivo[p.activo] ?? 0;
  const maxAbiertas = config.maxEntradasAbiertasPorActivo;
  const topeOperacionC = Math.floor((e.saldoVirtualC * PCT_MAX_OPERACION) / 100);
  const topeExposicionC = Math.floor((e.saldoVirtualC * PCT_MAX_EXPOSICION) / 100);

  const regla = (id: IdRegla, aplica: boolean, falla: boolean, observado: string, limite: string): ResultadoRegla => ({
    regla: id,
    aplica,
    cumple: !aplica || !falla,
    observado,
    limite,
  });

  const reglas = [
    regla("R1", true, !esActivo(p.activo), p.activo, ACTIVOS.join(", ")),
    regla("R2", !compra, cantidad > enPosicion, String(cantidad), `${enPosicion} en posición`),
    regla("R3", compra, excedePorcentaje(nocionalC, e.saldoVirtualC, PCT_MAX_OPERACION), usd(nocionalC), usd(topeOperacionC)),
    regla(
      "R4",
      compra,
      excedePorcentaje(e.exposicionCostoC + nocionalC, e.saldoVirtualC, PCT_MAX_EXPOSICION),
      usd(e.exposicionCostoC + nocionalC),
      usd(topeExposicionC),
    ),
    regla("R5", compra, e.entradasHoy + 1 > MAX_ENTRADAS_DIA, String(e.entradasHoy + 1), String(MAX_ENTRADAS_DIA)),
    regla("R6", compra, e.pausaAutomatica, activa(e.pausaAutomatica), "inactiva"),
    regla("R7", compra, nocionalC > e.saldoLibreC, usd(nocionalC), usd(e.saldoLibreC)),
    regla("R8", true, e.pausaManual, activa(e.pausaManual), "inactiva"),
    regla("R9", true, desconocidas > 0, String(desconocidas), "0"),
    regla("R10", true, p.tipo_orden !== "mercado", p.tipo_orden, "mercado"),
    regla("R11", compra, abiertas + 1 > maxAbiertas, String(abiertas + 1), String(maxAbiertas)),
  ];
  return { aprobada: reglas.every((r) => r.cumple), reglas };
}

export type LoteAbiertoPnl = { activo: string; nocionalEntradaC: number; cantidadNeta: number };

/**
 * D-6: PnL del día = realizado del día + no realizado neto de los lotes abiertos, a precio bid y con la
 * comisión de salida modelada. Si falta el bid de algún activo con lotes, usa solo lo realizado y lo avisa.
 */
export function pnlDia(
  realizadoHoyC: number,
  lotes: readonly LoteAbiertoPnl[],
  bid: Readonly<Record<string, number | null | undefined>>,
): { pnlC: number; noRealizadoFaltante: boolean } {
  let noRealizadoC = 0;
  for (const l of lotes) {
    const b = bid[l.activo];
    if (b == null) return { pnlC: realizadoHoyC, noRealizadoFaltante: true };
    noRealizadoC += pnlNetoCentavos(l.nocionalEntradaC, l.cantidadNeta, b);
  }
  return { pnlC: realizadoHoyC + noRealizadoC, noRealizadoFaltante: false };
}

/** REQ-31: pausa si el PnL del día llega a -3 % o menos del saldo al inicio del día. */
export function debePausar(pnlDiaC: number, saldoInicioDiaC: number): boolean {
  return pnlDiaC * 100 <= -PCT_PAUSA_DIARIA * saldoInicioDiaC;
}
