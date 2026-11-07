import { describe, expect, it } from "vitest";
import { cargarEnv } from "./env";

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
