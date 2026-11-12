import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { BASE, capturar, CREDENCIALES, MEDIDAS, PUERTOS, SIN_BASE, sembrar, url } from "./ayuda";

// S2 Propuestas y S3 Detalle: AC-UX-10 a 12, 25 y 32, estado vacío (AC-UX-7), error (AC-UX-9) y axe, a 1280, 390 y 360.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const filas = (page: Page) => page.locator("table tbody tr").filter({ visible: true });
const items = (page: Page) => page.getByRole("list", { name: "Propuestas" }).getByRole("listitem");
/** Las filas visibles de la lista: tabla en escritorio, tarjetas en móvil. */
const lista = (page: Page, ancho: number) => (ancho >= 768 ? filas(page) : items(page));
// Next conserva la ruta anterior oculta en el DOM: lo que se afirma sobre el texto se limita a lo visible.
const vis = (l: Locator) => l.filter({ visible: true });
const enlaceFila = (page: Page, activo: string) => page.getByRole("link", { name: new RegExp(`Ver la propuesta de las .*${activo}`) }).first();
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

    test("S2 AC-UX-10: columnas, filtros combinables, conteo y filtro conservado al volver desde S3", async ({ page }) => {
      sembrar("ejecutada-y-rechazada");
      await page.goto("/propuestas");
      await expect(page.getByRole("heading", { name: "4 propuestas" })).toBeVisible();
      await expect(lista(page, m.ancho)).toHaveCount(4);
      if (m.ancho >= 768) {
        const cabeceras = await page.getByRole("columnheader").allTextContents();
        expect(cabeceras.map((c) => c.trim()).filter(Boolean)).toEqual(["Hora (UTC−6)", "Activo", "Proponente", "Lado", "Tamaño", "Decisión", "Estado o motivo", "PnL", "Ver detalle"]);
      }
      const enFilas = lista(page, m.ancho);
      await expect(enFilas.getByText("R3 tamaño: 1,001.00 USD > límite 1,000.00 USD")).toBeVisible();
      await expect(enFilas.getByText("Cerrada por take profit")).toBeVisible();
      await expect(enFilas.getByText("Cerrada por stop loss")).toBeVisible();
      await expect(enFilas.getByText("Abierta", { exact: true })).toBeVisible();
      await capturar(page, m.ancho, "s2_lista");

      // Filtros que se combinan: SOL/USD + Rechazadas → 1; el conteo se actualiza.
      await page.getByRole("button", { name: "SOL/USD", exact: true }).click();
      await expect(page).toHaveURL(/activo=SOL%2FUSD/);
      await expect(page.getByRole("heading", { name: "2 propuestas" })).toBeVisible();
      await page.getByRole("button", { name: "Rechazadas" }).click();
      await expect(page).toHaveURL(/activo=SOL%2FUSD.*decision=rechazada|decision=rechazada.*activo=SOL%2FUSD/);
      await expect(page.getByRole("heading", { name: "1 propuesta", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "SOL/USD", exact: true })).toHaveAttribute("aria-pressed", "true");

      // Al volver desde S3 se conservan los filtros.
      await enlaceFila(page, "SOL/USD").click();
      await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}\?v=/);
      await page.getByRole("main").getByRole("link", { name: "Propuestas", exact: true }).click();
      await expect(page).toHaveURL(/activo=SOL%2FUSD/);
      await expect(page).toHaveURL(/decision=rechazada/);
      await expect(page.getByRole("heading", { name: "1 propuesta", exact: true })).toBeVisible();
    });

    test("S2 AC-UX-10: el filtro de estado (select nativo) y sin coincidencias, con la opción de quitarlo", async ({ page }) => {
      sembrar("ejecutada-y-rechazada");
      await page.goto("/propuestas");
      await page.waitForLoadState("networkidle"); // el <select> envía su formulario con JS: esperar la hidratación
      await page.getByLabel("Estado").selectOption("cerrada_tp");
      await expect(page).toHaveURL(/estado=cerrada_tp/);
      await expect(page.getByRole("heading", { name: "1 propuesta", exact: true })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Estado").selectOption("desconocido");
      await expect(vis(page.getByText("Ninguna propuesta coincide con los filtros."))).toBeVisible();
      await page.getByRole("link", { name: "Quitar los filtros" }).click();
      await expect(page.getByRole("heading", { name: "4 propuestas" })).toBeVisible();
    });

    test("S2 AC-UX-32: dos propuestas rechazadas por el broker, sin PnL y con su opción en el filtro", async ({ page }) => {
      sembrar("rechazada-por-broker");
      await page.goto("/propuestas?estado=rechazada_broker");
      await expect(page.getByRole("heading", { name: "2 propuestas" })).toBeVisible();
      await expect(lista(page, m.ancho).getByText("Rechazada por el broker")).toHaveCount(2);
      const enFilas = lista(page, m.ancho);
      for (const t of ["Abierta", "Pendiente de llenado", "Estado desconocido"]) await expect(enFilas.getByText(t, { exact: true })).toHaveCount(0);
      expect(await page.getByLabel("Estado").locator("option", { hasText: "Rechazada por el broker" }).count()).toBe(1);
      await expect(enFilas.getByText(/[+−]\d[\d,]*\.\d{2} USD/)).toHaveCount(0);
    });

    test("S2 AC-UX-11: la regla principal con su valor y su límite, y +N si hay más", async ({ page }) => {
      sembrar("casos-ac9");
      await page.goto("/propuestas?decision=rechazada");
      const enFilas = lista(page, m.ancho);
      await expect(enFilas.getByText("R3 tamaño: 1,001.00 USD > límite 1,000.00 USD").first()).toBeVisible();
      await expect(enFilas.getByText("R4 exposición").first()).toBeVisible();
      await expect(enFilas.getByText("+1", { exact: true }).first()).toBeVisible();
    });

    test("S3 AC-UX-11, 12 y 25: reglas, respuesta del broker, etiqueta, investigación después del riesgo y ejecución", async ({ page }) => {
      sembrar("ejecutada-y-rechazada");
      await page.goto("/propuestas?decision=ejecutada&activo=BTC%2FUSD&estado=abierta");
      await enlaceFila(page, "BTC/USD").click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/BTC\/USD · Compra/);
      const titulos = await page.locator("main").getByRole("heading", { level: 2 }).allTextContents();
      expect(titulos).toEqual([
        "Regla de entrada evaluada",
        "Reglas de riesgo",
        "Respuesta del broker",
        "Etiqueta de resultado",
        "Investigación adjunta",
        "Ejecución del ciclo",
      ]);
      await expect(vis(page.getByText("Conjunto aplicado: R1 a R11"))).toBeVisible(); // AC-UX-2: ya no dice "R1 a R10" fijo
      await expect(vis(page.getByText("tendencia-sma-v1")).first()).toBeVisible();
      await expect(vis(page.getByText("Señal de compra"))).toBeVisible();
      await expect(vis(page.getByText("Informativa: no interviene en la decisión de entrada"))).toBeVisible();
      await expect(vis(page.getByText(/Antigüedad/))).toBeVisible();
      await expect(vis(page.getByText(/\+0\.65 en escala −1 a 1/))).toBeVisible();
      await expect(vis(page.getByText("Recibida (UTC)"))).toBeVisible();
      await expect(vis(page.getByText(/UTC$/)).first()).toBeVisible();
      await expect(vis(page.getByText("Orden aceptada y llenada"))).toBeVisible();
      await expect(vis(page.getByText("Pendiente", { exact: true }))).toBeVisible();
      await capturar(page, m.ancho, "s3_ejecutada");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });

    test("S3 AC-UX-11: la tabla de reglas lleva las incumplidas primero, con valor y límite", async ({ page }) => {
      sembrar("ejecutada-y-rechazada");
      await page.goto("/propuestas?decision=rechazada");
      await enlaceFila(page, "SOL/USD").click();
      await expect(page.getByRole("heading", { name: "Reglas de riesgo", exact: true })).toBeVisible();
      const regiones = m.ancho >= 768 ? page.getByRole("table", { name: "Reglas de riesgo" }).getByRole("row") : page.getByRole("list", { name: "Reglas de riesgo" }).getByRole("listitem");
      const primera = regiones.nth(m.ancho >= 768 ? 1 : 0);
      await expect(primera).toContainText("R3 tamaño");
      await expect(primera).toContainText("Incumple");
      await expect(primera).toContainText("1,001.00 USD");
      await expect(primera).toContainText("1,000.00 USD");
      await expect(vis(page.getByText("Solo en ventas: cantidad vendida ≤ posición")).first()).toBeVisible();
      await expect(vis(page.getByText("No aplica")).first()).toBeVisible();
      await capturar(page, m.ancho, "s3_rechazada");
      expect(await graves(page)).toEqual([]);
    });

    test("S3 AC-UX-12 y 32: sin investigación; la orden rechazada por el broker y la que nunca llegó", async ({ page }) => {
      sembrar("rechazada-por-broker");
      await page.goto("/propuestas?estado=rechazada_broker");
      await enlaceFila(page, "BTC/USD").click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("BTC/USD · Compra");
      await expect(vis(page.getByText("Orden rechazada por el broker"))).toBeVisible();
      await expect(vis(page.getByText("Código 40310000: insufficient buying power"))).toBeVisible();
      await expect(vis(page.getByText("No se abrió posición. Esta propuesta no tiene PnL."))).toBeVisible();
      await expect(vis(page.getByText("Sin investigación", { exact: true }))).toBeVisible();
      await expect(vis(page.getByText("Informativa: no interviene en la decisión de entrada"))).toBeVisible();
      await expect(vis(page.getByText("Abierta", { exact: true }))).toHaveCount(0);
      await capturar(page, m.ancho, "s3_rechazada-por-el-broker");

      await page.goBack();
      await enlaceFila(page, "SOL/USD").click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("SOL/USD · Compra");
      await expect(vis(page.getByText("La orden no llegó al broker")).first()).toBeVisible();
      await expect(vis(page.getByText("No se abrió posición. Esta propuesta no tiene PnL."))).toBeVisible();
      await expect(vis(page.getByText("Id de orden")).locator("xpath=following-sibling::dd")).toHaveText("—");
      await capturar(page, m.ancho, "s3_orden-no-llego");
      expect(await graves(page)).toEqual([]);
    });

    test("S3: un id que no existe da 404 y la propuesta se abre directo por su dirección", async ({ page }) => {
      sembrar("ejecutada-y-rechazada");
      await page.goto("/propuestas/00000000-0000-4000-8000-000000000000");
      await expect(page.getByRole("heading", { level: 1, name: "No se encontró esta página" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Regla de entrada evaluada" })).toHaveCount(0);
      await page.goto("/propuestas");
      await enlaceFila(page, "BTC/USD").click();
      await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}/);
      const directa = page.url();
      await page.goto(directa);
      await expect(page.getByRole("heading", { name: "Regla de entrada evaluada" })).toBeVisible();
    });

    test("AC-UX-7: base vacía, S2 dice el saldo inicial, la cadencia y la hora de la próxima ejecución e investigación", async ({ page }) => {
      sembrar("vacio");
      await page.goto("/propuestas");
      await expect(vis(page.getByText(/Todavía no hay propuestas\. El saldo inicial es de 10,000\.00 USD\. El ciclo evalúa BTC\/USD y SOL\/USD cada 30 minutos; la próxima ejecución se espera a las \d{2}:(00|30) \(UTC−6\)\. La investigación llega cada hora; la próxima se espera a las \d{2}:15 \(UTC−6\)/))).toBeVisible();
      await expect(page.getByRole("table")).toHaveCount(0);
      await capturar(page, m.ancho, "s2_vacio");
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-19: sin scroll horizontal con los valores más largos y axe sin violaciones serias", async ({ page }) => {
      sembrar("valores-extremos");
      await page.goto("/propuestas");
      await expect(vis(page.getByText("R3 tamaño")).first()).toBeVisible();
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
      await enlaceFila(page, "BTC/USD").click();
      await expect(page.getByRole("heading", { name: "Ejecución del ciclo" })).toBeVisible();
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });
  });
}

test("AC-UX-9: si la lista falla lo dice, los filtros y la banda siguen", async ({ page }) => {
  sembrar("ejecutada-y-rechazada");
  await page.goto(url(PUERTOS.fallaPropuestas) + "/propuestas");
  await expect(vis(page.getByText("No se pudo cargar las propuestas. Estos datos no se muestran; recarga la página para intentar de nuevo."))).toBeVisible();
  await expect(page.getByRole("button", { name: "BTC/USD", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Modo de trading" })).toContainText("Operando");
  await expect(vis(page.getByText(/Falla inyectada/))).toHaveCount(0);
});

test("AC-UX-8: con la red lenta, S2 no muestra cifras mientras carga", async ({ page, context }) => {
  sembrar("ejecutada-y-rechazada");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 });
  const dinero = /\d[\d,]*\.\d{2}\s*USD|\d\s*%|\b0\.00\b/;
  let visto = 0;
  const navegacion = page.goto("/propuestas", { waitUntil: "commit" });
  const fin = Date.now() + 20_000;
  while (Date.now() < fin) {
    const l = await page
      .evaluate(() => ({
        esqueletos: document.querySelectorAll("[data-cargando]").length,
        textos: [...document.querySelectorAll("[aria-busy='true']")].map((e) => (e as HTMLElement).innerText),
      }))
      .catch(() => null);
    if (l && l.esqueletos > 0) {
      visto++;
      for (const t of l.textos) expect(t).not.toMatch(dinero);
    }
    if (l && l.esqueletos === 0 && visto > 0) break;
    await page.waitForTimeout(100);
  }
  await navegacion;
  expect(visto, "debió verse al menos un marcador de carga").toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "4 propuestas" })).toBeVisible({ timeout: 30_000 });
});
