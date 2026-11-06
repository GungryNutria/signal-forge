import { describe, expect, it } from "vitest";
import { cantidadNeta, cerrarLote, nivelesLote, pnlNetoCentavos } from "./pnl";

const abiertoEn = new Date("2026-11-06T18:00:00Z");
const cerradoEn = new Date("2026-11-06T19:30:00Z");

// Lote de 500 USD abierto a P = 100.
const P = 100;
const lote = { nocionalEntradaC: 50000, cantidadNeta: cantidadNeta(500 / P), abiertoEn, cerradoEn };

describe("pnl", () => {
  it("niveles de salida: SL P×0.98 y TP P×1.04", () => {
    const n = nivelesLote(P);
    expect(n.stopLoss).toBeCloseTo(98);
    expect(n.takeProfit).toBeCloseTo(104);
  });

  it("cantidad neta: -25 bps, hacia abajo al incremento (caso real de T-2)", () => {
    expect(cantidadNeta(0.000129377)).toBe(0.000129053);
    expect(cantidadNeta(5)).toBe(4.9875);
  });

  it("AC-19: take profit exacto da +17.40 USD y etiqueta 1", () => {
    const c = cerrarLote({ ...lote, precioSalida: 104, motivo: "take_profit" });
    expect(c).toMatchObject({ motivo: "take_profit", pnlNetoC: 1740, etiquetaExito: 1, duracionS: 5400 });
    expect(c.pnlNetoPct).toBeCloseTo(0.0348, 4);
  });

  it("AC-19: stop exacto da pérdida y etiqueta 0", () => {
    const c = cerrarLote({ ...lote, precioSalida: 98, motivo: "stop_loss" });
    expect(c.pnlNetoC).toBe(-1245);
    expect(c.pnlNetoPct).toBeCloseTo(-0.0249, 3);
    expect(c.etiquetaExito).toBe(0);
  });

  it("AC-19: un take profit con deslizamiento extremo da PnL <= 0 y etiqueta 0", () => {
    const c = cerrarLote({ ...lote, precioSalida: 100.2, motivo: "take_profit" });
    expect(c.pnlNetoC).toBeLessThanOrEqual(0);
    expect(c.etiquetaExito).toBe(0);
  });

  it("el no realizado usa la misma fórmula", () => {
    expect(pnlNetoCentavos(50000, lote.cantidadNeta, 104)).toBe(1740);
  });
});
