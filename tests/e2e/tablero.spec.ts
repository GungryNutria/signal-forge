import { expect, test } from "@playwright/test";
import { BASE, CREDENCIALES, MEDIDAS, SIN_BASE, sembrar } from "./ayuda";

// AC-21 (S2 y S3): el tablero muestra lo sembrado y solo lee. AC-UX-14 y AC-UX-21 en esas dos superficies.
// T-16 agrega aquí la parte de S4 y S5.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test("AC-21: la ejecutada, la rechazada y las cerradas aparecen en S2 y se abren en S3", async ({ page }) => {
      sembrar("ejecutada-y-rechazada");
      await page.goto("/propuestas");
      await expect(page.getByRole("heading", { name: "4 propuestas" })).toBeVisible();
      for (const texto of ["Ejecutada", "Rechazada", "Abierta", "Cerrada por take profit", "Cerrada por stop loss"]) {
        await expect(page.getByText(texto, { exact: true }).filter({ visible: true }).first()).toBeVisible();
      }
      for (const activo of ["BTC/USD", "SOL/USD"]) {
        await page.goto("/propuestas");
        await page.getByRole("link", { name: new RegExp(`Ver la propuesta de las .*${activo}`) }).first().click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText(activo);
        await expect(page.getByRole("heading", { name: "Regla de entrada evaluada" })).toBeVisible();
      }
    });

    test("AC-UX-14: desde S1, la regla evaluada está a 1 toque y el motivo de un rechazo a 2 o menos", async ({ page }) => {
      sembrar("ejecutada-y-rechazada");
      await page.goto("/");
      // 1 toque: la última propuesta → su detalle con la regla de entrada.
      await page.getByRole("link", { name: /Ver la propuesta de las .*BTC\/USD/ }).first().click();
      await expect(page.getByRole("heading", { name: "Regla de entrada evaluada" })).toBeVisible();
      // La rechazada: 1 toque desde S1 y su motivo en la fila de S2/S3.
      await page.goto("/");
      await page.getByRole("link", { name: /Ver la propuesta de las .*SOL\/USD/ }).first().click();
      await expect(page.getByText("R3 tamaño").filter({ visible: true }).first()).toBeVisible();
    });

    test("AC-UX-21: S2 y S3 solo tienen navegación, filtros y enlaces a fuentes", async ({ page }) => {
      sembrar("ejecutada-y-rechazada");
      const prohibidos = /pausar|cerrar posición|reintentar|ejecutar ciclo|pedir investigación/i;
      await page.goto("/propuestas");
      await expect(page.getByRole("heading", { name: "4 propuestas" })).toBeVisible();
      for (const b of await page.locator("main").getByRole("button").all()) expect((await b.innerText()).trim()).not.toMatch(prohibidos);
      expect(await page.locator("main form:visible").evaluateAll((fs) => fs.map((f) => (f as HTMLFormElement).method))).toEqual(["get", "get", "get"]);
      await page.getByRole("link", { name: /Ver la propuesta de las .*BTC\/USD/ }).first().click();
      await expect(page.getByRole("heading", { name: "Regla de entrada evaluada" })).toBeVisible();
      await expect(page.locator("main").getByRole("button")).toHaveCount(0);
      expect(await page.locator("main form:visible").count()).toBe(0);
    });
  });
}
