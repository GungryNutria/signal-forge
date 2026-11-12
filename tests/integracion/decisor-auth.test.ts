import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recibirContexto } from "@/server/decisor/recibir";
import { hashToken } from "@/server/investigaciones/auth";
import { recibirInvestigacion } from "@/server/investigaciones/recibir";
import { vaciarBase } from "./arnes";
import {
  BEARER_DECISOR,
  contexto,
  crearEntornoDecisor,
  decisionValida,
  enviarDecision,
  HASHES,
  pedirContexto,
  q,
  TOKEN_DECISOR,
  TOKEN_INVESTIGADOR,
} from "./ayudas-decisor";

// AC-1 (REQ-1) y AC-27 (RNF-5) sobre los handlers del decisor. El recorrido por todas las rutas, con el servidor real,
// está en rutas-token.test.ts.
const e = crearEntornoDecisor();
afterAll(() => e.pool.end());
beforeEach(() => vaciarBase());

const contar = async (tabla: string) => Number((await q(e, `SELECT count(*) AS n FROM ${tabla}`))[0].n);

const INVALIDAS: [string, string | null][] = [
  ["sin token", null],
  ["token mal formado", "Bearer sfd_corto"],
  ["esquema distinto", `Basic ${TOKEN_DECISOR}`],
  ["token revocado (hash distinto en el entorno)", `Bearer sfd_${"Z".repeat(43)}`],
];
const RUTAS: [string, (a: string | null) => Promise<Response>][] = [
  ["contextos", (a) => pedirContexto(e, a)],
  ["decisiones", (a) => enviarDecision(e, { clave: "x" }, a)],
];

describe("AC-1 sin credencial válida: 401 y un solo evento sin contenido", () => {
  for (const [ruta, llamar] of RUTAS) {
    it.each(INVALIDAS)(`${ruta}: %s`, async (_nombre, cabecera) => {
      const res = await llamar(cabecera);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "no_autorizado" });
      expect(await contar("contextos_decisor")).toBe(0);
      expect(await contar("decisiones")).toBe(0);
      const evs = await q(e, "SELECT tipo, detalle FROM eventos");
      expect(evs).toHaveLength(1);
      expect(evs[0].tipo).toBe("auth_fallida");
      expect(Object.keys(evs[0].detalle).sort()).toEqual(["ip", "ruta"]);
      expect(evs[0].detalle.ruta).toContain(`/decisor/${ruta}`);
    });
  }

  it("sin hash del decisor configurado, nadie entra con un sfd_", async () => {
    const sin = { ...e.deps, hashes: { investigador: HASHES.investigador } };
    const res = await recibirContexto(
      new Request("http://localhost/api/v1/decisor/contextos", { method: "POST", headers: { authorization: BEARER_DECISOR } }),
      sin,
    );
    expect(res.status).toBe(401);
  });
});

describe("AC-1 el token del investigador no sirve en las rutas del decisor", () => {
  for (const [ruta, llamar] of RUTAS) {
    it(`${ruta}: 403, no se guarda nada y no hay evento`, async () => {
      const res = await llamar(`Bearer ${TOKEN_INVESTIGADOR}`);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "prohibido" });
      expect(await contar("contextos_decisor")).toBe(0);
      expect(await contar("decisiones")).toBe(0);
      expect(await contar("eventos")).toBe(0);
    });
  }
});

describe("AC-1 el token del decisor no envía investigaciones", () => {
  const VALIDA = {
    clave_idempotencia: "inv:2026-11-06T18:BTC/USD",
    ejecucion_id: "2026-11-06T18",
    version_instrucciones: "investigacion-v1",
    activo: "BTC/USD",
    sentimiento: 0.1,
    noticia_fuerte: false,
    confianza: 0.5,
    resumen: "ok",
    fuentes: [],
  };
  const enviar = (autorizacion: string, decisorTokenSha256: string | null = HASHES.decisor) =>
    recibirInvestigacion(
      new Request("http://localhost/api/v1/investigaciones", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: autorizacion },
        body: JSON.stringify(VALIDA),
      }),
      { db: drizzle(e.pool), tokenSha256: hashToken(TOKEN_INVESTIGADOR), decisorTokenSha256: decisorTokenSha256 ?? undefined },
    );

  it("403 y nada guardado con el token del decisor; el del investigador sigue dando 201", async () => {
    const res = await enviar(BEARER_DECISOR);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "prohibido" });
    expect(await contar("investigaciones")).toBe(0);
    expect(await contar("eventos")).toBe(0);
    expect((await enviar(`Bearer ${TOKEN_INVESTIGADOR}`)).status).toBe(201);
  });

  it("sin DECISOR_TOKEN_SHA256 configurado el token del decisor es solo uno inválido (401)", async () => {
    expect((await enviar(BEARER_DECISOR, null)).status).toBe(401);
  });
});

describe("AC-27 límite de frecuencia (30 por 60 min)", () => {
  /** Siembra `n` decisiones rechazadas recibidas hace `haceMin` minutos. */
  const sembrar = (n: number, haceMin: number) =>
    q(
      e,
      `INSERT INTO decisiones (recibida_en, ranura, estado, motivo, valida, es_original)
       SELECT $1::timestamptz - make_interval(mins => $2::int), $1, 'rechazada', 'json_invalido', false, false FROM generate_series(1, $3::int)`,
      [e.reloj.ahora, haceMin, n],
    );

  it("la petición 31 de la ventana recibe 429 con Retry-After y no se guarda", async () => {
    await sembrar(29, 50);
    const ok = await pedirContexto(e);
    expect(ok.status).toBe(201); // la 30
    const antes = [await contar("contextos_decisor"), await contar("decisiones")];

    const res = await pedirContexto(e);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "limite_frecuencia" });
    expect(Number(res.headers.get("retry-after"))).toBe(600); // la más vieja, de hace 50 min, sale en 10
    expect((await enviarDecision(e, decisionValida("6b1f5c9e-3a47-4b0e-9a56-1f2d3c4b5a69"))).status).toBe(429);
    expect([await contar("contextos_decisor"), await contar("decisiones")]).toEqual(antes);
  });

  it("las peticiones de hace más de 60 min no cuentan", async () => {
    await sembrar(40, 61);
    expect((await pedirContexto(e)).status).toBe(201);
    await contexto(e);
  });
});
