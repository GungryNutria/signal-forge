import { expect, test, type Page } from "@playwright/test";
import { agregarEjecucion, BASE, CREDENCIALES, PUERTOS, SIN_BASE, sembrar, url } from "./ayuda";

// AC-UX-1 a 4, 6 y 27: la banda de estado con sus escenarios (texto exacto y capturas).
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const MEDIDAS = [
  { nombre: "escritorio 1280×800", ancho: 1280, alto: 800 },
  { nombre: "móvil 390×844", ancho: 390, alto: 844 },
  { nombre: "móvil mínimo 360×800", ancho: 360, alto: 800 },
];

const region = (page: Page, nombre: string) => page.getByRole("region", { name: nombre, exact: true });
const alertas = (page: Page) => page.getByRole("list", { name: "Alertas" });

for (const m of MEDIDAS) {
  test.describe(`${m.nombre}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test("AC-UX-1: modo, última ejecución, investigación por activo y hora de los datos, sin hacer scroll", async ({ page }, info) => {
      sembrar("ejecutada-y-rechazada");
      await page.goto("/");
      await expect(region(page, "Modo de trading")).toContainText("Operando");
      await expect(region(page, "Última ejecución del ciclo")).toContainText(/\d{2}:\d{2} \(UTC−6\)/);
      await expect(region(page, "Última ejecución del ciclo")).toContainText(/hace \d+ min/);
      await expect(region(page, "Última ejecución del ciclo")).toContainText("BTC/USD");
      await expect(region(page, "Última investigación por activo")).toContainText(/BTC\/USD\s*\d{2}:\d{2}/);
      await expect(region(page, "Datos")).toContainText(/\d{2}:\d{2}:\d{2} \(UTC−6\)/);

      for (const nombre of ["Modo de trading", "Última ejecución del ciclo", "Última investigación por activo", "Datos"]) {
        const caja = await region(page, nombre).first().boundingBox();
        expect(caja, nombre).not.toBeNull();
        expect(caja!.y, nombre).toBeGreaterThanOrEqual(0);
        expect(caja!.y + caja!.height, `${nombre} debe verse completo sin scroll`).toBeLessThanOrEqual(m.alto);
      }
      await page.screenshot({ path: info.outputPath(`banda-${m.ancho}.png`) });
    });

    test("AC-UX-19: sin scroll horizontal de la página con los valores más largos", async ({ page }) => {
      sembrar("valores-extremos");
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Últimas 5 propuestas" })).toBeVisible();
      await expect(page.getByText(/xxxxxxxx/).first()).toBeVisible();
      const ancho = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
      expect(ancho.s).toBeLessThanOrEqual(ancho.c);
    });
  });
}

test("AC-UX-2: pausa automática con el PnL del día frente al límite, la hora en que se levanta y las protecciones", async ({ page }) => {
  sembrar("pausa-auto");
  await page.goto("/");
  await expect(region(page, "Modo de trading")).toContainText("Pausa automática por pérdida diaria");
  const a = alertas(page);
  await expect(a).toContainText(/PnL del día −312\.00 USD \(−3\.12\s%\) \/ límite −300\.00 USD \(−3\.00\s%\)/);
  await expect(a).toContainText("Se levanta sola a las 18:00 (UTC−6), 00:00 UTC");
  await expect(a).toContainText("El stop loss y el take profit siguen activos");
});

test.describe("AC-UX-3: pausa manual", () => {
  test.use({ baseURL: url(PUERTOS.pausaManual) });

  test("se distingue de la automática, dice dónde se levanta y no hay controles", async ({ page }) => {
    sembrar("pausa-manual");
    await page.goto("/");
    await expect(region(page, "Modo de trading")).toContainText("Pausa manual");
    await expect(region(page, "Modo de trading")).not.toContainText("pérdida diaria");
    await expect(alertas(page)).toContainText(
      "El ciclo sigue corriendo y registrándose, pero sus propuestas se rechazan. Se levanta en la configuración del despliegue",
    );
    // Solo lectura (AC-UX-21): ni botones ni formularios.
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
  });
});

test("AC-UX-6: una orden en estado desconocido bloquea el activo y enlaza a la orden", async ({ page }) => {
  sembrar("orden-desconocida");
  await page.goto("/");
  await expect(alertas(page)).toContainText("BTC/USD: nuevas propuestas bloqueadas hasta reconciliar la orden");
  const enlace = alertas(page).getByRole("link", { name: /Ver orden/ });
  await expect(enlace).toHaveAttribute("href", /^\/propuestas\/[0-9a-f-]{36}$/);
  // La propuesta ejecutada con estado desconocido también se ve en las últimas propuestas.
  await expect(page.getByText("Estado desconocido").first()).toBeVisible();
});

test.describe("AC-UX-27: resultado de la última ejecución con el vocabulario fijo", () => {
  const ultima = (page: Page) => region(page, "Última ejecución del ciclo");

  test("Sin señal no es error ni alerta", async ({ page }) => {
    sembrar("solo-ejecuciones-sin-senal");
    await page.goto("/");
    await expect(ultima(page).getByText("Sin señal")).toHaveCount(2);
    await expect(alertas(page)).toHaveCount(0);
  });

  test("Propuesta con su decisión", async ({ page }) => {
    sembrar("ejecuciones-por-caso");
    await page.goto("/");
    await expect(ultima(page).getByText("Propuesta: Ejecutada")).toBeVisible();
    await expect(ultima(page).getByText("Sin señal")).toBeVisible();
  });

  test("Datos no disponibles", async ({ page }) => {
    sembrar("broker-caido");
    await page.goto("/");
    await expect(ultima(page).getByText("Datos no disponibles")).toBeVisible();
  });

  test("Error", async ({ page }) => {
    sembrar("ejecuciones-por-caso");
    await agregarEjecucion("error", 1);
    await page.goto("/");
    await expect(ultima(page).getByText("Error")).toHaveCount(2);
  });

  test("Omitida por solapamiento: una sola etiqueta y sin resultado por activo", async ({ page }) => {
    sembrar("ejecuciones-por-caso");
    await agregarEjecucion("omitida_solapamiento", 1);
    await page.goto("/");
    await expect(ultima(page).getByText("Omitida por solapamiento")).toBeVisible();
    await expect(ultima(page).getByText("BTC/USD")).toHaveCount(0);
    // Omitida no es alerta: la única alerta es la de la investigación que falta en este escenario.
    await expect(alertas(page)).not.toContainText("solapamiento");
    await expect(page.getByText("El ciclo no corre")).toHaveCount(0);
  });
});
