import { describe, expect, it } from "vitest";
import { cantidadNeta } from "./pnl";
import { PropuestaV1 } from "./propuesta";
import { debePausar, evaluarRiesgo, pnlDia, type EstadoCartera, type IdRegla } from "./riesgo";

const limpio: EstadoCartera = {
  saldoVirtualC: 1_000_000,
  exposicionCostoC: 0,
  saldoLibreC: 1_000_000,
  cantidadPorActivo: {},
  entradasHoy: 0,
  pausaAutomatica: false,
  pausaManual: false,
  ordenesDesconocidas: {},
};

const prop = (cambio: Record<string, unknown> = {}) =>
  PropuestaV1.parse({
    clave_idempotencia: "cic:x:BTC/USD",
    activo: "BTC/USD",
    lado: "buy",
    nocional_usd: 500,
    tipo_orden: "mercado",
    proponente: "ciclo",
    ejecucion_id: "3f0c3b52-6c2e-4b0e-9d5b-2a7a1f6f9a11",
    version_regla: "tendencia-sma-v1",
    justificacion: { entradas: {}, resultado: {} },
    ...cambio,
  });

const falladas = (p: PropuestaV1, e: EstadoCartera) =>
  evaluarRiesgo(p, e)
    .reglas.filter((r) => !r.cumple)
    .map((r) => r.regla);

describe("riesgo: AC-9, cada regla sola con saldo virtual de 10 000", () => {
  const casos: [IdRegla, PropuestaV1, EstadoCartera][] = [
    ["R1", prop({ activo: "ETH/USD" }), limpio],
    ["R2", prop({ lado: "sell", nocional_usd: undefined, cantidad: 0.5 }), { ...limpio, cantidadPorActivo: { "BTC/USD": 0.2 } }],
    ["R3", prop({ nocional_usd: 1001 }), limpio],
    ["R4", prop({ nocional_usd: 500 }), { ...limpio, exposicionCostoC: 450_001, saldoLibreC: 549_999 }],
    ["R5", prop(), { ...limpio, entradasHoy: 48 }],
    ["R6", prop(), { ...limpio, pausaAutomatica: true }],
    ["R7", prop(), { ...limpio, saldoLibreC: 49_999 }], // estado sintético: en el sistema integrado R7 no falla sola (O-1)
    ["R8", prop(), { ...limpio, pausaManual: true }],
    ["R9", prop(), { ...limpio, ordenesDesconocidas: { "BTC/USD": 1 } }],
    ["R10", prop({ tipo_orden: "limite" }), limpio],
  ];

  it.each(casos)("%s falla sola y nombra valor observado y límite", (id, p, e) => {
    const { aprobada, reglas } = evaluarRiesgo(p, e);
    expect(aprobada).toBe(false);
    expect(falladas(p, e)).toEqual([id]);
    const r = reglas.find((x) => x.regla === id)!;
    expect(r.observado).not.toBe("");
    expect(r.limite).not.toBe("");
  });

  it("valores observado/límite legibles", () => {
    const r = evaluarRiesgo(prop({ nocional_usd: 1001 }), limpio).reglas.find((x) => x.regla === "R3")!;
    expect(r).toMatchObject({ observado: "1001.00 USD", limite: "1000.00 USD", aplica: true, cumple: false });
  });

  it("R4: justo en el 50 % cumple", () => {
    const e = { ...limpio, exposicionCostoC: 450_000, saldoLibreC: 550_000 };
    expect(falladas(prop(), e)).toEqual([]);
  });

  it("dos incumplimientos: el registro nombra las dos", () => {
    expect(falladas(prop({ nocional_usd: 1001, tipo_orden: "limite" }), limpio)).toEqual(["R3", "R10"]);
  });

  it("las reglas que no corresponden al lado van con aplica:false y cumplen", () => {
    const compra = evaluarRiesgo(prop(), limpio).reglas;
    expect(compra.find((r) => r.regla === "R2")).toMatchObject({ aplica: false, cumple: true });
    const venta = evaluarRiesgo(prop({ lado: "sell", nocional_usd: undefined, cantidad: 0.1 }), {
      ...limpio,
      cantidadPorActivo: { "BTC/USD": 0.2 },
    });
    expect(venta.aprobada).toBe(true);
    for (const id of ["R3", "R4", "R5", "R6", "R7"]) {
      expect(venta.reglas.find((r) => r.regla === id)?.aplica).toBe(false);
    }
  });

  it("siempre devuelve las diez reglas en orden", () => {
    expect(evaluarRiesgo(prop(), limpio).reglas.map((r) => r.regla)).toEqual([
      "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10",
    ]);
  });
});

describe("AC-10: determinismo", () => {
  it("la compra de 1 000 USD con cartera vacía se aprueba, 100 veces idéntica", () => {
    const p = prop({ nocional_usd: 1000 });
    const primera = evaluarRiesgo(p, limpio);
    expect(primera.aprobada).toBe(true);
    for (let i = 0; i < 100; i++) expect(evaluarRiesgo(p, limpio)).toEqual(primera);
  });
});

describe("AC-25: pérdida diaria", () => {
  it("-300 sobre 10 000 activa la pausa; -299.99 no", () => {
    expect(debePausar(-30_000, 1_000_000)).toBe(true);
    expect(debePausar(-29_999, 1_000_000)).toBe(false);
    expect(debePausar(5_000, 1_000_000)).toBe(false);
  });

  it("pnlDia suma el realizado y el no realizado neto a precio bid", () => {
    const lote = { activo: "BTC/USD", nocionalEntradaC: 50_000, cantidadNeta: cantidadNeta(5) };
    expect(pnlDia(-1000, [lote], { "BTC/USD": 104 })).toEqual({ pnlC: -1000 + 1740, noRealizadoFaltante: false });
    expect(pnlDia(-1000, [], {})).toEqual({ pnlC: -1000, noRealizadoFaltante: false });
  });

  it("sin bid usa solo lo realizado y lo marca como faltante", () => {
    const lote = { activo: "SOL/USD", nocionalEntradaC: 50_000, cantidadNeta: 1 };
    expect(pnlDia(-1000, [lote], { "SOL/USD": null })).toEqual({ pnlC: -1000, noRealizadoFaltante: true });
  });

  it("una pérdida no realizada también pausa", () => {
    const lote = { activo: "BTC/USD", nocionalEntradaC: 500_000, cantidadNeta: cantidadNeta(50) };
    const { pnlC } = pnlDia(0, [lote], { "BTC/USD": 90 });
    expect(debePausar(pnlC, 1_000_000)).toBe(true);
  });
});
