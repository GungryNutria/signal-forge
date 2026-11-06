import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inicioDiaUtc } from "@/core/tiempo";
import { metricas } from "@/server/consultas/metricas";
import { METRICAS_CONOCIDAS as M, sembrar } from "../../scripts/sembrar";
import { abrirPool, urlDePrueba, vaciarBase } from "./arnes";

// AC-22: la curva, el drawdown, el PnL diario y acumulado, la tasa de aciertos y aprobadas/rechazadas por motivo
// coinciden con los valores calculados a mano del escenario `metricas-conocidas` (ver METRICAS_CONOCIDAS).

const AHORA = new Date();
const enDia = (dias: number, hora: number) =>
  new Date(inicioDiaUtc(AHORA).getTime() - dias * 24 * 3_600_000 + hora * 3_600_000).toISOString();
const dia = (dias: number) => enDia(dias, 0).slice(0, 10);

let pool: Pool;
beforeAll(() => {
  process.env.DATABASE_URL = urlDePrueba();
  process.env.APP_ENV = "test";
  pool = abrirPool(3);
});
afterAll(() => pool.end());

describe("metricas()", () => {
  it("base vacía: sin datos suficientes, nunca ceros disfrazados", async () => {
    await vaciarBase();
    const m = await metricas();
    expect(m).toEqual({
      curvaSaldo: [],
      drawdownMax: null,
      pnlDiario: [],
      pnlAcumuladoUsd: "0.00",
      tasaAciertos: null,
      porMotivo: [],
      aprobadas: 0,
      rechazadas: 0,
    });
  });

  describe("metricas-conocidas", () => {
    beforeAll(async () => {
      await vaciarBase();
      await sembrar(pool, "metricas-conocidas", AHORA);
    });

    it("curva de saldo realizado y drawdown máximo (globales)", async () => {
      const m = await metricas();
      expect(m.curvaSaldo.map((c) => c.saldoUsd)).toEqual([...M.curva]);
      expect(m.curvaSaldo.map((c) => c.t)).toEqual(M.cierres.map((c) => enDia(c.dias, c.hora)));
      expect(m.drawdownMax).toEqual({
        pct: M.drawdown.pct,
        desde: enDia(M.drawdown.desde.dias, M.drawdown.desde.hora),
        hasta: enDia(M.drawdown.hasta.dias, M.drawdown.hasta.hora),
      });
    });

    it("PnL diario por día UTC, acumulado, tasa de aciertos y motivos (todos los activos)", async () => {
      const m = await metricas();
      expect(m.pnlDiario).toEqual(M.pnlDiarioGlobal.map((d) => ({ diaUtc: dia(d.dias), pnlUsd: d.pnl })));
      expect(m.pnlAcumuladoUsd).toBe(M.global.pnlAcumulado);
      expect(m.tasaAciertos).toEqual({ pct: M.global.pct, aciertos: M.global.aciertos, cerradas: M.global.cerradas });
      expect(m.aprobadas).toBe(M.global.aprobadas);
      expect(m.rechazadas).toBe(M.global.rechazadas);
      const orden = (a: { motivo: string }, b: { motivo: string }) => a.motivo.localeCompare(b.motivo);
      expect([...m.porMotivo].sort(orden)).toEqual([...M.porMotivoGlobal].sort(orden));
    });

    it.each(["BTC/USD", "SOL/USD"] as const)("el filtro de %s acota todo menos la curva y el drawdown", async (activo) => {
      const esperado = M[activo];
      const global = await metricas();
      const m = await metricas({ activo });
      expect(m.curvaSaldo).toEqual(global.curvaSaldo);
      expect(m.drawdownMax).toEqual(global.drawdownMax);
      expect(m.pnlDiario).toEqual(esperado.pnlDiario.map((d) => ({ diaUtc: dia(d.dias), pnlUsd: d.pnl })));
      expect(m.pnlAcumuladoUsd).toBe(esperado.pnlAcumulado);
      expect(m.tasaAciertos).toEqual({ pct: esperado.pct, aciertos: esperado.aciertos, cerradas: esperado.cerradas });
      expect(m.aprobadas).toBe(esperado.aprobadas);
      expect(m.rechazadas).toBe(esperado.rechazadas);
    });

    it("el motivo de un rechazo es su primera regla incumplida", async () => {
      const m = await metricas({ activo: "BTC/USD" });
      expect(m.porMotivo).toEqual([{ motivo: "R3", n: 2 }]);
    });
  });

  it("con un pico y una caída posterior hay drawdown", async () => {
    await vaciarBase();
    await sembrar(pool, "ejecutada-y-rechazada", AHORA); // TP +17.40 y luego SL -12.45
    const m = await metricas();
    expect(m.drawdownMax?.pct).toMatch(/^-\d+\.\d{2}$/);
  });
});
