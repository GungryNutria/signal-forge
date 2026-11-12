import { describe, expect, it } from "vitest";
import { MODOS, resolverModos, type Modo } from "./modos";

// AC-12 (unit), AC-13, AC-14: modo efectivo.
describe("resolverModos", () => {
  it("sin conflicto, el efectivo es el configurado y no hay motivo", () => {
    for (const ciclo of MODOS)
      for (const decisor of MODOS) {
        if (ciclo === "ejecuta" && decisor === "ejecuta") continue;
        const m = resolverModos({ ciclo, decisor }, true);
        expect(m.ciclo).toEqual({ configurado: ciclo, efectivo: ciclo, motivo: null });
        expect(m.decisor).toEqual({ configurado: decisor, efectivo: decisor, motivo: null });
      }
  });

  it("los dos en ejecuta: los dos pasan a solo_registra con su motivo (REQ-16)", () => {
    const m = resolverModos({ ciclo: "ejecuta", decisor: "ejecuta" }, true);
    expect(m.ciclo).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "dos_proponentes_en_ejecuta" });
    expect(m.decisor).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "dos_proponentes_en_ejecuta" });
  });

  it("los dos en ejecuta gana sobre R11: se mira la configuración, no el efecto (REQ-16)", () => {
    const m = resolverModos({ ciclo: "ejecuta", decisor: "ejecuta" }, false);
    expect(m.decisor.motivo).toBe("dos_proponentes_en_ejecuta");
  });

  it("decisor en ejecuta sin R11 vigente: solo_registra con motivo, y el ciclo no cambia (REQ-17)", () => {
    const m = resolverModos({ ciclo: "solo_registra", decisor: "ejecuta" }, false);
    expect(m.decisor).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "r11_no_vigente" });
    expect(m.ciclo).toEqual({ configurado: "solo_registra", efectivo: "solo_registra", motivo: null });
  });

  it("sin R11 vigente, solo el decisor en ejecuta se degrada; el ciclo en ejecuta sigue igual", () => {
    const c: Modo = "ejecuta";
    expect(resolverModos({ ciclo: c, decisor: "solo_registra" }, false).ciclo.efectivo).toBe("ejecuta");
    expect(resolverModos({ ciclo: "apagado", decisor: "solo_registra" }, false).decisor.motivo).toBeNull();
  });
});
