import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirPool, reiniciarBase } from "./arnes";
import { sembrarCierre } from "./ayudas";

// AC-13 y AC-14 (REQ-14, REQ-15): v_cierres descompone el PnL neto en movimiento hasta el nivel, deslizamiento y comisión.
// Lote común: P = 100000, q = 0.005, qn = 0.0049875, stop 98000, take profit 104000.
let pool: Pool;
const cierre = async (loteId: string) => (await pool.query("SELECT * FROM v_cierres WHERE lote_id = $1", [loteId])).rows[0];
const t = new Date("2026-11-06T12:00:00Z");

beforeAll(async () => {
  await reiniciarBase();
  pool = abrirPool(2);
});
afterAll(() => pool.end());

/** Comisión según la fórmula del plan: lo que no se vendió de la entrada en especie más la salida modelada. */
const comisionTeorica = (precioSalida: number) => (0.005 - 0.0049875) * 100_000 + 0.0049875 * precioSalida * 0.0025;

describe("v_cierres (AC-13)", () => {
  it("stop con deslizamiento: nivel, disparo, movimiento, deslizamiento y comisión suman el PnL neto exacto", async () => {
    // Llenado a 97500 con el stop en 98000: pnl = round(0.0049875 x 97500 x 0.9975, 2) - 500 = -14.93.
    const { loteId } = await sembrarCierre(pool, {
      n: 1, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93, disparo: { precio: 97_990, ts: t },
    });
    const c = await cierre(loteId);
    expect(c).toMatchObject({
      activo: "BTC/USD", motivo_cierre: "stop_loss", nivel: "stop_loss", comision_bps: 25,
      movimiento_usd: "-9.98", deslizamiento_usd: "-2.49", deslizamiento_pct: "-0.005102", comision_usd: "-2.46",
    });
    expect(Number(c.precio_disparo)).toBe(97_990);
    expect(c.precio_disparo_ts).toEqual(t);
    expect(Number(c.movimiento_usd) + Number(c.deslizamiento_usd) + Number(c.comision_usd)).toBeCloseTo(-14.93, 10);
    expect(Math.abs(Number(c.comision_usd) + comisionTeorica(97_500))).toBeLessThanOrEqual(0.02);
  });

  it("take profit en el nivel: deslizamiento 0 y toda la diferencia es movimiento menos comisión", async () => {
    const { loteId } = await sembrarCierre(pool, { n: 2, motivo: "take_profit", precioSalida: 104_000, pnlNetoUsd: 17.4 });
    const c = await cierre(loteId);
    expect(c).toMatchObject({ nivel: "take_profit", movimiento_usd: "19.95", deslizamiento_usd: "0.00", deslizamiento_pct: "0.000000", comision_usd: "-2.55" });
    expect(Math.abs(Number(c.comision_usd) + comisionTeorica(104_000))).toBeLessThanOrEqual(0.02);
  });

  it("take profit llenado por encima del nivel: deslizamiento positivo", async () => {
    const { loteId } = await sembrarCierre(pool, { n: 3, motivo: "take_profit", precioSalida: 104_500, pnlNetoUsd: 19.89 });
    const c = await cierre(loteId);
    expect(c).toMatchObject({ movimiento_usd: "19.95", deslizamiento_usd: "2.49", deslizamiento_pct: "0.004808", comision_usd: "-2.55" });
    expect(Number(c.movimiento_usd) + Number(c.deslizamiento_usd) + Number(c.comision_usd)).toBeCloseTo(19.89, 10);
  });
});

describe("cierres anteriores a la medición (AC-14, REQ-15)", () => {
  it("sin precio_disparo: calcula el deslizamiento con los datos inmutables y deja el disparo en NULL", async () => {
    const { loteId } = await sembrarCierre(pool, { n: 4, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93 });
    const c = await cierre(loteId);
    expect(c.precio_disparo).toBeNull();
    expect(c.precio_disparo_ts).toBeNull();
    expect(c).toMatchObject({ deslizamiento_usd: "-2.49", deslizamiento_pct: "-0.005102", comision_usd: "-2.46" });
  });

  it("consultar la vista no modifica ningún registro", async () => {
    const antes = (await pool.query("SELECT count(*)::int AS n FROM cierres_lote")).rows[0].n;
    const filas = (await pool.query("SELECT * FROM v_cierres")).rows;
    expect(filas).toHaveLength(antes);
    expect((await pool.query("SELECT count(*)::int AS n FROM cierres_lote")).rows[0].n).toBe(antes);
  });
});
