import { describe, expect, it } from "vitest";
import { leerModosConfigurados, modosActuales, r11Vigente } from "./modos";

// AC-12 (unit), AC-14: lectura de la configuración.
describe("leerModosConfigurados", () => {
  it("ausentes o vacíos: ciclo ejecuta y decisor apagado (el comportamiento de antes)", () => {
    expect(leerModosConfigurados({})).toEqual({ ciclo: "ejecuta", decisor: "apagado" });
    expect(leerModosConfigurados({ MODO_CICLO: "", MODO_DECISOR: "" })).toEqual({ ciclo: "ejecuta", decisor: "apagado" });
  });

  it("acepta los tres valores en cada variable", () => {
    expect(leerModosConfigurados({ MODO_CICLO: "solo_registra", MODO_DECISOR: "ejecuta" })).toEqual({
      ciclo: "solo_registra",
      decisor: "ejecuta",
    });
    expect(leerModosConfigurados({ MODO_CICLO: "apagado" }).ciclo).toBe("apagado");
  });

  it.each(["Ejecuta", "si", "true", " ejecuta", "solo-registra"])("valor inválido %j: lanza nombrando la variable y sin el valor", (v) => {
    for (const nombre of ["MODO_CICLO", "MODO_DECISOR"]) {
      let msg = "";
      try {
        leerModosConfigurados({ [nombre]: v });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toBe(`${nombre} inválido`);
    }
  });
});

describe("r11Vigente y modosActuales", () => {
  it("R11 está en vigor con N ausente o válida y no con N inválida (AC-14)", () => {
    expect(r11Vigente({})).toBe(true);
    expect(r11Vigente({ MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: "2" })).toBe(true);
    expect(r11Vigente({ MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: "0" })).toBe(false);
  });

  it("decisor en ejecuta con N inválida: efectivo solo_registra con motivo r11_no_vigente", () => {
    const m = modosActuales({ MODO_CICLO: "solo_registra", MODO_DECISOR: "ejecuta", MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: "0" });
    expect(m.decisor).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "r11_no_vigente" });
  });
});
