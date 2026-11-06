import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashToken } from "@/server/investigaciones/auth";
import { recibirInvestigacion } from "@/server/investigaciones/recibir";
import { abrirPool } from "./arnes";

// AC-32 (válida, inválidas, reenvío) y AC-28 (límite de frecuencia). La auth está en investigaciones-auth.

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
const enviar = (cuerpo: string | object) =>
  recibirInvestigacion(
    new Request("http://localhost/api/v1/investigaciones", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }),
    { db: drizzle(pool), tokenSha256: hashToken(TOKEN) },
  );
const filas = async () =>
  (await pool.query("SELECT * FROM investigaciones ORDER BY recibida_en, id")).rows;

beforeAll(() => {
  pool = abrirPool();
});
afterAll(() => pool.end());
beforeEach(async () => {
  // Las tablas son append-only: en la base de prueba se vacían saltando los triggers de la sesión.
  const c = await pool.connect();
  try {
    await c.query("SET session_replication_role = replica");
    await c.query("TRUNCATE investigaciones, eventos CASCADE");
  } finally {
    await c.query("SET session_replication_role = DEFAULT");
    c.release();
  }
});

describe("AC-32 validación y registro", () => {
  it("una válida -> 201, hora del servidor y fila aceptada", async () => {
    const antes = Date.now();
    const res = await enviar(VALIDA);
    expect(res.status).toBe(201);
    const cuerpo = await res.json();
    expect(cuerpo).toMatchObject({ estado: "aceptada" });
    expect(Math.abs(new Date(cuerpo.recibida_en).getTime() - antes)).toBeLessThan(10_000);
    const [f] = await filas();
    expect(f).toMatchObject({
      id: cuerpo.id,
      estado: "aceptada",
      activo: "BTC/USD",
      version_instrucciones: "investigacion-v1",
      fuentes: ["https://example.com/nota"],
    });
    expect(Number(f.sentimiento)).toBe(0.42);
  });

  it("recorta el resumen (trim) antes de guardar", async () => {
    await enviar({ ...VALIDA, resumen: "  hola  " });
    expect((await filas())[0].resumen).toBe("hola");
  });

  const invalidas: [string, object, string][] = [
    ["sentimiento 1.5", { ...VALIDA, sentimiento: 1.5 }, "sentimiento"],
    ["confianza -0.1", { ...VALIDA, confianza: -0.1 }, "confianza"],
    ['noticia_fuerte "sí"', { ...VALIDA, noticia_fuerte: "sí" }, "noticia_fuerte"],
    ["URL javascript:", { ...VALIDA, fuentes: ["javascript:alert(1)"] }, "fuentes.0"],
    ["URL mal formada", { ...VALIDA, fuentes: ["no es url"] }, "fuentes.0"],
    ["activo ETH/USD", { ...VALIDA, activo: "ETH/USD" }, "activo"],
    ["resumen de 601", { ...VALIDA, resumen: "x".repeat(601) }, "resumen"],
    ["campo desconocido", { ...VALIDA, extra: 1 }, "extra"],
    ["11 fuentes", { ...VALIDA, fuentes: Array(11).fill("https://a.com") }, "fuentes"],
  ];
  it.each(invalidas)("%s -> 422 con motivo y fila rechazada", async (_n, cuerpo, campo) => {
    const res = await enviar(cuerpo);
    expect(res.status).toBe(422);
    const r = await res.json();
    expect(r.error).toBe("investigacion_invalida");
    expect(r.motivos.map((m: { campo: string }) => m.campo)).toContain(campo);
    const [f] = await filas();
    expect(f).toMatchObject({ id: r.id, estado: "rechazada", motivo: "investigacion_invalida" });
    expect(f.cuerpo_crudo).toBe(JSON.stringify(cuerpo));
    expect(f.motivos).toEqual(r.motivos);
  });

  it("JSON mal formado -> 400 y fila rechazada con el cuerpo crudo", async () => {
    const res = await enviar("{no es json");
    expect(res.status).toBe(400);
    const r = await res.json();
    expect(r.error).toBe("json_invalido");
    expect((await filas())[0]).toMatchObject({
      id: r.id,
      estado: "rechazada",
      motivo: "json_invalido",
      cuerpo_crudo: "{no es json",
    });
  });

  it("el carácter nulo se rechaza con 422 en vez de romper la inserción", async () => {
    const res = await enviar(JSON.stringify({ ...VALIDA, resumen: "a\u0000b" }));
    expect(res.status).toBe(422);
    expect((await filas())[0].cuerpo_crudo).not.toContain("\u0000");
  });

  it("más de 16 KiB -> 413 y fila rechazada sin cuerpo", async () => {
    const res = await enviar(JSON.stringify({ ...VALIDA, resumen: "x".repeat(17 * 1024) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "cuerpo_demasiado_grande" });
    expect((await filas())[0]).toMatchObject({
      estado: "rechazada",
      motivo: "cuerpo_demasiado_grande",
      cuerpo_crudo: null,
    });
  });

  it("un cuerpo de exactamente 16 KiB todavía se lee (falla por el esquema, no por tamaño)", async () => {
    const res = await enviar(`"${"x".repeat(16 * 1024 - 2)}"`);
    expect(res.status).toBe(422);
  });

  it("reenvío con la misma clave y contenido -> 200 con el cuerpo original y sin fila nueva", async () => {
    const primera = await (await enviar(VALIDA)).json();
    const res = await enviar(VALIDA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(primera);
    expect(await filas()).toHaveLength(1);
  });

  it("misma clave y otro contenido -> 409 y fila rechazada; la original queda intacta", async () => {
    const primera = await (await enviar(VALIDA)).json();
    const res = await enviar({ ...VALIDA, sentimiento: -0.9 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflicto_idempotencia" });
    const todas = await filas();
    expect(todas.map((f) => f.estado)).toEqual(["aceptada", "rechazada"]);
    expect(todas[1].motivo).toBe("conflicto_idempotencia");
    expect(todas[0].id).toBe(primera.id);
  });

  it("tres iguales a la vez dejan una sola aceptada", async () => {
    const rs = await Promise.all([enviar(VALIDA), enviar(VALIDA), enviar(VALIDA)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect((await filas()).filter((f) => f.estado === "aceptada")).toHaveLength(1);
  });
});

describe("AC-28 límite de frecuencia", () => {
  it("20 en 60 min y la 21.ª -> 429 con Retry-After y sin fila nueva", async () => {
    await pool.query(
      `INSERT INTO investigaciones (estado, motivo, recibida_en)
       SELECT 'rechazada', 'investigacion_invalida', now() - make_interval(mins => g) FROM generate_series(1, 20) g`,
    );
    const res = await enviar(VALIDA);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "limite_frecuencia" });
    const espera = Number(res.headers.get("retry-after"));
    expect(espera).toBeGreaterThan(0);
    expect(espera).toBeLessThanOrEqual(3600);
    expect(await filas()).toHaveLength(20);
  });

  it("las de hace más de 60 min no cuentan", async () => {
    await pool.query(
      `INSERT INTO investigaciones (estado, motivo, recibida_en)
       SELECT 'rechazada', 'investigacion_invalida', now() - make_interval(mins => 61 + g) FROM generate_series(1, 20) g`,
    );
    expect((await enviar(VALIDA)).status).toBe(201);
  });
});
