import { describe, expect, it } from "vitest";
import { cargarEnv, leerMaxEntradasAbiertas } from "./env";

const valido = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  APCA_API_KEY_ID: "id",
  APCA_API_SECRET_KEY: "secreto-de-prueba",
  APCA_API_BASE_URL: "https://paper-api.alpaca.markets",
  DASHBOARD_USUARIO: "u",
  DASHBOARD_CONTRASENA: "c",
  INVESTIGADOR_TOKEN_SHA256: "a".repeat(64),
  TRADING_PAUSADO: "false",
  APP_ENV: "test",
};

describe("cargarEnv", () => {
  it("acepta un entorno completo", () => {
    expect(cargarEnv(valido).APP_ENV).toBe("test");
  });

  it("nombra las variables inválidas y nunca imprime sus valores", () => {
    const mal = { ...valido, TRADING_PAUSADO: "quizá", INVESTIGADOR_TOKEN_SHA256: "no-es-hash" };
    let mensaje = "";
    try {
      cargarEnv(mal);
    } catch (e) {
      mensaje = (e as Error).message;
    }
    expect(mensaje).toContain("TRADING_PAUSADO");
    expect(mensaje).toContain("INVESTIGADOR_TOKEN_SHA256");
    expect(mensaje).not.toContain("quizá");
    expect(mensaje).not.toContain("no-es-hash");
  });

  it("rechaza una variable ausente", () => {
    expect(() => cargarEnv({ ...valido, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});

describe("leerMaxEntradasAbiertas (AC-9, REQ-8)", () => {
  const con = (v: string | undefined) => ({ MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: v });

  it("ausente o vacía → 1", () => {
    expect(leerMaxEntradasAbiertas({})).toBe(1);
    expect(leerMaxEntradasAbiertas(con(""))).toBe(1);
  });

  it("entero ≥ 1 → ese valor", () => {
    expect(leerMaxEntradasAbiertas(con("1"))).toBe(1);
    expect(leerMaxEntradasAbiertas(con("2"))).toBe(2);
    expect(leerMaxEntradasAbiertas(con("12"))).toBe(12);
  });

  it.each(["0", "-1", "1.5", "x", " 2", "02", "1e3"])("%j → error sin imprimir el valor", (v) => {
    expect(() => leerMaxEntradasAbiertas(con(v))).toThrow("MAX_ENTRADAS_ABIERTAS_POR_ACTIVO inválida");
    try {
      leerMaxEntradasAbiertas(con(v));
    } catch (e) {
      expect((e as Error).message).not.toContain(`"${v}"`);
    }
  });

  it("no forma parte de cargarEnv: un valor inválido no impide cargar el entorno (RNF-4)", () => {
    expect(cargarEnv({ ...valido, MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: "x" }).APP_ENV).toBe("test");
  });
});
