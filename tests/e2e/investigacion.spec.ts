import { expect, test, type Page } from "@playwright/test";
import { BASE, CREDENCIALES, SIN_BASE, sembrar } from "./ayuda";

// AC-UX-24, 25 y 26 en S1 (el orden en S3 lo cubre T-15), y la parte de S1 de AC-UX-13: texto literal de terceros.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const bloque = (page: Page) => page.getByRole("region", { name: "Investigación", exact: true });
const activo = (page: Page, nombre: string) => bloque(page).locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${nombre}`) }) });

test("AC-UX-24: por activo, hora y antigüedad, sentimiento con signo y escala, noticia fuerte, confianza, resumen y fuentes con dominio", async ({ page }) => {
  sembrar("ejecutada-y-rechazada");
  await page.goto("/");
  const btc = activo(page, "BTC/USD");
  await expect(btc.getByRole("heading", { level: 3 })).toContainText(/\d{2}:\d{2} \(UTC−6\)/);
  await expect(btc.getByRole("heading", { level: 3 })).toContainText(/hace \d+ min/);
  await expect(btc).toContainText("+0.65 en escala −1 a 1");
  await expect(btc).toContainText(/Noticia fuerte\s*Sí/);
  await expect(btc).toContainText(/\d\.\d{2} en escala 0 a 1/);
  const sol = activo(page, "SOL/USD");
  await expect(sol).toContainText("−0.20 en escala −1 a 1");
  await expect(sol).toContainText(/Noticia fuerte\s*No/);
  await expect(sol).toContainText("0.55 en escala 0 a 1");
  // Cada fuente muestra su dominio real y se abre fuera del tablero.
  const enlace = btc.getByRole("link").first();
  await expect(enlace).toHaveAttribute("target", "_blank");
  await expect(enlace).toHaveAttribute("rel", /noopener/);
  await expect(enlace).toHaveAttribute("href", /^https?:\/\//);
  const href = (await enlace.getAttribute("href"))!;
  await expect(enlace).toContainText(new URL(href).hostname);
});

test("AC-UX-26: Vigente a los 59 min y Vencida a los 61, con su texto completo y sin alerta", async ({ page }) => {
  sembrar("investigacion-59-61");
  await page.goto("/");
  await expect(activo(page, "BTC/USD")).toContainText("Vigente: se adjunta a las evaluaciones");
  await expect(activo(page, "SOL/USD")).toContainText("Vencida: las evaluaciones van sin investigación");
  await expect(page.getByRole("list", { name: "Alertas" })).toHaveCount(0);
});

test("AC-UX-25: la investigación va rotulada como informativa y nunca como motivo de una decisión", async ({ page }) => {
  sembrar("ejecutada-y-rechazada");
  await page.goto("/");
  await expect(bloque(page).getByText("Informativa: no interviene en la decisión de entrada")).toBeVisible();
  const texto = await page.locator("body").innerText();
  expect(texto).not.toMatch(/por (la )?investigaci[oó]n|debido a (la )?investigaci[oó]n|gracias a (la )?investigaci[oó]n/i);
});

test("AC-UX-13 (S1): HTML, scripts y enlaces javascript: se muestran como texto y no se ejecutan", async ({ page }) => {
  const dialogos: string[] = [];
  page.on("dialog", (d) => {
    dialogos.push(d.message());
    void d.dismiss();
  });
  sembrar("inyeccion");
  await page.goto("/");
  const btc = activo(page, "BTC/USD");
  await expect(btc).toContainText("<script>alert('xss-1')</script>");
  await expect(btc).toContainText('"><img src=x onerror=alert("xss-2")>');
  await expect(page.locator("img[src='x']")).toHaveCount(0);
  await expect(page.locator("a[href^='javascript:' i]")).toHaveCount(0);
  await expect(btc).toContainText("(no es un enlace http o https)");
  // Todo enlace del bloque se abre fuera del tablero.
  for (const a of await bloque(page).getByRole("link").all()) {
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
  }
  await page.waitForTimeout(300);
  expect(dialogos).toEqual([]);
});

test("AC-UX-24: antigüedad, alerta nombrando el activo con el resumen completo sin truncar", async ({ page }) => {
  sembrar("valores-extremos");
  await page.goto("/");
  const btc = activo(page, "BTC/USD");
  await expect(btc).toContainText("−1.00 en escala −1 a 1");
  await expect(btc).toContainText("1.00 en escala 0 a 1");
  // El resumen largo (600 caracteres) va completo: termina en "y".
  const resumen = await btc.locator("p").filter({ hasText: /^x{50}/ }).innerText();
  expect(resumen.length).toBe(600);
});
