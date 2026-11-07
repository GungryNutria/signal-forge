import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { BASE, capturar, CREDENCIALES, MEDIDAS, PUERTOS, SIN_BASE, sembrar, url, vigilarCarga } from "./ayuda";

// S4 Métricas: AC-22 (UI), AC-UX-7, 8, 9, 16 a 19 y 22 en las tres medidas, con los valores calculados a mano de
// `metricas-conocidas` (scripts/sembrar.ts > METRICAS_CONOCIDAS).
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const vis = (l: Locator) => l.filter({ visible: true });
const tarjeta = (page: Page, titulo: string) =>
  page.locator("main div").filter({ has: page.getByRole("heading", { name: titulo, exact: true }) }).last();
const sinScrollHorizontal = async (page: Page) => {
  const a = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(a.s).toBeLessThanOrEqual(a.c);
};
const graves = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
};
const diaTorreon = (dias: number, horaUtc: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  d.setUTCHours(horaUtc, 0, 0, 0);
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Monterrey", day: "numeric", month: "short" }).format(d).replace(/\./g, "");
};
/** Espera a que las gráficas estén dibujadas (Recharts mide en el navegador). */
const graficasListas = (page: Page) => expect(page.locator("svg.recharts-surface")).toHaveCount(2, { timeout: 15_000 });

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test("AC-22, AC-UX-17 y 18: cada métrica con su valor, su periodo o denominador y su ámbito", async ({ page }) => {
      sembrar("metricas-conocidas");
      await page.goto("/metricas");
      const pnl = tarjeta(page, "PnL realizado");
      await expect(pnl).toContainText("+2.40 USD");
      await expect(pnl).toContainText(/\+0\.02\s%\sdel saldo inicial, del \d+ \w+ al \d+ \w+/);
      await expect(pnl).toContainText("Sigue el filtro: Todos");
      const tasa = tarjeta(page, "Tasa de aciertos");
      await expect(tasa).toContainText(/42\.9\s%/);
      await expect(tasa).toContainText("3 de 7 entradas cerradas");
      const dd = tarjeta(page, "Drawdown máximo");
      await expect(dd).toContainText(/−0\.25\s%/);
      await expect(dd).toContainText(`del ${diaTorreon(2, 15)} al ${diaTorreon(1, 14)}`);
      await expect(dd).toContainText("sobre saldo realizado");
      await expect(dd).toContainText("cartera global");
      const ap = tarjeta(page, "Aprobadas y rechazadas");
      await expect(ap).toContainText("7 / 4");
      await expect(ap).toContainText("7 aprobadas, 4 rechazadas");
      await expect(ap).toContainText("de 11 propuestas");
      const curva = tarjeta(page, "Curva de saldo");
      await expect(curva).toContainText("sobre saldo realizado");
      await expect(curva).toContainText("cartera global");
      await expect(tarjeta(page, "PnL diario")).toContainText("día UTC");
      await graficasListas(page);
      await capturar(page, m.ancho, "s4_metricas");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-18: el filtro cambia PnL, tasa y aprobadas; la curva y el drawdown no cambian", async ({ page }) => {
      sembrar("metricas-conocidas");
      await page.goto("/metricas");
      const dd = await tarjeta(page, "Drawdown máximo").innerText();
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "BTC/USD", exact: true }).click();
      await expect(page).toHaveURL(/activo=BTC%2FUSD/);
      await expect(tarjeta(page, "PnL realizado")).toContainText("+9.90 USD");
      await expect(tarjeta(page, "PnL realizado")).toContainText("Sigue el filtro: BTC/USD");
      await expect(tarjeta(page, "Tasa de aciertos")).toContainText(/50\.0\s%/);
      await expect(tarjeta(page, "Tasa de aciertos")).toContainText("2 de 4 entradas cerradas");
      await expect(tarjeta(page, "Aprobadas y rechazadas")).toContainText("4 / 2");
      expect(await tarjeta(page, "Drawdown máximo").innerText()).toBe(dd);
      await expect(tarjeta(page, "Curva de saldo")).toContainText("cartera global");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "SOL/USD", exact: true }).click();
      await expect(tarjeta(page, "PnL realizado")).toContainText("−7.50 USD");
      await expect(tarjeta(page, "Tasa de aciertos")).toContainText(/33\.3\s%/);
      await expect(tarjeta(page, "Aprobadas y rechazadas")).toContainText("3 / 1");
      expect(await tarjeta(page, "Drawdown máximo").innerText()).toBe(dd);
      await graficasListas(page);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-17: los valores de cada punto se consultan con el teclado y con el puntero", async ({ page }) => {
      sembrar("metricas-conocidas");
      await page.goto("/metricas");
      await graficasListas(page);
      for (const [nombre, texto] of [
        ["Curva de saldo realizado de la cartera global", /Saldo [\d,]+\.\d{2} USD · [+−]\d[\d,]*\.\d{2} USD/],
        ["PnL diario por día UTC", /PnL del día [+−]\d[\d,]*\.\d{2} USD/],
      ] as const) {
        const grafica = page.getByRole("group", { name: nombre });
        await expect(grafica).toBeVisible();
        // Nombre accesible y alcanzable con el teclado.
        const svg = grafica.locator("svg.recharts-surface");
        await svg.focus();
        await page.keyboard.press("ArrowRight");
        const consulta = page.getByRole("status").filter({ hasText: texto });
        await expect(consulta).toBeVisible();
        const primera = await consulta.innerText();
        // Las flechas mueven la consulta al punto siguiente.
        await page.keyboard.press("ArrowRight");
        await expect.poll(async () => consulta.innerText()).not.toBe(primera);
      }
      // Los valores también están en texto, sin ver la gráfica.
      await expect(page.getByRole("table", { name: "Saldo tras cada cierre" }).getByRole("row")).toHaveCount(7);
      await expect(page.getByRole("table", { name: "PnL de cada día UTC" }).getByRole("row")).toHaveCount(3);
      if (m.ancho >= 768) {
        const caja = await page.getByRole("group", { name: "Curva de saldo realizado de la cartera global" }).boundingBox();
        await page.mouse.move(caja!.x + caja!.width * 0.6, caja!.y + caja!.height * 0.5);
        await expect(page.getByRole("status").filter({ hasText: /Saldo [\d,]+\.\d{2} USD/ })).toBeVisible();
        await capturar(page, m.ancho, "s4_consulta");
      }
    });

    test("AC-UX-7: base vacía, S4 explica el saldo inicial, la cadencia y la próxima ejecución, sin 0 % ni gráficas vacías", async ({ page }) => {
      sembrar("vacio");
      await page.goto("/metricas");
      await expect(page.getByText(/Aún no hay datos\. Saldo inicial: 10,000\.00 USD\. El ciclo evalúa BTC\/USD y SOL\/USD cada 30 minutos; la próxima ejecución se espera a las \d{2}:(00|30) \(UTC−6\)\. La investigación llega cada hora; la próxima, a las \d{2}:15 \(UTC−6\)/)).toBeVisible();
      await expect(page.getByText("0 entradas cerradas")).toBeVisible();
      await expect(page.getByRole("main").getByText("—", { exact: true })).toBeVisible();
      await expect(page.locator("svg.recharts-surface")).toHaveCount(0);
      await expect(page.getByText(/(^|\s)0\s?%/)).toHaveCount(0);
      await capturar(page, m.ancho, "s4_vacio");
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-7: con propuestas pero sin cierres, la curva dice 'Sin datos suficientes' y la tasa va con raya", async ({ page }) => {
      sembrar("rechazada-por-broker");
      await page.goto("/metricas");
      await expect(vis(page.getByText("Sin datos suficientes")).first()).toBeVisible();
      await expect(tarjeta(page, "Tasa de aciertos")).toContainText("0 entradas cerradas");
      await expect(tarjeta(page, "Tasa de aciertos")).toContainText("—");
      await expect(page.locator("svg.recharts-surface")).toHaveCount(0);
      await capturar(page, m.ancho, "s4_sin-datos");
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-19 y 23: sin scroll horizontal con importes enormes y cantidades diminutas", async ({ page }) => {
      sembrar("valores-extremos");
      await page.goto("/metricas");
      await expect(tarjeta(page, "PnL realizado")).toContainText(/\+123,\d{3}\.\d{2} USD/);
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });
  });
}

test.describe("toque (AC-UX-17)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("un toque sobre un punto de la curva abre su consulta", async ({ page }) => {
    sembrar("metricas-conocidas");
    await page.goto("/metricas");
    await expect(page.locator("svg.recharts-surface")).toHaveCount(2, { timeout: 15_000 });
    const grafica = page.getByRole("group", { name: "Curva de saldo realizado de la cartera global" });
    await grafica.scrollIntoViewIfNeeded();
    const punto = await grafica.locator("circle").nth(2).boundingBox();
    expect(punto, "debe haber puntos dibujados").not.toBeNull();
    await page.touchscreen.tap(punto!.x + punto!.width / 2, punto!.y + punto!.height / 2);
    await expect(page.getByRole("status").filter({ hasText: /Saldo [\d,]+\.\d{2} USD/ })).toBeVisible();
    await capturar(page, 390, "s4_consulta-toque");
  });
});

test("AC-UX-9: si la lectura falla lo dice, los filtros y la banda siguen", async ({ page }) => {
  sembrar("metricas-conocidas");
  await page.goto(url(PUERTOS.fallaMetricas) + "/metricas");
  await expect(vis(page.getByText("No se pudo cargar las métricas. Estos datos no se muestran; recarga la página para intentar de nuevo."))).toBeVisible();
  await expect(page.getByRole("button", { name: "BTC/USD", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Modo de trading" })).toContainText("Operando");
  await expect(page.getByText(/Falla inyectada/)).toHaveCount(0);
});

test("AC-UX-8: con la red lenta, S4 no muestra cifras mientras carga", async ({ page, context }) => {
  sembrar("metricas-conocidas");
  const { visto, textosConDato } = await vigilarCarga(page, context, "/metricas");
  expect(visto, "debió verse al menos un marcador de carga").toBeGreaterThan(0);
  expect(textosConDato).toEqual([]);
  await expect(tarjeta(page, "PnL realizado")).toContainText("+2.40 USD", { timeout: 30_000 });
});
