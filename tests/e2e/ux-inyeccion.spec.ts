import { expect, test } from "@playwright/test";
import { BASE, CREDENCIALES, MEDIDAS, SIN_BASE, sembrar } from "./ayuda";

// AC-UX-13 en S3: el resumen y las fuentes de la investigación con marcado u hostiles se ven como texto literal,
// no ejecutan nada, y cada fuente muestra su dominio real y se abre fuera del tablero (solo http y https).
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test("S3 con la investigación hostil: texto literal, nada se ejecuta y las fuentes muestran su dominio", async ({ page }) => {
      sembrar("inyeccion");
      const dialogos: string[] = [];
      page.on("dialog", async (d) => {
        dialogos.push(d.message());
        await d.dismiss();
      });
      await page.goto("/propuestas");
      await page.getByRole("link", { name: /Ver la propuesta de las .*BTC\/USD/ }).first().click();
      const bloque = page.getByRole("region", { name: "Investigación adjunta" });
      await expect(bloque).toBeVisible();

      // El marcado se muestra como texto: no hay elementos creados a partir de él.
      await expect(bloque).toContainText("<img src=x onerror=alert(1)>");
      await expect(bloque).toContainText("<script>alert('xss-1')</script>");
      await expect(bloque).toContainText('"><img src=x onerror=alert("xss-2")>');
      await expect(bloque).toContainText("javascript:alert('xss-3')");
      expect(await bloque.locator("img, script, iframe, svg[onload]").count()).toBe(0);
      expect(await page.locator("main img").count()).toBe(0);

      // Fuentes: dominio real; solo http(s) es enlace, abierto fuera del tablero.
      const enlaces = bloque.getByRole("link");
      await expect(enlaces).toHaveCount(2);
      for (const e of await enlaces.all()) {
        await expect(e).toHaveAttribute("target", "_blank");
        await expect(e).toHaveAttribute("rel", "noopener noreferrer");
        expect(await e.getAttribute("href")).toMatch(/^https?:\/\//);
      }
      await expect(enlaces.nth(0)).toHaveText(/^example\.com/);
      await expect(enlaces.nth(1)).toHaveText(/^evil\.example/);
      await expect(bloque.getByText("(no es un enlace http o https)")).toBeVisible();
      expect(await page.locator("a[href^='javascript:' i]").count()).toBe(0);

      await page.waitForTimeout(500);
      expect(dialogos, "ningún alert() se ejecutó").toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)).toBeUndefined();
    });
  });
}
