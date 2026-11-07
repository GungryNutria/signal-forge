import { describe, expect, it } from "vitest";
import { aCentavos, deCentavos, excedePorcentaje } from "./dinero";

describe("dinero", () => {
  it("convierte sin errores de coma flotante", () => {
    expect(aCentavos(1001)).toBe(100100);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    expect(deCentavos(1000000)).toBe("10000.00");
    expect(deCentavos(-1244)).toBe("-12.44");
    expect(deCentavos(5)).toBe("0.05");
  });

  it("compara contra un porcentaje de forma exacta", () => {
    expect(excedePorcentaje(100000, 1000000, 10)).toBe(false);
    expect(excedePorcentaje(100100, 1000000, 10)).toBe(true);
  });
});
