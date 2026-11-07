import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "@/server/investigaciones/auth";
import { recibirInvestigacion } from "@/server/investigaciones/recibir";
import { abrirPool } from "./arnes";

// AC-1 (sin token, mal formado, revocado) y AC-24 (token revocado -> 401).

const TOKEN = `sfi_${"A".repeat(43)}`;
const VALIDA = {
  clave_idempotencia: "inv:2026-11-06T18:BTC/USD",
  ejecucion_id: "2026-11-06T18",
  version_instrucciones: "investigacion-v1",
  activo: "BTC/USD",
  sentimiento: 0.42,
  noticia_fuerte: false,
  confianza: 0.8,
  resumen: "Texto.",
  fuentes: ["https://example.com/nota"],
};

let pool: Pool;
const dep = (tokenSha256: string | undefined) => ({ db: drizzle(pool), tokenSha256 });
const post = (authorization?: string) =>
  new Request("http://localhost/api/v1/investigaciones", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(VALIDA),
  });
const contar = async (tabla: string) =>
  Number((await pool.query(`SELECT count(*) FROM ${tabla}`)).rows[0].count);

beforeAll(() => {
  pool = abrirPool();
});
afterAll(() => pool.end());

describe("auth de la API de investigaciones", () => {
  it.each([
    ["sin token", undefined],
    ["token mal formado", "Bearer sfi_corto"],
    ["esquema distinto", `Basic ${TOKEN}`],
    ["token revocado (hash distinto en el env)", `Bearer ${TOKEN}`],
  ])("%s -> 401, nada se guarda y queda un evento sin contenido", async (_nombre, cabecera) => {
    const hashOtro = hashToken(`sfi_${"Z".repeat(43)}`);
    const antes = await contar("eventos");
    const res = await recibirInvestigacion(post(cabecera), dep(hashOtro));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_autorizado" });
    expect(await contar("investigaciones")).toBe(0);
    expect(await contar("eventos")).toBe(antes + 1);
    const { rows } = await pool.query("SELECT tipo, detalle FROM eventos ORDER BY id DESC LIMIT 1");
    expect(rows[0].tipo).toBe("auth_fallida");
    expect(Object.keys(rows[0].detalle).sort()).toEqual(["ip", "ruta"]);
    expect(JSON.stringify(rows[0].detalle)).not.toContain("BTC");
  });

  it("sin hash configurado nadie entra", async () => {
    const res = await recibirInvestigacion(post(`Bearer ${TOKEN}`), dep(undefined));
    expect(res.status).toBe(401);
  });

  it("el token vigente pasa (201) y al cambiar el hash deja de servir (401)", async () => {
    const ok = await recibirInvestigacion(post(`Bearer ${TOKEN}`), dep(hashToken(TOKEN)));
    expect(ok.status).toBe(201);
    const revocado = await recibirInvestigacion(
      post(`Bearer ${TOKEN}`),
      dep(hashToken(`sfi_${"Y".repeat(43)}`)),
    );
    expect(revocado.status).toBe(401);
    expect(await contar("investigaciones")).toBe(1);
  });
});
