import { describe, expect, it } from "vitest";
import { InvestigacionV1, seleccionarVigente, type InvestigacionGuardada } from "./investigacion";

const valida = {
  clave_idempotencia: "inv:2026-11-06T18:BTC/USD",
  ejecucion_id: "2026-11-06T18",
  version_instrucciones: "investigacion-v1",
  activo: "BTC/USD",
  sentimiento: 0.42,
  noticia_fuerte: false,
  confianza: 0.8,
  resumen: "  Texto breve.  ",
  fuentes: ["https://example.com/nota"],
};

describe("InvestigacionV1", () => {
  it("acepta una válida y recorta el resumen", () => {
    const r = InvestigacionV1.parse(valida);
    expect(r.resumen).toBe("Texto breve.");
  });

  it.each([
    ["sentimiento fuera de rango", { sentimiento: 1.5 }],
    ["confianza negativa", { confianza: -0.1 }],
    ["noticia_fuerte como texto", { noticia_fuerte: "sí" }],
    ["URL javascript:", { fuentes: ["javascript:alert(1)"] }],
    ["URL mal formada", { fuentes: ["no es url"] }],
    ["activo no permitido", { activo: "ETH/USD" }],
    ["resumen demasiado largo", { resumen: "x".repeat(601) }],
    ["resumen vacío tras trim", { resumen: "   " }],
    ["más de 10 fuentes", { fuentes: Array(11).fill("https://example.com") }],
    ["campo desconocido", { extra: 1 }],
    ["sentimiento NaN", { sentimiento: Number.NaN }],
    ["clave con caracteres inválidos", { clave_idempotencia: "inv 1" }],
  ])("rechaza: %s", (_, cambio) => {
    expect(InvestigacionV1.safeParse({ ...valida, ...cambio }).success).toBe(false);
  });
});

const T = new Date("2026-11-06T18:30:00Z");
const hace = (min: number) => new Date(T.getTime() - min * 60_000);
const inv = (
  id: string,
  activo: string,
  recibidaEn: Date,
  estado: "aceptada" | "rechazada" = "aceptada",
): InvestigacionGuardada => ({ id, activo, estado, recibidaEn });

describe("seleccionarVigente (AC-33)", () => {
  it("adjunta la de T-59", () => {
    expect(seleccionarVigente([inv("a", "BTC/USD", hace(59))], "BTC/USD", T)?.id).toBe("a");
  });

  it("T-60 y T-61 ya no se adjuntan", () => {
    expect(seleccionarVigente([inv("a", "BTC/USD", hace(60))], "BTC/USD", T)).toBeNull();
    expect(seleccionarVigente([inv("a", "BTC/USD", hace(61))], "BTC/USD", T)).toBeNull();
  });

  it("nunca la de otro activo, una posterior a T ni una rechazada", () => {
    const todas = [
      inv("sol", "SOL/USD", hace(5)),
      inv("futura", "BTC/USD", new Date(T.getTime() + 1000)),
      inv("rechazada", "BTC/USD", hace(2), "rechazada"),
    ];
    expect(seleccionarVigente(todas, "BTC/USD", T)).toBeNull();
    expect(seleccionarVigente(todas, "SOL/USD", T)?.id).toBe("sol");
  });

  it("elige la más reciente de las vigentes, sin importar el orden", () => {
    const todas = [
      inv("vieja", "BTC/USD", hace(50)),
      inv("nueva", "BTC/USD", hace(10)),
      inv("media", "BTC/USD", hace(30)),
    ];
    expect(seleccionarVigente(todas, "BTC/USD", T)?.id).toBe("nueva");
  });

  it("recibida justo en T se adjunta", () => {
    expect(seleccionarVigente([inv("a", "BTC/USD", T)], "BTC/USD", T)?.id).toBe("a");
  });
});
