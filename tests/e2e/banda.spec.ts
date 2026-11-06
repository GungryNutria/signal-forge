import { expect, test, type Page } from "@playwright/test";
import { agregarEjecucion, BASE, CREDENCIALES, SIN_BASE, sembrar } from "./ayuda";

// AC-35 (investigación por activo: vigente, vencida y alerta) y AC-37 (ciclo detenido), con escenarios de T-10
// cuyas horas son relativas al momento de sembrar.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const alertas = (page: Page) => page.getByRole("list", { name: "Alertas" });
const filaInvestigacion = (page: Page, activo: string) =>
  page.getByRole("region", { name: "Última investigación por activo", exact: true }).locator("li", { hasText: activo });

test.describe("AC-37: ciclo detenido a los 45 min", () => {
  test("a los 46 min se ve la alerta con la hora de la última ejecución", async ({ page }) => {
    sembrar("ciclo-detenido-46");
    await page.goto("/");
    await expect(alertas(page)).toContainText(/El ciclo no corre desde \d{2}:\d{2} \(UTC−6\) · hace 4\d min/);
  });

  test("a los 44 min no hay alerta", async ({ page }) => {
    sembrar("ciclo-44");
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Última ejecución del ciclo" })).toContainText("hace 44 min");
    await expect(page.getByText("El ciclo no corre")).toHaveCount(0);
  });

  test("con la base vacía se ve el estado vacío y no la alerta", async ({ page }) => {
    sembrar("vacio");
    await page.goto("/");
    await expect(page.getByText("El ciclo aún no tiene ejecuciones registradas.")).toBeVisible();
    await expect(page.getByText("El ciclo no corre")).toHaveCount(0);
    await expect(alertas(page)).toHaveCount(0);
  });
});

test.describe("AC-35: investigación por activo", () => {
  test("a 59 min es Vigente y a 61 min Vencida, sin alerta", async ({ page }) => {
    sembrar("investigacion-59-61");
    await page.goto("/");
    await expect(filaInvestigacion(page, "BTC/USD")).toContainText("Vigente");
    await expect(filaInvestigacion(page, "BTC/USD")).toContainText("hace 59 min");
    await expect(filaInvestigacion(page, "SOL/USD")).toContainText("Vencida");
    await expect(filaInvestigacion(page, "SOL/USD")).toContainText("hace 1 h 1 min");
    await expect(alertas(page)).toHaveCount(0);
  });

  test("SOL/USD a 2 h 1 min y BTC/USD a 30 min: alerta solo para SOL/USD", async ({ page }) => {
    sembrar("investigacion-sol-121-btc-30");
    await page.goto("/");
    await expect(alertas(page)).toContainText(/SOL\/USD: sin investigación aceptada desde \d{2}:\d{2} \(UTC−6\)/);
    await expect(alertas(page)).not.toContainText("BTC/USD");
    await expect(alertas(page).locator("li")).toHaveCount(1);
  });

  test("SOL/USD a 1 h 59 min: Vencida y sin alerta", async ({ page }) => {
    sembrar("investigacion-119");
    await page.goto("/");
    await expect(filaInvestigacion(page, "SOL/USD")).toContainText("Vencida");
    await expect(alertas(page)).toHaveCount(0);
  });

  test("con ejecuciones pero sin ninguna investigación, la alerta nombra cada activo", async ({ page }) => {
    sembrar("vacio");
    await agregarEjecucion("completada", 5);
    await page.goto("/");
    await expect(alertas(page)).toContainText("BTC/USD: sin investigación aceptada");
    await expect(alertas(page)).toContainText("SOL/USD: sin investigación aceptada");
  });
});
