import { describe, expect, it } from "vitest";
import { DecisionV1, huellaDecision, propuestaDe } from "./decision";
import { PropuestaV1 } from "./propuesta";

const VALIDA = {
  clave_idempotencia: "dec:2026-11-12T17:BTC/USD",
  ejecucion_id: "2026-11-12T17",
  version_instrucciones: "decisor-v1@claude-haiku-x",
  contexto_id: "6b1f5c9e-3a47-4b0e-9a56-1f2d3c4b5a69",
  activo: "BTC/USD",
  decision: "no_comprar",
  confianza: 0.72,
  razonamiento: "Texto literal.",
};

describe("DecisionV1 (REQ-7, REQ-12, AC-5)", () => {
  it("acepta una decisión válida", () => {
    expect(DecisionV1.safeParse(VALIDA).success).toBe(true);
  });

  it.each([
    ["confianza 1.2", { confianza: 1.2 }],
    ["confianza -0.1", { confianza: -0.1 }],
    ["decisión vender", { decision: "vender" }],
    ["activo ETH/USD", { activo: "ETH/USD" }],
    ["un campo tamaño", { tamano: 5000 }],
    ["un campo de niveles de salida", { stop_loss: 1 }],
    ["razonamiento sobre el máximo", { razonamiento: "x".repeat(2001) }],
    ["razonamiento vacío", { razonamiento: "   " }],
    ["sin clave", { clave_idempotencia: undefined }],
    ["clave con caracteres fuera del patrón", { clave_idempotencia: "dec 1" }],
    ["versión sin modelo", { version_instrucciones: "decisor-v1" }],
    ["contexto que no es uuid", { contexto_id: "abc" }],
    ["confianza como texto", { confianza: "0.7" }],
  ])("rechaza %s", (_nombre, cambio) => {
    expect(DecisionV1.safeParse({ ...VALIDA, ...cambio }).success).toBe(false);
  });

  it("recorta el razonamiento (trim) y acepta el máximo exacto", () => {
    expect(DecisionV1.parse({ ...VALIDA, razonamiento: "  hola  " }).razonamiento).toBe("hola");
    expect(DecisionV1.safeParse({ ...VALIDA, razonamiento: "x".repeat(2000) }).success).toBe(true);
  });
});

describe("huellaDecision", () => {
  it("no depende de la clave ni del orden de los campos, y cambia con cualquier otro campo", () => {
    const base = huellaDecision(VALIDA as DecisionV1);
    expect(huellaDecision({ ...VALIDA, clave_idempotencia: "otra" } as DecisionV1)).toBe(base);
    expect(huellaDecision(Object.fromEntries(Object.entries(VALIDA).reverse()) as DecisionV1)).toBe(base);
    expect(huellaDecision({ ...VALIDA, confianza: 0.73 } as DecisionV1)).not.toBe(base);
    expect(huellaDecision({ ...VALIDA, razonamiento: "otro" } as DecisionV1)).not.toBe(base);
  });
});

describe("propuestaDe (REQ-10, REQ-12)", () => {
  const entrada = {
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    ranura: new Date("2026-11-12T16:45:00Z"),
    activo: "SOL/USD" as const,
    versionInstrucciones: "decisor-v1@claude-haiku-x",
    contextoId: VALIDA.contexto_id,
    confianza: 0.9,
  };

  it("siempre es una compra de 500 USD a mercado del decisor, y pasa el esquema de propuesta", () => {
    const p = propuestaDe(entrada);
    expect(PropuestaV1.safeParse(p).success).toBe(true);
    expect(p).toMatchObject({
      clave_idempotencia: "decisor:2026-11-12T16:45:00Z:SOL/USD",
      activo: "SOL/USD",
      lado: "buy",
      nocional_usd: 500,
      tipo_orden: "mercado",
      proponente: "decisor",
      ejecucion_id: entrada.id,
      version_regla: "decisor-v1@claude-haiku-x",
    });
    expect(p.justificacion).toEqual({
      entradas: { decision_id: entrada.id, contexto_id: VALIDA.contexto_id },
      resultado: { decision: "comprar", confianza: 0.9 },
    });
  });

  it("la confianza no cambia el tamaño ni el tipo (AC-11)", () => {
    const a = propuestaDe({ ...entrada, confianza: 1 });
    const b = propuestaDe({ ...entrada, confianza: 0 });
    expect({ ...a, justificacion: 0 }).toEqual({ ...b, justificacion: 0 });
  });
});
