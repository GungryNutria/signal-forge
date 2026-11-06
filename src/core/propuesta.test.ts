import { describe, expect, it } from "vitest";
import { huellaPropuesta, jsonCanonico, PropuestaV1 } from "./propuesta";

const base = {
  clave_idempotencia: "cic:2026-11-06T18:00:00.000Z:BTC/USD",
  activo: "BTC/USD",
  lado: "buy",
  nocional_usd: 500,
  tipo_orden: "mercado",
  proponente: "ciclo",
  ejecucion_id: "3f0c3b52-6c2e-4b0e-9d5b-2a7a1f6f9a11",
  version_regla: "tendencia-sma-v1",
  justificacion: { entradas: { closes: [1, 2] }, resultado: { senal: true } },
};

describe("PropuestaV1", () => {
  it("acepta una compra válida y una venta con cantidad", () => {
    expect(PropuestaV1.safeParse(base).success).toBe(true);
    expect(PropuestaV1.safeParse({ ...base, lado: "sell", nocional_usd: undefined, cantidad: 0.5 }).success).toBe(true);
  });

  it("deja pasar ETH/USD y orden límite para que R1 y R10 las rechacen con su regla", () => {
    expect(PropuestaV1.safeParse({ ...base, activo: "ETH/USD" }).success).toBe(true);
    expect(PropuestaV1.safeParse({ ...base, tipo_orden: "limite" }).success).toBe(true);
  });

  it.each([
    ["sin clave", { clave_idempotencia: undefined }],
    ["sin activo", { activo: undefined }],
    ["lado inválido", { lado: "x" }],
    ["compra sin nocional", { nocional_usd: undefined }],
    ["nocional negativo", { nocional_usd: -5 }],
    ["campo desconocido", { extra: true }],
    ["sin justificación", { justificacion: undefined }],
  ])("AC-8: rechaza %s", (_, cambio) => {
    expect(PropuestaV1.safeParse({ ...base, ...cambio }).success).toBe(false);
  });
});

describe("huella", () => {
  const p = PropuestaV1.parse(base);

  it("es estable e ignora justificación, ejecución y clave", () => {
    const otra = PropuestaV1.parse({
      ...base,
      clave_idempotencia: "otra",
      ejecucion_id: "11111111-6c2e-4b0e-9d5b-2a7a1f6f9a11",
      justificacion: { entradas: {}, resultado: {} },
    });
    expect(huellaPropuesta(otra)).toBe(huellaPropuesta(p));
    expect(huellaPropuesta(p)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia con el contenido", () => {
    expect(huellaPropuesta(PropuestaV1.parse({ ...base, nocional_usd: 501 }))).not.toBe(huellaPropuesta(p));
    expect(huellaPropuesta(PropuestaV1.parse({ ...base, activo: "SOL/USD" }))).not.toBe(huellaPropuesta(p));
  });

  it("el JSON canónico no depende del orden de las claves", () => {
    expect(jsonCanonico({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
      jsonCanonico({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }),
    );
  });
});
