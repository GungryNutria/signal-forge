import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { agregarEjecucion, BASE, capturar, CREDENCIALES, MEDIDAS, PUERTOS, SIN_BASE, sembrar, url, vigilarCarga } from "./ayuda";

// S5 Ejecuciones y detalle de una evaluación: AC-36, AC-UX-28 a 31 (más AC-UX-13, 19 y 22) en las tres medidas.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const vis = (l: Locator) => l.filter({ visible: true });
const filas = (page: Page, ancho: number) =>
  ancho >= 768 ? page.locator("table tbody tr").filter({ visible: true }) : page.getByRole("list", { name: "Ejecuciones del ciclo" }).getByRole("listitem");
const sinScrollHorizontal = async (page: Page) => {
  const a = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(a.s).toBeLessThanOrEqual(a.c);
};
const graves = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
};

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test("AC-36 y AC-UX-28: cada fila con inicio, fin, versión y el resultado de cada activo con el vocabulario fijo", async ({ page }) => {
      sembrar("ejecuciones-por-caso");
      await page.goto("/ejecuciones");
      await expect(page.getByText("5 resultados")).toBeVisible();
      const f = filas(page, m.ancho);
      await expect(f).toHaveCount(5);
      if (m.ancho >= 768) {
        const cabeceras = await page.getByRole("columnheader").allTextContents();
        expect(cabeceras.map((c) => c.trim())).toEqual(["Inicio (UTC−6)", "Fin (UTC−6)", "Versión de la regla", "BTC/USD", "SOL/USD"]);
      }
      // Fila 1: BTC propuesta ejecutada, SOL sin señal (el "Sin señal" no es error ni alerta).
      await expect(f.nth(0)).toContainText("Propuesta: Ejecutada");
      await expect(f.nth(0)).toContainText("Sin señal");
      await expect(f.nth(0)).toContainText("tendencia-sma-v1");
      await expect(f.nth(0)).toContainText(/\d{2}:\d{2}/);
      // Fila 2: datos no disponibles y error.
      await expect(f.nth(1)).toContainText("Datos no disponibles");
      await expect(f.nth(1)).toContainText("Error");
      // Fila 3: omitida por solapamiento, una sola celda y sin resultado por activo.
      await expect(f.nth(2)).toContainText("Omitida por solapamiento");
      await expect(f.nth(2)).toContainText("Sin resultado por activo");
      await expect(f.nth(2).getByText("Sin señal")).toHaveCount(0);
      // Fila 5: la ejecución caída muestra su error.
      await expect(f.nth(4)).toContainText("plazo interno de 120 s agotado");
      await capturar(page, m.ancho, "s5_lista");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-30: filtros que se combinan, omitidas con cualquier activo, conteo, vacío por filtro y filtro conservado", async ({ page }) => {
      sembrar("ejecuciones-por-caso");
      await page.goto("/ejecuciones");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "SOL/USD", exact: true }).click();
      await expect(page).toHaveURL(/activo=SOL%2FUSD/);
      // Las omitidas por solapamiento aparecen con cualquier filtro de activo.
      await expect(page.getByText("5 resultados")).toBeVisible();
      await expect(vis(page.getByText("Omitida por solapamiento")).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      // Resultado: en móvil es un <select> nativo; en escritorio, chips.
      if (m.ancho >= 768) await page.getByRole("button", { name: "Sin señal", exact: true }).click();
      else await page.locator("#select-resultado").selectOption("sin_senal");
      await expect(page).toHaveURL(/resultado=sin_senal/);
      // SOL sin señal: la de hace 12 min y la de hace 102 min.
      await expect(page.getByText("2 resultados")).toBeVisible();

      // Sin coincidencias: SOL no tuvo propuesta en ninguna.
      await page.waitForLoadState("networkidle");
      if (m.ancho >= 768) await page.getByRole("button", { name: "Propuesta", exact: true }).click();
      else await page.locator("#select-resultado").selectOption("propuesta");
      await expect(vis(page.getByText("Ninguna ejecución coincide con los filtros."))).toBeVisible();
      await expect(page.getByText("0 resultados")).toBeVisible();
      await vis(page.getByRole("link", { name: "Quitar los filtros" })).click();
      await expect(page.getByText("5 resultados")).toBeVisible();

      // Al volver desde una evaluación se conservan los filtros.
      await page.goto("/ejecuciones?activo=BTC%2FUSD&resultado=datos_no_disponibles");
      await expect(page.getByText("1 resultado", { exact: true })).toBeVisible();
      await vis(page.getByRole("link", { name: /Datos no disponibles.*Ver detalle/ })).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("BTC/USD");
      await page.getByRole("main").getByRole("link", { name: "Ejecuciones", exact: true }).click();
      await expect(page).toHaveURL(/activo=BTC%2FUSD/);
      await expect(page).toHaveURL(/resultado=datos_no_disponibles/);
      await expect(page.getByText("1 resultado", { exact: true })).toBeVisible();
    });

    test("AC-UX-28: S5 está a 1 toque de la banda y un resultado 'Propuesta' lleva a su S3 en 1 toque", async ({ page }) => {
      sembrar("ejecuciones-por-caso");
      await page.goto("/");
      await page.getByRole("link", { name: "Ver ejecuciones" }).click();
      await expect(page).toHaveURL(/\/ejecuciones$/);
      await expect(page.getByRole("heading", { name: "Ejecuciones", level: 1 })).toBeVisible();
      await vis(page.getByRole("link", { name: /BTC\/USD: Propuesta: Ejecutada/ })).first().click();
      await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}/);
      await expect(page.getByRole("heading", { name: "Regla de entrada evaluada" })).toBeVisible();
      // El regreso desde esa propuesta es a Ejecuciones.
      await page.getByRole("main").getByRole("link", { name: "Ejecuciones", exact: true }).click();
      await expect(page).toHaveURL(/\/ejecuciones/);
    });

    test("AC-UX-29: la evaluación sin señal muestra la regla y después la investigación adjunta, o 'Sin investigación'", async ({ page }) => {
      sembrar("solo-ejecuciones-sin-senal");
      await page.goto("/ejecuciones");
      // Fila de hace 12 min (investigación adjunta en los dos activos).
      await vis(page.getByRole("link", { name: /BTC\/USD: Sin señal, ejecución de las/ })).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("BTC/USD");
      const titulos = await page.locator("main").getByRole("heading", { level: 2 }).allTextContents();
      expect(titulos).toEqual(["Regla de entrada evaluada", "Investigación adjunta"]);
      await expect(vis(page.getByText("tendencia-sma-v1")).first()).toBeVisible();
      await expect(vis(page.getByText(/Último cierre \(barra de \d{2}:00, UTC−6\)|Último cierre \(barra de \d{2}:30, UTC−6\)/)).first()).toBeVisible();
      await expect(vis(page.getByText("Informativa: no interviene en la decisión de entrada"))).toBeVisible();
      await expect(vis(page.getByText(/en escala −1 a 1/))).toBeVisible();
      await expect(vis(page.getByText(/en escala 0 a 1/))).toBeVisible();
      await expect(vis(page.getByText("Noticia fuerte"))).toBeVisible();
      await capturar(page, m.ancho, "s5_detalle-sin-senal");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);

      // Fila de hace 42 min: BTC/USD sin investigación adjunta.
      await page.goto("/ejecuciones");
      const f = filas(page, m.ancho).nth(1);
      await f.getByRole("link", { name: /BTC\/USD: Sin señal/ }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("BTC/USD");
      await expect(vis(page.getByText("Sin investigación", { exact: true }))).toBeVisible();
      await expect(vis(page.getByText("Informativa: no interviene en la decisión de entrada"))).toBeVisible();
      await capturar(page, m.ancho, "s5_detalle-sin-investigacion");
    });

    test("la evaluación sin datos dice por qué no se pudo evaluar la regla, y un id que no existe da la página de no encontrada", async ({ page }) => {
      sembrar("ejecuciones-por-caso");
      await page.goto("/ejecuciones?resultado=datos_no_disponibles");
      await vis(page.getByRole("link", { name: /BTC\/USD: Datos no disponibles/ })).click();
      await expect(vis(page.getByText(/La regla no se pudo evaluar: bars: sin respuesta del proveedor/))).toBeVisible();
      await page.goto("/ejecuciones/00000000-0000-4000-8000-000000000000/BTC-USD");
      await expect(page.getByRole("heading", { level: 1, name: "No se encontró esta página" })).toBeVisible();
    });

    test("AC-UX-31: base vacía, S5 explica la cadencia y la próxima ejecución y no muestra la alerta de ciclo detenido", async ({ page }) => {
      sembrar("vacio");
      await page.goto("/ejecuciones");
      await expect(page.getByText(/Todavía no hay ejecuciones\. El ciclo evalúa BTC\/USD y SOL\/USD cada 30 minutos; la próxima ejecución se espera a las \d{2}:(00|30) \(UTC−6\)/)).toBeVisible();
      await expect(page.getByText("0 resultados")).toBeVisible();
      await expect(page.getByText("El ciclo no corre")).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Alertas" })).toHaveCount(0);
      await capturar(page, m.ancho, "s5_vacio");
      expect(await graves(page)).toEqual([]);
    });

    test("paginación por cursor: 50 por página, 'Más recientes' y 'Anteriores', y el conteo total", async ({ page }) => {
      test.setTimeout(120_000);
      sembrar("solo-ejecuciones-sin-senal");
      for (let i = 0; i < 60; i++) await agregarEjecucion("completada", 200 + i * 31);
      await page.goto("/ejecuciones");
      await expect(page.getByText("64 resultados")).toBeVisible();
      await expect(filas(page, m.ancho)).toHaveCount(50);
      await expect(page.getByText("Mostrando 50 de 64")).toBeVisible();
      await expect(page.getByText("‹ Más recientes")).toHaveAttribute("aria-disabled", "true");
      await page.getByRole("link", { name: "Anteriores ›" }).click();
      await expect(page.getByText("Mostrando 14 de 64")).toBeVisible();
      await expect(filas(page, m.ancho)).toHaveCount(14);
      await page.getByRole("link", { name: "‹ Más recientes" }).click();
      await expect(filas(page, m.ancho)).toHaveCount(50);
    });

    test("AC-UX-19 y 22: sin scroll horizontal y toda hora con su zona (inicio, fin y barra)", async ({ page }) => {
      sembrar("solo-ejecuciones-sin-senal");
      await page.goto("/ejecuciones");
      await expect(vis(page.getByText("(UTC−6)")).first()).toBeVisible();
      await sinScrollHorizontal(page);
      await vis(page.getByRole("link", { name: /SOL\/USD: Sin señal/ })).first().click();
      await expect(page.getByRole("heading", { name: "Regla de entrada evaluada" })).toBeVisible();
      await expect(vis(page.getByText(/inicio \d{1,2} \w+, \d{2}:\d{2}:\d{2} \(UTC−6\) · \d{1,2} \w+, \d{2}:\d{2}:\d{2} UTC/))).toBeVisible();
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });
  });
}

test("AC-UX-31: si las ejecuciones fallan lo dice, los filtros y la banda siguen", async ({ page }) => {
  sembrar("ejecuciones-por-caso");
  await page.goto(url(PUERTOS.fallaEjecuciones) + "/ejecuciones");
  await expect(vis(page.getByText("No se pudo cargar las ejecuciones. Estos datos no se muestran; recarga la página para intentar de nuevo."))).toBeVisible();
  await expect(page.getByRole("button", { name: "BTC/USD", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Modo de trading" })).toBeVisible();
  await expect(page.getByText(/Falla inyectada/)).toHaveCount(0);
});

test("AC-UX-31: con la red lenta, S5 no muestra filas ni horas mientras carga", async ({ page, context }) => {
  sembrar("ejecuciones-por-caso");
  const { visto, textosConDato } = await vigilarCarga(page, context, "/ejecuciones");
  expect(visto, "debió verse al menos un marcador de carga").toBeGreaterThan(0);
  expect(textosConDato).toEqual([]);
  await expect(page.getByText("5 resultados")).toBeVisible({ timeout: 30_000 });
});
