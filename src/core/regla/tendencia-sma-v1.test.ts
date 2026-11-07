import { describe, expect, it } from "vitest";
import { evaluarTendenciaSmaV1, TENDENCIA_SMA_V1 } from "./tendencia-sma-v1";

const plano = (n: number, v = 100) => Array.from({ length: n }, () => v);

describe("tendencia-sma-v1", () => {
  it("AC-5: 100 evaluaciones con los mismos closes dan el mismo resultado", () => {
    const closes = [...plano(20), 105];
    const primero = evaluarTendenciaSmaV1(closes);
    for (let i = 0; i < 100; i++) expect(evaluarTendenciaSmaV1(closes)).toEqual(primero);
    expect(primero.senal).toBe(true);
  });

  it("señal: sobre la SMA20 y sobre el close previo", () => {
    const r = evaluarTendenciaSmaV1([...plano(20), 101]);
    expect(r).toMatchObject({ senal: true, closeUltimo: 101, closePrevio: 100 });
    expect(r.sma20).toBeCloseTo((19 * 100 + 101) / 20);
  });

  it("sin señal si baja respecto al previo aunque esté sobre la SMA", () => {
    const closes = [...plano(19, 100), 120, 110];
    const r = evaluarTendenciaSmaV1(closes);
    expect(r.closeUltimo).toBeGreaterThan(r.sma20);
    expect(r.senal).toBe(false);
  });

  it("sin señal si sube respecto al previo pero está bajo la SMA", () => {
    const closes = [...plano(19, 100), 50, 60];
    expect(evaluarTendenciaSmaV1(closes).senal).toBe(false);
  });

  it("un empate no es señal", () => {
    expect(evaluarTendenciaSmaV1(plano(21)).senal).toBe(false);
  });

  it("usa solo las últimas 21 y exige al menos 21", () => {
    const largo = [999, 999, ...plano(20), 101];
    expect(evaluarTendenciaSmaV1(largo)).toEqual(evaluarTendenciaSmaV1([...plano(20), 101]));
    expect(() => evaluarTendenciaSmaV1(plano(20))).toThrow();
  });

  it("congela la versión y el tamaño", () => {
    expect(TENDENCIA_SMA_V1).toMatchObject({ version: "tendencia-sma-v1", nocionalUsd: 500, tipoOrden: "mercado" });
  });
});
