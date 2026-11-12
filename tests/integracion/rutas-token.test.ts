import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "@/server/investigaciones/auth";
import { arrancarServidor, SENUELO, type Servidor } from "./servidor";

// AC-2: con el token del investigador solo POST /api/v1/investigaciones da 2xx.
// AC-1 de 004: con el token del decisor solo POST /api/v1/decisor/contextos y /decisiones dan 2xx.
// Corre contra `next start` real (requiere `npm run build`), porque lo que se prueba es el ruteo.

let srv: Servidor;
beforeAll(async () => {
  srv = await arrancarServidor(3191, hashToken(SENUELO.token), hashToken(SENUELO.tokenDecisor));
}, 60_000);
afterAll(() => srv?.detener());

const llamar = (metodo: string, ruta: string, cuerpo?: object, token = SENUELO.token) =>
  fetch(srv.base + ruta, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    redirect: "manual",
  });

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

describe("AC-2 el token solo sirve para enviar investigaciones", () => {
  it("POST /api/v1/investigaciones con el token -> 2xx", async () => {
    const res = await llamar("POST", "/api/v1/investigaciones", VALIDA);
    expect([200, 201]).toContain(res.status);
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])(
    "%s /api/v1/investigaciones -> 405",
    async (metodo) => {
      expect((await llamar(metodo, "/api/v1/investigaciones")).status).toBe(405);
    },
  );

  const OTRAS = [
    "/api/v1/propuestas",
    "/api/v1/ordenes",
    "/api/v1/cartera",
    "/api/v1/investigaciones/abc",
    "/api/v1/",
    "/api/v1",
    "/api/v2/investigaciones",
  ];
  it.each(OTRAS.flatMap((r) => ["GET", "POST"].map((m) => [m, r] as const)))(
    "%s %s no ofrece nada (404, 405, 401 o redirect a la ruta sin barra)",
    async (metodo, ruta) => {
      const res = await llamar(metodo, ruta, metodo === "POST" ? VALIDA : undefined);
      expect([308, 401, 404, 405]).toContain(res.status);
    },
  );

  it.each(["/", "/propuestas", "/metricas", "/ejecuciones", "/api/otra"])(
    "las páginas y rutas del dashboard (%s) piden basic auth: el token no sirve",
    async (ruta) => {
      for (const metodo of ["GET", "POST"]) {
        const res = await llamar(metodo, ruta);
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toBe('Basic realm="SignalForge"');
      }
    },
  );

  it("las rutas del decisor dan 403 con el token del investigador", async () => {
    for (const ruta of ["/api/v1/decisor/contextos", "/api/v1/decisor/decisiones"]) {
      expect((await llamar("POST", ruta)).status).toBe(403);
    }
  });

  it("/api/health responde sin credenciales y sin datos", async () => {
    const res = await fetch(srv.base + "/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// AC-1 de 004: lo mismo con el token del decisor. Contra la base de pruebas; el mercado falla (llaves señuelo) y el contexto
// sale con "datos no disponibles", que sigue siendo un 201.
describe("AC-1 (004) el token del decisor solo sirve para leer el contexto y enviar decisiones", () => {
  const como = (metodo: string, ruta: string, cuerpo?: object) => llamar(metodo, ruta, cuerpo, SENUELO.tokenDecisor);

  it("POST contextos -> 201 y POST decisiones con ese contexto -> 201", async () => {
    const res = await como("POST", "/api/v1/decisor/contextos");
    expect(res.status).toBe(201);
    const c = await res.json();
    expect(c.version).toBe("contexto-v1");
    const dec = await como("POST", "/api/v1/decisor/decisiones", {
      clave_idempotencia: `dec:ruta:${c.id}`,
      ejecucion_id: "2026-11-06T11",
      version_instrucciones: "decisor-v1@prueba",
      contexto_id: c.id,
      activo: "BTC/USD",
      decision: "no_comprar",
      confianza: 0.5,
      razonamiento: "Prueba de ruta.",
    });
    expect(dec.status).toBe(201);
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])("%s en las dos rutas del decisor -> 405", async (metodo) => {
    for (const ruta of ["/api/v1/decisor/contextos", "/api/v1/decisor/decisiones"]) {
      expect((await como(metodo, ruta)).status).toBe(405);
    }
  });

  it("POST /api/v1/investigaciones con el token del decisor -> 403", async () => {
    expect((await como("POST", "/api/v1/investigaciones", VALIDA)).status).toBe(403);
  });

  const OTRAS = [
    "/api/v1/propuestas",
    "/api/v1/ordenes",
    "/api/v1/cartera",
    "/api/v1/decisor",
    "/api/v1/decisor/otra",
    "/api/v1/decisor/contextos/abc",
    "/api/v1/",
  ];
  it.each(OTRAS.flatMap((r) => ["GET", "POST"].map((m) => [m, r] as const)))(
    "%s %s no ofrece nada (404, 405, 401 o redirect)",
    async (metodo, ruta) => {
      expect([308, 401, 404, 405]).toContain((await como(metodo, ruta, metodo === "POST" ? VALIDA : undefined)).status);
    },
  );

  it.each(["/", "/propuestas", "/metricas", "/ejecuciones", "/api/otra"])("%s pide basic auth: el token del decisor no sirve", async (ruta) => {
    const res = await como("GET", ruta);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Basic realm="SignalForge"');
  });

  it.each([
    ["sin token", undefined],
    ["mal formado", "Bearer sfd_corto"],
    ["revocado", `Bearer sfd_${"R".repeat(43)}`],
  ])("%s -> 401 en las dos rutas", async (_nombre, cabecera) => {
    for (const ruta of ["/api/v1/decisor/contextos", "/api/v1/decisor/decisiones"]) {
      const res = await fetch(srv.base + ruta, { method: "POST", headers: cabecera ? { authorization: cabecera } : {}, body: "{}" });
      expect(res.status).toBe(401);
    }
  });
});
