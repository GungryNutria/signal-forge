import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { BASE, capturar, CREDENCIALES, deslizamientoConocido, MEDIDAS, SIN_BASE, sembrar, type CierreConocido } from "./ayuda";

// Spec 003, S3 (T-4): AC-17, AC-UX-8, 9 y 10. El bloque "Salida de la operación" de una operación cerrada por stop loss o take
// profit, con los valores calculados a mano de DESLIZAMIENTO_CONOCIDO (scripts/sembrar.ts).
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const K = BASE ? deslizamientoConocido() : null;

const vis = (l: Locator) => l.filter({ visible: true });
const lista = (page: Page, ancho: number) =>
  ancho >= 768 ? page.locator("table tbody tr").filter({ visible: true }) : page.getByRole("list", { name: "Propuestas" }).getByRole("listitem");
const sinScrollHorizontal = async (page: Page) => {
  const a = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(a.s).toBeLessThanOrEqual(a.c);
};
const graves = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag22aa", "wcag21aa"]).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
};
/** Abre en S3 la n-ésima fila de S2 (de la más reciente a la más antigua) que contiene el texto. */
async function abrir(page: Page, ancho: number, texto: string | RegExp, n = 0, titulo = "BTC/USD") {
  await page.goto("/propuestas");
  await vis(lista(page, ancho).filter({ hasText: texto }).nth(n).getByRole("link", { name: /Ver la propuesta de las/ })).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(titulo);
}
const usd = (n: number) => `${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
const conSigno = (v: string) => `${Number(v) < 0 ? "−" : "+"}${usd(Number(v))}`;
const pct = (frac: string) => `${Number(frac) < 0 ? "−" : "+"}${Math.abs(Number(frac) * 100).toFixed(2)} %`;

async function afirmarSalida(page: Page, c: CierreConocido, nivel: "Stop loss" | "Take profit") {
  await expect(page.getByRole("heading", { name: "Salida de la operación", exact: true })).toBeVisible();
  const salida = page.locator("section, div").filter({ has: page.getByRole("heading", { name: "Salida de la operación", exact: true }) }).last();
  // Orden de AC-UX-8: nivel tocado, precio que disparó, precio de llenado y desglose.
  const etiquetas = await salida.locator("dt").allTextContents();
  expect(etiquetas.map((t) => t.trim().replace(/ /g, " "))).toEqual([
    `Nivel tocado: ${nivel}`,
    "Precio que disparó la salida",
    "Precio de llenado",
    "Movimiento hasta el nivel",
    "Deslizamiento de precio (sin comisiones)",
    "Comisión modelada (entrada y salida)",
    "PnL neto",
  ]);
  const valores = (await salida.locator("dd").allTextContents()).map((t) => t.trim().replace(/ /g, " "));
  expect(valores[0]).toBe(usd(Number(c.nivel)));
  expect(valores[2]).toBe(usd(Number(c.llenado)));
  expect(valores[3]).toBe(`${conSigno(c.movimientoUsd)} · ${pct(c.movimientoPct)}`);
  expect(valores[4]).toBe(`${conSigno(c.deslizamientoUsd)} · ${pct(c.deslizamientoPct)}`);
  expect(valores[5]).toBe(`${conSigno(c.comisionUsd)} · ${pct(c.comisionPct)}`);
  expect(valores[6]).toBe(`${conSigno(c.pnlNetoUsd)} · ${pct(c.pnlNetoPct)}`);
  // B-1: la Etiqueta de resultado muestra el mismo porcentaje que el desglose (pnl_neto_pct se guarda como fracción).
  const etiqueta = page.locator("section, div").filter({ has: page.getByRole("heading", { name: "Etiqueta de resultado", exact: true }) }).last();
  await expect(etiqueta).toContainText(`${conSigno(c.pnlNetoUsd)} (${pct(c.pnlNetoPct)})`);
  // Los tres primeros renglones suman el PnL neto mostrado (hasta 0.01 USD por redondeo).
  const usdDe = (t: string) => Number(t.split(" USD")[0].replace("−", "-").replace("+", "").replace(/,/g, ""));
  const suma = usdDe(valores[3]) + usdDe(valores[4]) + usdDe(valores[5]);
  expect(Math.abs(suma - usdDe(valores[6]))).toBeLessThanOrEqual(0.01);
  // AC-UX-9: el deslizamiento va con signo y en tinta neutra; solo el PnL neto usa los colores de dinero.
  const dd = salida.locator("dd");
  await expect(dd.nth(4)).not.toHaveClass(/text-neg|text-pos/);
  await expect(dd.nth(3)).not.toHaveClass(/text-neg|text-pos/);
  await expect(dd.nth(5)).not.toHaveClass(/text-neg|text-pos/);
  await expect(dd.nth(6)).toHaveClass(Number(c.pnlNetoUsd) < 0 ? /text-neg/ : /text-pos/);
  await expect(salida.locator("[role='alert'], [role='status']")).toHaveCount(0);
  return valores;
}

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test("AC-17, AC-UX-8, 9: un stop loss muestra nivel, disparo con su hora, llenado y el desglose con el deslizamiento separado de la comisión", async ({ page }) => {
      sembrar("deslizamiento");
      // De la más reciente a la más antigua: el stop anterior a la medición (hace 120 min), el take profit y el stop medido (240).
      await abrir(page, m.ancho, "Cerrada por stop loss", 1);
      const llenadoMedido = await page.getByText("Precio de llenado").locator("..").textContent();
      expect(llenadoMedido).toContain(usd(Number(K!.stop.llenado)));
      const valores = await afirmarSalida(page, K!.stop, "Stop loss");
      expect(valores[1]).toMatch(new RegExp(`^${usd(Number(K!.stop.disparo))} · \\d{1,2} \\w+, \\d{2}:\\d{2}:\\d{2} \\(UTC−6\\) · \\d{1,2} \\w+, \\d{2}:\\d{2}:\\d{2} UTC$`));
      await expect(page.getByRole("heading", { name: "Etiqueta de resultado", exact: true })).toBeVisible();
      await expect(page.locator("main")).toContainText("(−2.99 %)"); // B-1: del stop sembrado, no −0.03 %
      await capturar(page, m.ancho, "s3_salida_stop");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-8: un take profit muestra su nivel y un deslizamiento a favor con signo positivo", async ({ page }) => {
      sembrar("deslizamiento");
      await abrir(page, m.ancho, "Cerrada por take profit");
      const valores = await afirmarSalida(page, K!.takeProfit, "Take profit");
      expect(valores[4].startsWith("+")).toBe(true);
      await capturar(page, m.ancho, "s3_salida_tp");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-8: un cierre anterior a la medición dice que el disparo no se registró y aun así desglosa el PnL", async ({ page }) => {
      sembrar("deslizamiento");
      await abrir(page, m.ancho, "Cerrada por stop loss", 0);
      expect(await page.getByText("Precio de llenado").locator("..").textContent()).toContain(usd(Number(K!.anterior.llenado)));
      const valores = await afirmarSalida(page, K!.anterior, "Stop loss");
      expect(valores[1]).toBe("No registrado: el cierre es anterior a esta medición");
      await capturar(page, m.ancho, "s3_salida_anterior");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-9: sin bloque de salida en operaciones abiertas, pendientes, rechazadas por el broker y en estado desconocido", async ({ page }) => {
      for (const [escenario, estado] of [
        ["ejecutada-y-rechazada", /Abierta/],
        ["rechazada-por-broker", "Rechazada por el broker"],
        ["orden-desconocida", "Estado desconocido"],
      ] as const) {
        sembrar(escenario);
        await abrir(page, m.ancho, estado, 0, "/USD");
        await expect(page.getByRole("heading", { name: "Respuesta del broker", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Salida de la operación" })).toHaveCount(0);
        await expect(page.locator("main").getByText("Deslizamiento")).toHaveCount(0);
      }
    });
  });
}
