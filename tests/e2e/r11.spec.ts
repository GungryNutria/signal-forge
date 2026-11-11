import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { BASE, capturar, CREDENCIALES, MEDIDAS, PUERTOS, SIN_BASE, sembrar, url } from "./ayuda";

// Spec 003, R11 (T-4): AC-11, AC-16 y AC-UX-1 a 7 y 10 en S1 a S5 y en la banda, a 1280, 390 y 360 px. Los textos son los
// del vocabulario fijo de DESIGN.md; los conteos de S4 se calcularon a mano sobre las semillas `r11-*`.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const TEXTO_S2 = "R11 entradas abiertas de BTC/USD: 2 > límite 1";
const TEXTO_BANDA = "Propuesta: Rechazada (R11 entradas abiertas)";

// Next conserva la ruta anterior oculta en el DOM: lo que se afirma sobre el texto se limita a lo visible.
const vis = (l: Locator) => l.filter({ visible: true });
/** Las filas visibles de S2: tabla en escritorio, tarjetas en móvil. */
const lista = (page: Page, ancho: number) =>
  ancho >= 768 ? page.locator("table tbody tr").filter({ visible: true }) : page.getByRole("list", { name: "Propuestas" }).getByRole("listitem");
const sinScrollHorizontal = async (page: Page) => {
  const a = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(a.s).toBeLessThanOrEqual(a.c);
};
const graves = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
};
/** Abre en S3 la n-ésima fila de S2 (de la más reciente a la más antigua) que contiene el texto. */
async function abrir(page: Page, ancho: number, texto: string | RegExp, n = 0) {
  await page.goto("/propuestas");
  await vis(lista(page, ancho).filter({ hasText: texto }).nth(n).getByRole("link", { name: /Ver la propuesta de las/ })).click();
  await expect(page.getByRole("heading", { name: "Reglas de riesgo", exact: true })).toBeVisible();
}
/** La fila (o tarjeta) de una regla en la tabla de S3. */
const reglaS3 = (page: Page, ancho: number, regla: string) =>
  (ancho >= 768 ? page.getByRole("table", { name: "Reglas de riesgo" }).getByRole("row") : page.getByRole("list", { name: "Reglas de riesgo" }).getByRole("listitem")).filter({
    hasText: new RegExp(`^${regla} `),
  });
/** Grises: el estado "No evaluada" tiene que distinguirse sin color (AC-UX-3). */
const aGrises = (page: Page) => page.addStyleTag({ content: "html{filter:grayscale(1)}" });

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test("AC-16, AC-UX-1: S2 muestra R11 con su valor y su límite; con otra regla incumplida la principal sigue el criterio de R1 a R10 y se ve +1", async ({ page }) => {
      sembrar("r11-casos");
      await page.goto("/propuestas");
      const filas = lista(page, m.ancho);
      await expect(filas.filter({ hasText: TEXTO_S2 })).toHaveCount(1);
      // R8 y R11 incumplidas: la principal es la de número menor (R8) y R11 cuenta en "+1".
      const doble = filas.filter({ hasText: "R8 pausa manual" });
      await expect(doble).toHaveCount(1);
      await expect(doble).toContainText("+1");
      await expect(doble).not.toContainText("R11 entradas abiertas de");
      await capturar(page, m.ancho, "s2_r11");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-16, AC-UX-2: S3 titula la tabla sin R1 a R10 fijo, indica el conjunto aplicado y desglosa R11 con las incumplidas primero", async ({ page }) => {
      test.setTimeout(90_000); // tres propuestas, capturas y axe
      sembrar("r11-casos");
      await abrir(page, m.ancho, TEXTO_S2);
      await expect(vis(page.getByText("Conjunto aplicado: R1 a R11"))).toBeVisible();
      await expect(page.locator("main").getByText("R1 a R10")).toHaveCount(0);
      const primera = ((m.ancho >= 768 ? page.getByRole("table", { name: "Reglas de riesgo" }).getByRole("row") : page.getByRole("list", { name: "Reglas de riesgo" }).getByRole("listitem"))).nth(m.ancho >= 768 ? 1 : 0);
      await expect(primera).toContainText("R11 entradas abiertas por activo");
      await expect(primera).toContainText("Incumple");
      await expect(primera).toContainText("1 abierta + esta propuesta = 2 · límite 1");
      await capturar(page, m.ancho, "s3_r11_incumple");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);

      // Aprobada: R11 Cumple, con 0 abiertas (la entrada que ella misma abre no cuenta antes de ejecutarse).
      await abrir(page, m.ancho, /Abierta/);
      const cumple = reglaS3(page, m.ancho, "R11");
      await expect(cumple).toContainText("Cumple");
      await expect(cumple).toContainText("0 abiertas + esta propuesta = 1 · límite 1");
      await capturar(page, m.ancho, "s3_r11_cumple");

      // Venta: R11 no aplica.
      await abrir(page, m.ancho, "Venta no habilitada");
      await expect(reglaS3(page, m.ancho, "R11")).toContainText("No aplica");
    });

    test("AC-11, AC-UX-3: una propuesta anterior a R11 se ve con R11 No evaluada, en neutro, con texto propio y sin pasar por cumplida ni incumplida", async ({ page }) => {
      sembrar("r11-anterior");
      for (const [texto, captura] of [["Rechazada", "s3_r11_no_evaluada_rechazada"], ["Ejecutada", "s3_r11_no_evaluada_ejecutada"]] as const) {
        await abrir(page, m.ancho, texto);
        await expect(vis(page.getByText("Conjunto aplicado: R1 a R10"))).toBeVisible();
        const fila = reglaS3(page, m.ancho, "R11");
        await expect(fila).toContainText("R11 entradas abiertas por activo");
        await expect(fila).toContainText("No evaluada");
        await expect(fila).toContainText("Esta propuesta se evaluó con R1 a R10");
        await expect(fila).not.toContainText(/Cumple|Incumple|No aplica/);
        // Neutro: el chip no lleva el color de resultado (verde de Cumple, rojo de Incumple).
        const chip = fila.getByText("No evaluada", { exact: true });
        await expect(chip.locator("..")).toHaveClass(/border-strong/);
        await expect(chip.locator("..")).not.toHaveClass(/border-pos|border-neg|bg-neg-bg/);
        await capturar(page, m.ancho, captura);
        await aGrises(page);
        await capturar(page, m.ancho, `${captura}_grises`);
        await sinScrollHorizontal(page);
      }
      // En ningún lugar aparece como cumplida o incumplida: S2 y S4 no la nombran como R11 evaluada.
      await page.goto("/propuestas");
      await expect(page.locator("main").getByText(/R11 entradas abiertas de/)).toHaveCount(0);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-16, AC-UX-4: S4 cuenta el rechazo bajo R11, respeta el filtro de activo y dice No evaluada en este periodo si ninguna se evaluó con R11", async ({ page }) => {
      const motivos = (p: Page) => vis(p.locator("[data-rechazos-por-motivo]"));
      // A mano: 1 aprobada y 2 rechazadas (R11 sola y R8 + R11, que cuenta bajo R8, la primera incumplida). La venta es un error, no un rechazo.
      sembrar("r11-casos");
      await page.goto("/metricas");
      await expect(page.getByText("Aprobadas 1 (33.3 %)")).toBeVisible();
      await expect(page.getByText("Rechazadas 2 (66.7 %)")).toBeVisible();
      await expect(motivos(page).locator("li", { hasText: "R11 entradas abiertas por activo" })).toContainText("1");
      await expect(motivos(page).locator("li", { hasText: "R8 pausa manual" })).toContainText("1");
      await expect(motivos(page)).not.toContainText("No evaluada en este periodo");
      await capturar(page, m.ancho, "s4_r11");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
      // El filtro de activo: todo es de BTC/USD, así que SOL/USD no tiene propuestas.
      await page.getByRole("button", { name: "BTC/USD", exact: true }).click();
      await expect(page).toHaveURL(/activo=BTC%2FUSD/);
      await expect(motivos(page).locator("li", { hasText: "R11 entradas abiertas por activo" })).toContainText("1");
      await page.getByRole("button", { name: "SOL/USD", exact: true }).click();
      await expect(page).toHaveURL(/activo=SOL%2FUSD/);
      await expect(page.getByText("Todavía no hay propuestas aprobadas ni rechazadas.")).toBeVisible();

      // Antes de R11: ninguna propuesta se evaluó con ella, así que no dice 0.
      sembrar("r11-anterior");
      await page.goto("/metricas");
      await expect(motivos(page).locator("li", { hasText: "R11 entradas abiertas por activo" })).toContainText("No evaluada en este periodo");
      await expect(motivos(page).locator("li", { hasText: "R11 entradas abiertas por activo" })).not.toContainText(/\b0\b/);
      await expect(motivos(page).locator("li", { hasText: "R3 tamaño" })).toContainText("1");
      await capturar(page, m.ancho, "s4_r11_no_evaluada");
    });

    test("AC-UX-5: la banda y S5 llevan la regla principal junto a Rechazada, en neutro y sin estilo de alerta", async ({ page }) => {
      // Banda con el rechazo más reciente por R11 (decisor simulado).
      sembrar("r11-dos-proponentes");
      await page.goto("/");
      const banda = page.getByRole("region", { name: "Última ejecución del ciclo" });
      const chipBanda = vis(banda.getByText(TEXTO_BANDA, { exact: true }));
      await expect(chipBanda).toBeVisible();
      await expect(chipBanda.locator("..")).toHaveClass(/border-strong/);
      await expect(chipBanda.locator("..")).not.toHaveClass(/bg-neg-bg|bg-warn-bg|border-l-\[3px\]/);
      await capturar(page, m.ancho, "banda_r11");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);

      // S5 con R11 y con R8 (el patrón es el mismo para todas las reglas).
      sembrar("r11-casos");
      await page.goto("/ejecuciones");
      await expect(vis(page.getByText(TEXTO_BANDA, { exact: true }))).toHaveCount(1);
      await expect(vis(page.getByText("Propuesta: Rechazada (R8 pausa manual)", { exact: true }))).toHaveCount(1);
      await expect(vis(page.getByText("Propuesta: Rechazada (R8 pausa manual)", { exact: true })).locator("..")).not.toHaveClass(/bg-neg-bg|bg-warn-bg/);
      await capturar(page, m.ancho, "s5_r11");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
    });

    test("AC-UX-6: S1 muestra cuántas entradas abiertas hay frente al tope, neutro y sin alerta, con N = 1 y N = 2", async ({ page }) => {
      sembrar("r11-tope");
      // N = 1 (por defecto): BTC/USD y SOL/USD están en el tope o por encima.
      await page.goto("/");
      const entradas = vis(page.locator("[data-entradas-abiertas]"));
      await expect(entradas.locator("li", { hasText: "BTC/USD" })).toHaveText("BTC/USD · 3 entradas abiertas · tope 1: las entradas nuevas se rechazan por R11");
      await expect(entradas.locator("li", { hasText: "SOL/USD" })).toHaveText("SOL/USD · 1 entrada abierta · tope 1: las entradas nuevas se rechazan por R11");
      await expect(entradas.locator("li")).toHaveCount(2);
      await expect(entradas.locator("[role='alert'], [role='status']")).toHaveCount(0);
      await capturar(page, m.ancho, "s1_tope1");
      await sinScrollHorizontal(page);
      expect(await graves(page)).toEqual([]);
      // N = 2: SOL/USD queda bajo el tope y ya no dice que se rechazan.
      await page.goto(url(PUERTOS.tope2));
      const con2 = vis(page.locator("[data-entradas-abiertas]"));
      await expect(con2.locator("li", { hasText: "BTC/USD" })).toHaveText("BTC/USD · 3 entradas abiertas · tope 2: las entradas nuevas se rechazan por R11");
      await expect(con2.locator("li", { hasText: "SOL/USD" })).toHaveText("SOL/USD · 1 entrada abierta · tope 2");
      await capturar(page, m.ancho, "s1_tope2");
      // Sin entradas abiertas no hay renglones por activo.
      sembrar("vacio");
      await page.goto("/");
      await expect(page.locator("[data-entradas-abiertas]")).toHaveCount(0);
    });

    test("AC-UX-7: un rechazo por R11 dice lo mismo en S2, S3, S4, S5 y la banda sin importar el proponente", async ({ page }) => {
      sembrar("r11-dos-proponentes");
      await page.goto("/propuestas");
      await expect(lista(page, m.ancho).filter({ hasText: TEXTO_S2 })).toHaveCount(2);
      for (const n of [0, 1]) {
        await abrir(page, m.ancho, TEXTO_S2, n);
        const fila = reglaS3(page, m.ancho, "R11");
        await expect(fila).toContainText("Incumple");
        await expect(fila).toContainText("1 abierta + esta propuesta = 2 · límite 1");
      }
      await page.goto("/ejecuciones");
      await expect(vis(page.getByText(TEXTO_BANDA, { exact: true }))).toHaveCount(3); // las dos filas de S5 y la banda del encabezado
      await page.goto("/metricas");
      await expect(vis(page.locator("[data-rechazos-por-motivo]")).locator("li", { hasText: "R11 entradas abiertas por activo" })).toContainText("2");
      await page.goto("/");
      await expect(vis(page.getByRole("region", { name: "Última ejecución del ciclo" }).getByText(TEXTO_BANDA, { exact: true }))).toBeVisible();
      await capturar(page, m.ancho, "inicio_dos_proponentes");
    });
  });
}
