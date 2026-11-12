import { describe, expect, it } from "vitest";
import {
  lineaDeModos,
  motivoDecision,
  rangoRanura,
  confianza,
  cripto,
  desgloseR11,
  dominio,
  hora,
  horaConSegundos,
  nombreCorto,
  pct,
  reglaPrincipal,
  relativo,
  sentimiento,
  usd,
  usdConSigno,
  zona,
} from "./formato";

describe("formato es-MX", () => {
  it("muestra la hora de Torreón con su zona", () => {
    expect(hora("2026-11-06T20:30:00Z")).toBe("14:30 (UTC−6)");
    expect(horaConSegundos("2026-11-06T20:42:05Z")).toBe("14:42:05 (UTC−6)");
    expect(zona(new Date("2026-07-01T12:00:00Z"))).toBe("UTC−6");
  });
  it("relativo", () => {
    expect(relativo(12)).toBe("hace 12 min");
    expect(relativo(121)).toBe("hace 2 h 1 min");
    expect(relativo(120)).toBe("hace 2 h");
    expect(relativo(0)).toBe("hace menos de 1 min");
  });
  it("importes con miles, dos decimales y signo explícito", () => {
    expect(usd("10184.2")).toBe("10,184.20 USD");
    expect(usdConSigno("17.06")).toBe("+17.06 USD");
    expect(usdConSigno("-312.4")).toBe("−312.40 USD");
    expect(usdConSigno("0")).toBe("0.00 USD");
    expect(usdConSigno("-0.001")).toBe("0.00 USD");
    expect(usd("1234567890.5")).toBe("1,234,567,890.50 USD");
  });
  it("porcentajes", () => {
    expect(pct("-3.12", 2)).toBe("−3.12 %");
    expect(pct("57.1", 1, false)).toBe("57.1 %");
    expect(pct("0", 2)).toBe("0.00 %");
  });
  it("cripto sin redondear a cero y hasta 8 decimales", () => {
    expect(cripto("3.41200000", "SOL")).toBe("3.412 SOL");
    expect(cripto("0.00012345", "BTC")).toBe("0.00012345 BTC");
    expect(cripto("0.000000001", "BTC")).toBe("<0.00000001 BTC");
  });
  it("escalas de la investigación", () => {
    expect(sentimiento("0.42")).toBe("+0.42 en escala −1 a 1");
    expect(sentimiento("-1")).toBe("−1.00 en escala −1 a 1");
    expect(confianza("0.8")).toBe("0.80 en escala 0 a 1");
  });
  it("solo http(s) es enlazable y se muestra el dominio real", () => {
    expect(dominio("https://www.coindesk.com/a?b=1")).toEqual({ dominio: "www.coindesk.com", enlazable: true });
    expect(dominio("javascript:alert(1)").enlazable).toBe(false);
    expect(dominio("no es url").enlazable).toBe(false);
  });
  it("regla principal con su valor y límite", () => {
    expect(reglaPrincipal({ regla: "R3", observado: "1001.00 USD", limite: "1000.00 USD" })).toBe(
      "R3 tamaño: 1,001.00 USD > límite 1,000.00 USD",
    );
    expect(reglaPrincipal({ regla: "R6", observado: "activa", limite: "inactiva" })).toBe(
      "R6 pausa automática: activa (límite: inactiva)",
    );
  });
  it("R11: texto de S2 con el activo, desglose de S3 y nombre corto de la banda (AC-UX-1, 2, 5)", () => {
    expect(reglaPrincipal({ regla: "R11", observado: "2", limite: "1" }, "BTC/USD")).toBe("R11 entradas abiertas de BTC/USD: 2 > límite 1");
    expect(reglaPrincipal({ regla: "R3", observado: "1001.00 USD", limite: "1000.00 USD" }, "BTC/USD")).toBe(
      "R3 tamaño: 1,001.00 USD > límite 1,000.00 USD",
    );
    expect(desgloseR11("2", "1")).toBe("1 abierta + esta propuesta = 2 · límite 1");
    expect(desgloseR11("1", "1")).toBe("0 abiertas + esta propuesta = 1 · límite 1");
    expect(desgloseR11("4", "2")).toBe("3 abiertas + esta propuesta = 4 · límite 2");
    expect(nombreCorto("R11")).toBe("R11 entradas abiertas");
    expect(nombreCorto("R8")).toBe("R8 pausa manual");
  });
});

describe("vocabulario del decisor (spec 004)", () => {
  const m = (efectivo: "ejecuta" | "solo_registra" | "apagado", motivo: string | null = null) => ({ efectivo, motivo });
  it("la línea de modos de la banda", () => {
    expect(lineaDeModos(m("solo_registra"), m("ejecuta"))).toBe("Ejecuta: Decisor · Ciclo: Solo registra");
    expect(lineaDeModos(m("ejecuta"), m("apagado"))).toBe("Ejecuta: Ciclo · Decisor: Apagado");
    expect(lineaDeModos(m("solo_registra", "dos_proponentes_en_ejecuta"), m("solo_registra", "dos_proponentes_en_ejecuta"))).toBe("Ejecuta: ninguno");
    expect(lineaDeModos(m("solo_registra"), m("solo_registra", "r11_no_vigente"))).toBe("Ejecuta: ninguno · Ciclo: Solo registra · Decisor: Solo registra");
  });
  it("motivos del sistema y rango de la ranura", () => {
    expect(motivoDecision("contexto_vencido")).toBe("Contexto vencido");
    expect(motivoDecision("conflicto_ranura")).toBe("Conflicto");
    expect(rangoRanura("2026-11-12T19:45:00.000Z")).toBe("13:45 a 14:45 (UTC−6)");
  });
});
