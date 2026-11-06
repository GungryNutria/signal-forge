import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { BASE, CREDENCIALES, SIN_BASE, sembrar } from "./ayuda";

// axe sobre S1 (wcag2a, wcag2aa, wcag21aa y wcag22aa) en las tres medidas y con los escenarios que cambian los colores
// de la banda: 0 violaciones serias o críticas. La suite transversal completa (teclado, 44×44, grises) es T-17.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const MEDIDAS = [
  { ancho: 1280, alto: 800 },
  { ancho: 390, alto: 844 },
  { ancho: 360, alto: 800 },
];
const ESCENARIOS = ["ejecutada-y-rechazada", "vacio", "pausa-auto", "orden-desconocida", "broker-caido", "investigacion-sol-121-btc-30", "inyeccion"];

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });
    for (const escenario of ESCENARIOS) {
      test(`S1 "${escenario}" sin violaciones serias de axe`, async ({ page }) => {
        sembrar(escenario);
        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await expect(page.locator("[data-cargando]")).toHaveCount(0);
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  });
}
