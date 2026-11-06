import { expect, test } from "@playwright/test";

// AC-3: sin credenciales o con credenciales erróneas, toda ruta de página da 401 y un cuerpo sin datos.
// Las rutas incluyen las de S1 a S5; las que aún no existen también deben dar 401 (el proxy va antes del 404).

const RUTAS = [
  "/",
  "/propuestas",
  "/propuestas/00000000-0000-4000-8000-000000000001",
  "/metricas",
  "/ejecuciones",
  "/ejecuciones/00000000-0000-4000-8000-000000000001/BTC-USD",
  "/ruta-que-no-existe",
  "/_next/static/chunks/inexistente.js",
];
const basic = (u: string, c: string) => ({
  authorization: `Basic ${Buffer.from(`${u}:${c}`).toString("base64")}`,
});

const CASOS = [
  ["sin credenciales", {}],
  ["contraseña errónea", basic("sf-usuario-senuelo", "mala")],
  ["usuario erróneo", basic("otro", "sf-contrasena-senuelo")],
  ["esquema Bearer", { authorization: "Bearer sfi_x" }],
] as const;

for (const [nombre, headers] of CASOS) {
  for (const ruta of RUTAS) {
    test(`${nombre}: GET ${ruta} -> 401 sin datos`, async ({ request }) => {
      const res = await request.get(ruta, { headers, maxRedirects: 0 });
      expect(res.status()).toBe(401);
      expect(res.headers()["www-authenticate"]).toBe('Basic realm="SignalForge"');
      const cuerpo = await res.text();
      expect(cuerpo).toBe("No autorizado");
      for (const dato of ["USD", "BTC", "SOL", "uuid"]) expect(cuerpo).not.toContain(dato);
    });
  }
}

test("con las credenciales correctas la página responde (200)", async ({ request }) => {
  const res = await request.get("/", { headers: basic("sf-usuario-senuelo", "sf-contrasena-senuelo") });
  expect(res.status()).toBe(200);
});

test("/api/health y /api/v1/* quedan fuera de basic auth", async ({ request }) => {
  expect((await request.get("/api/health")).status()).not.toBe(401);
  // Sin token la API del investigador responde con su propio 401 (JSON), no el de basic auth.
  const res = await request.post("/api/v1/investigaciones", { data: {} });
  expect(res.status()).toBe(401);
  expect(res.headers()["www-authenticate"]).toBeUndefined();
});
