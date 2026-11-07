import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { basicValido, hashToken, tokenValido } from "./auth";

const TOKEN = `sfi_${"A".repeat(43)}`;
const HASH = hashToken(TOKEN);
const basic = (u: string, c: string) => `Basic ${Buffer.from(`${u}:${c}`).toString("base64")}`;

describe("tokenValido", () => {
  it("acepta el token cuyo hash coincide", () => {
    expect(tokenValido(`Bearer ${TOKEN}`, HASH)).toBe(true);
  });
  it.each([
    ["sin cabecera", null],
    ["sin Bearer", TOKEN],
    ["otro esquema", `Basic ${TOKEN}`],
    ["corto", "Bearer sfi_corto"],
    ["prefijo distinto", `Bearer xxx_${"A".repeat(43)}`],
    ["token con relleno", `Bearer ${TOKEN} `],
    ["otro token", `Bearer sfi_${"B".repeat(43)}`],
  ])("rechaza %s", (_nombre, cabecera) => {
    expect(tokenValido(cabecera, HASH)).toBe(false);
  });
  it("sin hash configurado o con hash inválido nadie entra", () => {
    expect(tokenValido(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(tokenValido(`Bearer ${TOKEN}`, "no-es-hex")).toBe(false);
  });
});

describe("basicValido", () => {
  it("acepta usuario y contraseña (la contraseña puede llevar ':')", () => {
    expect(basicValido(basic("edgar", "p:a:ss"), "edgar", "p:a:ss")).toBe(true);
  });
  it.each([
    ["contraseña errónea", basic("edgar", "x")],
    ["usuario erróneo", basic("otro", "pass")],
    ["sin dos puntos", `Basic ${Buffer.from("edgarpass").toString("base64")}`],
    ["otro esquema", "Bearer abc"],
    ["vacía", null],
  ])("rechaza %s", (_nombre, cabecera) => {
    expect(basicValido(cabecera, "edgar", "pass")).toBe(false);
  });
  it("sin credenciales configuradas niega todo (falla cerrado)", () => {
    expect(basicValido(basic("", ""), "", "")).toBe(false);
    expect(basicValido(basic("a", "b"), undefined, undefined)).toBe(false);
  });
});

describe("scripts/generar-token.mjs", () => {
  it("imprime un token sfi_ de 43 caracteres base64url y su SHA-256 verificable", () => {
    const salida = execFileSync("node", ["scripts/generar-token.mjs"], { encoding: "utf8" });
    const token = salida.match(/^(sfi_[A-Za-z0-9_-]{43})$/m)?.[1];
    const hash = salida.match(/^([0-9a-f]{64})$/m)?.[1];
    expect(token).toBeDefined();
    expect(hash).toBe(hashToken(token!));
  });
});
