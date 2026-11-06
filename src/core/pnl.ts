import { aCentavos } from "./dinero";

// Comisión modelada de 25 bps por lado, siempre (D-3, ADR 0011).
export const COMISION_BPS = 25;
const FACTOR_COMISION = 1 - COMISION_BPS / 10_000;
const INCREMENTO = 1e9; // min_trade_increment 0.000000001 (T-2)

export const STOP_LOSS_FACTOR = 0.98;
export const TAKE_PROFIT_FACTOR = 1.04;

export type MotivoCierre = "take_profit" | "stop_loss";

/** Cantidad de la que se dispone al vender: lo llenado menos la comisión en especie, hacia abajo al incremento. */
export function cantidadNeta(filledQty: number): number {
  return Math.floor(filledQty * FACTOR_COMISION * INCREMENTO + 1e-7) / INCREMENTO;
}

export function nivelesLote(precioEntrada: number): { stopLoss: number; takeProfit: number } {
  return { stopLoss: precioEntrada * STOP_LOSS_FACTOR, takeProfit: precioEntrada * TAKE_PROFIT_FACTOR };
}

/** PnL neto en centavos de vender `cantidadNeta` a `precioSalida`, con la comisión de salida modelada. */
export function pnlNetoCentavos(nocionalEntradaC: number, cantidadNeta: number, precioSalida: number): number {
  return aCentavos(cantidadNeta * precioSalida * FACTOR_COMISION) - nocionalEntradaC;
}

export type CierreCalculado = {
  motivo: MotivoCierre;
  pnlNetoC: number;
  pnlNetoPct: number;
  duracionS: number;
  etiquetaExito: 0 | 1;
};

/** Etiqueta del lote al cerrar (REQ-25): 1 solo si el PnL neto es mayor que 0, aunque el motivo sea take_profit. */
export function cerrarLote(l: {
  nocionalEntradaC: number;
  cantidadNeta: number;
  precioSalida: number;
  motivo: MotivoCierre;
  abiertoEn: Date;
  cerradoEn: Date;
}): CierreCalculado {
  const pnlNetoC = pnlNetoCentavos(l.nocionalEntradaC, l.cantidadNeta, l.precioSalida);
  return {
    motivo: l.motivo,
    pnlNetoC,
    pnlNetoPct: pnlNetoC / l.nocionalEntradaC,
    duracionS: Math.round((l.cerradoEn.getTime() - l.abiertoEn.getTime()) / 1000),
    etiquetaExito: pnlNetoC > 0 ? 1 : 0,
  };
}
