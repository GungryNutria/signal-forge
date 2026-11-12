import { describe, expect, it } from "vitest";
import {
  diaUtc,
  inicioDiaSiguienteUtc,
  inicioDiaUtc,
  minutosEntre,
  proximaEjecucion,
  proximaInvestigacion,
  proximaRanuraDecisor,
  ranura30,
  ranuraDecisor,
} from "./tiempo";

const d = (s: string) => new Date(s);

describe("tiempo", () => {
  it("ranura de 30 min en UTC", () => {
    expect(ranura30(d("2026-11-06T18:29:59Z")).toISOString()).toBe("2026-11-06T18:00:00.000Z");
    expect(ranura30(d("2026-11-06T18:30:00Z")).toISOString()).toBe("2026-11-06T18:30:00.000Z");
  });

  it("día UTC y su siguiente", () => {
    const t = d("2026-11-06T23:59:59Z");
    expect(diaUtc(t)).toBe("2026-11-06");
    expect(inicioDiaUtc(t).toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(inicioDiaSiguienteUtc(t).toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  it("próxima ejecución, estrictamente posterior", () => {
    expect(proximaEjecucion(d("2026-11-06T18:10:00Z")).toISOString()).toBe("2026-11-06T18:30:00.000Z");
    expect(proximaEjecucion(d("2026-11-06T18:30:00Z")).toISOString()).toBe("2026-11-06T19:00:00.000Z");
    expect(proximaEjecucion(d("2026-11-06T23:45:00Z")).toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  it("próxima investigación en el minuto 15", () => {
    expect(proximaInvestigacion(d("2026-11-06T18:10:00Z")).toISOString()).toBe("2026-11-06T18:15:00.000Z");
    expect(proximaInvestigacion(d("2026-11-06T18:15:00Z")).toISOString()).toBe("2026-11-06T19:15:00.000Z");
    expect(proximaInvestigacion(d("2026-11-06T23:50:00Z")).toISOString()).toBe("2026-11-07T00:15:00.000Z");
  });

  it("ranura del decisor: [HH:45, HH+1:45) en UTC (REQ-8)", () => {
    expect(ranuraDecisor(d("2026-11-06T18:45:00Z")).toISOString()).toBe("2026-11-06T18:45:00.000Z");
    expect(ranuraDecisor(d("2026-11-06T19:44:59.999Z")).toISOString()).toBe("2026-11-06T18:45:00.000Z");
    expect(ranuraDecisor(d("2026-11-06T19:45:00Z")).toISOString()).toBe("2026-11-06T19:45:00.000Z");
    expect(ranuraDecisor(d("2026-11-07T00:10:00Z")).toISOString()).toBe("2026-11-06T23:45:00.000Z");
    expect(proximaRanuraDecisor(d("2026-11-06T18:45:00Z")).toISOString()).toBe("2026-11-06T19:45:00.000Z");
    expect(proximaRanuraDecisor(d("2026-11-06T18:10:00Z")).toISOString()).toBe("2026-11-06T18:45:00.000Z");
  });

  it("minutos enteros hacia abajo", () => {
    expect(minutosEntre(d("2026-11-06T18:00:00Z"), d("2026-11-06T18:59:59Z"))).toBe(59);
  });
});
