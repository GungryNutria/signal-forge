import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { BASE, capturar, CREDENCIALES, MEDIDAS, PUERTOS, SIN_BASE, sembrar, url, vigilarCarga } from "./ayuda";

// S6 Precio (spec 002), T-7: accesibilidad, medidas (1280, 390 y 360), 44×44, sin scroll horizontal, rótulos sin choques,
// carga con la red limitada, AC-16 (solo 127.0.0.1), AC-17 (sin campos crudos ni señuelos) y AC-19 (rendimiento).
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const lista = async (page: Page, timeout = 5000) => {
  await expect(page.locator("[data-grafica-lista]")).toBeVisible({ timeout });
  await expect(page.locator("svg[data-capa]")).toBeVisible({ timeout });
};
const graves = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
};
const sinScrollHorizontal = async (page: Page) => {
  const a = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(a.s).toBeLessThanOrEqual(a.c);
};
const cajasRotulos = (page: Page) =>
  page.locator("[data-rotulo-nivel] rect").evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect()).map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height })));
/** Ningún rótulo de nivel toca un marcador ni un grupo (C-2, AC-UX-9). */
const sinChoquesConMarcadores = async (page: Page) => {
  const rotulos = await cajasRotulos(page);
  const marcas = await page.locator("[data-marcador], [data-grupo]").evaluateAll((gs) => gs.map((g) => g.getBoundingClientRect()).map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height })));
  for (const [i, a] of rotulos.entries())
    for (const [j, b] of marcas.entries()) {
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `el rótulo ${i} toca el marcador ${j}`).toBe(false);
    }
};
const sinChoques = (cajas: { x: number; y: number; w: number; h: number }[]) => {
  for (let i = 0; i < cajas.length; i++)
    for (let j = i + 1; j < cajas.length; j++) {
      const [a, b] = [cajas[i], cajas[j]];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `los rótulos ${i} y ${j} se tocan`).toBe(false);
    }
};

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test("AC-18: axe wcag2aa y wcag22aa sin violaciones serias ni críticas con datos, con consulta, vacío y error; sin scroll horizontal", async ({ page, browser }) => {
      sembrar("precio-operaciones");
      await page.goto("/precio");
      await lista(page);
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
      await capturar(page, m.ancho, "s6_datos");
      // Con una consulta abierta (el panel cambia de contenido).
      await page.locator("[data-grafica]").focus();
      await page.keyboard.press("PageDown");
      await expect(page.locator("[data-panel-consulta] h3")).toBeVisible();
      expect(await graves(page)).toEqual([]);
      await page.locator("main details summary").click();
      expect(await graves(page)).toEqual([]);

      sembrar("vacio");
      await page.goto("/precio");
      await expect(page.getByText(/Todavía no hay precios registrados/)).toBeVisible();
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
      await capturar(page, m.ancho, "s6_vacio");

      sembrar("precio-operaciones");
      const ctx = await browser.newContext({ httpCredentials: CREDENCIALES, viewport: { width: m.ancho, height: m.alto } });
      const e = await ctx.newPage();
      await e.goto(`${url(PUERTOS.fallaSeriePrecio)}/precio`);
      await expect(e.getByRole("alert").filter({ hasText: "No se pudo cargar la gráfica de precio" })).toBeVisible();
      expect(await graves(e)).toEqual([]);
      await e.goto(`${url(PUERTOS.fallaOperacionesPrecio)}/precio`);
      await lista(e);
      await sinScrollHorizontal(e);
      expect(await graves(e)).toEqual([]);
      await ctx.close();
    });

    test("AC-UX-16: selectores y enlaces de 44×44 como mínimo, la gráfica ocupa el ancho disponible y está todo lo de escritorio", async ({ page }) => {
      sembrar("precio-operaciones");
      await page.goto("/precio");
      await lista(page);
      const enlaces = page.locator("main a:visible, main summary:visible");
      expect(await enlaces.count()).toBeGreaterThan(8);
      for (const e of await enlaces.all()) {
        const b = (await e.boundingBox())!;
        // AC-UX-16 pide 44×44 a 360 y 390 px; en escritorio los enlaces de texto siguen el patrón de 001.
        if (m.ancho < 768) {
          expect(b.height, await e.innerText()).toBeGreaterThanOrEqual(44);
          expect(b.width, await e.innerText()).toBeGreaterThanOrEqual(44);
        }
      }
      const g = (await page.locator("[data-grafica]").boundingBox())!;
      const principal = (await page.locator("main").boundingBox())!;
      if (m.ancho < 768) expect(g.width).toBeGreaterThanOrEqual(principal.width - 34);
      for (const t of ["Cierre de velas de 30 min evaluadas por el ciclo", "Último punto", "Alternativa en texto", "Posiciones abiertas", "Tabla de puntos"]) {
        await expect(page.locator("main").getByText(t).first()).toBeAttached();
      }
      await expect(page.getByRole("list", { name: "Leyenda" })).toBeVisible();
    });

    test("AC-UX-8: con 3 y con 10 posiciones abiertas ningún rótulo toca a otro y el texto lista los 20 niveles", async ({ page }) => {
      for (const [escenario, n] of [["precio-abiertas-3", 3], ["precio-abiertas-10", 10]] as const) {
        sembrar(escenario);
        await page.goto("/precio?activo=SOL%2FUSD");
        await lista(page);
        sinChoques(await cajasRotulos(page));
        await sinChoquesConMarcadores(page);
        if (m.ancho >= 560) {
          // Escritorio: todos los rótulos en la canaleta de 168 px a la derecha del plano, nunca sobre los datos.
          const r = await page.locator("[data-rotulo-nivel]").count();
          expect(r).toBeGreaterThan(0);
          const area = await page.locator("[class*='recharts-cartesian-grid']").first().boundingBox();
          for (const c of await cajasRotulos(page)) expect(c.x).toBeGreaterThanOrEqual(area!.x + area!.width - 1);
        } else {
          // Móvil: más de 4 rótulos o alguno que tocaría un marcador se sustituyen por la línea de explicación.
          const r = await page.locator("[data-rotulo-nivel]").count();
          if (r === 0) {
            await expect(page.locator("[data-niveles-nota]")).toHaveText(`${2 * n} niveles de ${n} posiciones abiertas · toca una entrada para ver los suyos`);
            // Al consultar una entrada se dibujan solo los rótulos de su posición.
            const marca = page.locator("[data-marcador^='e:']").first();
            if ((await marca.count()) > 0) {
              await marca.scrollIntoViewIfNeeded();
              const numero = (await marca.locator("text").first().textContent())!.trim();
              const b = (await marca.locator("path").first().boundingBox())!;
              await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
              await expect(page.locator("[data-rotulo-nivel]")).toHaveCount(2);
              await expect(page.locator("[data-rotulo-nivel]").first()).toContainText(numero);
              sinChoques(await cajasRotulos(page)); // los de la posición consultada no se tocan entre sí
            }
          }
        }
        await expect(page.locator("[data-posicion]")).toHaveCount(n);
        await expect(page.locator("[data-nivel]")).toHaveCount(2 * n);
        await sinScrollHorizontal(page);
        await capturar(page, m.ancho, `s6_abiertas_${n}`);
      }
    });

    test("AC-UX-9: con 48 entradas la suma de las cuentas visibles es 48", async ({ page }) => {
      sembrar("precio-48-entradas");
      await page.goto("/precio");
      await lista(page);
      const sueltos = await page.locator("[data-marcador]").count();
      const grupos = await page.locator("[data-grupo]").evaluateAll((gs) => gs.map((g) => Number(g.getAttribute("data-grupo"))));
      expect(sueltos + grupos.reduce((a, b) => a + b, 0)).toBe(48);
      sinChoques(await cajasRotulos(page));
      await capturar(page, m.ancho, "s6_48");
    });

    test("AC-UX-1: se ven activo, rango, rótulo, hora del último punto y la gráfica, y las capturas en color y en grises", async ({ page }) => {
      sembrar("precio-operaciones");
      await page.goto("/precio");
      await lista(page);
      const dentro = async (l: ReturnType<Page["locator"]>) => {
        const b = (await l.boundingBox())!;
        return b.y >= 0 && b.y + b.height <= m.alto;
      };
      await expect(page.getByRole("navigation", { name: "Activo" })).toBeInViewport();
      await expect(page.getByRole("navigation", { name: "Rango" })).toBeInViewport();
      await expect(page.getByText("Cierre de velas de 30 min evaluadas por el ciclo")).toBeInViewport();
      await expect(page.getByText(/Último punto: /)).toBeInViewport();
      await expect(page.locator("[data-grafica]")).toBeInViewport({ ratio: 0.5 });
      expect(await dentro(page.getByText(/Último punto: /))).toBe(true);
      await capturar(page, m.ancho, "s6_normal");
      const carpeta = process.env.CAPTURAS;
      if (carpeta) {
        await page.addStyleTag({ content: "html{filter:grayscale(1)}" });
        await page.screenshot({ path: `${carpeta}/s6_grises_${m.ancho}.png`, fullPage: false });
        await page.screenshot({ path: `${carpeta}/s6_color_${m.ancho}.png`, fullPage: false });
      }
    });
  });
}

test.describe("carga, red y respuestas", () => {
  test("AC-UX-2 y AC-UX-13: con la red limitada se ve el esqueleto sin cifras y nunca la gráfica anterior con la selección nueva", async ({ page, context }) => {
    sembrar("precio-operaciones");
    const r = await vigilarCarga(page, context, "/precio");
    expect(r.visto).toBeGreaterThan(0);
    expect(r.textosConDato).toEqual([]);
    await lista(page, 60_000); // la red sigue limitada
    // Cambio de rango con la respuesta retrasada: aparece "Cargando BTC/USD · 7 días" y la gráfica de 24 h ya no está.
    await page.route(/rango=7d/, async (ruta) => {
      await new Promise((f) => setTimeout(f, 2500));
      await ruta.continue();
    });
    await page.getByRole("navigation", { name: "Rango" }).getByRole("link", { name: "7 días" }).click();
    await expect(page.getByText("Cargando BTC/USD · 7 días")).toBeVisible();
    await expect(page.locator("[data-grafica]")).toHaveCount(0);
    await lista(page, 60_000);
    await expect(page.getByRole("navigation", { name: "Rango" }).getByRole("link", { name: "7 días" })).toHaveAttribute("aria-current", "true");
  });

  test("AC-16: mostrar la gráfica no hace peticiones a nada que no sea 127.0.0.1", async ({ page }) => {
    sembrar("precio-operaciones");
    const hosts = new Set<string>();
    page.on("request", (r) => hosts.add(new URL(r.url()).hostname));
    await page.goto("/precio");
    await lista(page);
    await page.getByRole("navigation", { name: "Rango" }).getByRole("link", { name: "7 días" }).click();
    await lista(page);
    expect([...hosts]).toEqual(["127.0.0.1"]);
  });

  test("AC-17: el HTML y el RSC de /precio no traen campos crudos, ni 'foto', ni el señuelo de la llave", async ({ page }) => {
    sembrar("precio-operaciones");
    const cuerpos: string[] = [];
    page.on("response", async (r) => {
      if (new URL(r.url()).pathname === "/precio") cuerpos.push(await r.text().catch(() => ""));
    });
    await page.goto("/precio");
    await lista(page);
    await page.getByRole("navigation", { name: "Rango" }).getByRole("link", { name: "7 días" }).click();
    await lista(page);
    await page.waitForTimeout(500);
    expect(cuerpos.length).toBeGreaterThanOrEqual(2);
    const prohibido = /entrada_cruda|client_order_id|clientOrderId|"respuesta"|"foto"|\bfoto\b|sf-senuelo|APCA_API|respuestaBroker/;
    for (const c of cuerpos) expect(c.match(prohibido)?.[0] ?? null).toBeNull();
    expect(cuerpos.some((c) => c.includes("self.__next_f") || c.includes("<html"))).toBe(true);
  });

  test("AC-19: con 30 días (1 440 puntos) y 50 operaciones la gráfica se dibuja en menos de 2 s (mediana de 5)", async ({ page }) => {
    test.skip(!!process.env.CI && !process.env.MEDIR_AC19, "Medición de rendimiento: se corre fuera de la CI (MEDIR_AC19=1 la fuerza).");
    sembrar("precio-30-dias");
    const tiempos: number[] = [];
    await page.goto("/precio?activo=BTC%2FUSD&rango=30d");
    await lista(page); // calienta el servidor
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await page.goto("/precio?activo=BTC%2FUSD&rango=30d");
      await page.waitForSelector("[data-grafica-lista]");
      await page.waitForSelector("svg[data-capa] [data-marcador], svg[data-capa] [data-grupo]");
      tiempos.push(Date.now() - t0);
    }
    const mediana = [...tiempos].sort((a, b) => a - b)[2];
    console.log(`AC-19: ${tiempos.join(" ms, ")} ms; mediana ${mediana} ms`);
    test.info().annotations.push({ type: "AC-19", description: `mediana ${mediana} ms (${tiempos.join(", ")})` });
    expect(mediana).toBeLessThan(2000);
  });
});
