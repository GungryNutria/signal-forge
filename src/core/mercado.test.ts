import { describe, expect, it } from "vitest";
import { motivoSinDatos, type EntradaSinDatos } from "./mercado";

const T = new Date("2026-11-06T18:31:00Z");
const barra = (inicio: string) => ({ t: inicio });
const base = (): EntradaSinDatos => ({
  errorBarras: null,
  errorSnapshots: null,
  barrasCerradas: [barra("2026-11-06T18:00:00Z")],
  minimoBarras: 1,
  tsQuote: new Date("2026-11-06T18:30:50Z"),
  T,
});

describe("motivoSinDatos (D-9)", () => {
  it("null con datos completos", () => {
    expect(motivoSinDatos(base())).toBeNull();
  });

  it("devuelve los textos que el ciclo ha guardado desde 001, en el mismo orden", () => {
    expect(motivoSinDatos({ ...base(), errorBarras: "x", errorSnapshots: "y" })).toBe("barras: x");
    expect(motivoSinDatos({ ...base(), errorSnapshots: "y" })).toBe("snapshots: y");
    expect(motivoSinDatos({ ...base(), minimoBarras: 21 })).toBe("solo 1 barras cerradas (se necesitan 21)");
    expect(motivoSinDatos({ ...base(), barrasCerradas: [barra("2026-11-06T16:00:00Z")] })).toBe(
      "la última barra cerrada terminó hace más de 60 min",
    );
    expect(motivoSinDatos({ ...base(), tsQuote: null })).toBe("sin quote para el activo");
    expect(motivoSinDatos({ ...base(), tsQuote: new Date("2026-11-06T18:25:00Z") })).toBe("quote ausente o con más de 300 s");
    expect(motivoSinDatos({ ...base(), tsQuote: new Date("2026-11-06T18:32:00Z") })).toBe("quote ausente o con más de 300 s");
  });

  it("sin ninguna barra cerrada no hay datos (el contexto pide al menos una)", () => {
    expect(motivoSinDatos({ ...base(), barrasCerradas: [] })).toBe("solo 0 barras cerradas (se necesitan 1)");
  });
});
