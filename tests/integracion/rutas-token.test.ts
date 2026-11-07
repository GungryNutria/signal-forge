import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "@/server/investigaciones/auth";
import { arrancarServidor, SENUELO, type Servidor } from "./servidor";

// AC-2: con el token del investigador solo POST /api/v1/investigaciones da 2xx.
// Corre contra `next start` real (requiere `npm run build`), porque lo que se prueba es el ruteo.

let srv: Servidor;
beforeAll(async () => {
  srv = await arrancarServidor(3191, hashToken(SENUELO.token));
}, 60_000);
afterAll(() => srv?.detener());

const llamar = (metodo: string, ruta: string, cuerpo?: object) =>
  fetch(srv.base + ruta, {
    method: metodo,
    headers: { authorization: `Bearer ${SENUELO.token}`, "content-type": "application/json" },
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

  it("/api/health responde sin credenciales y sin datos", async () => {
    const res = await fetch(srv.base + "/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
