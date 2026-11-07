import { expect, test, type Page } from "@playwright/test";
import { BASE, CREDENCIALES, PUERTOS, SIN_BASE, sembrar, url } from "./ayuda";

// AC-UX-5, 7, 8 y 9 en S1 (S2, S4 y S5 suman los suyos en T-15 y T-16): broker caído, base vacía, carga y error por bloque.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const bloque = (page: Page, titulo: string) => page.locator("section, div").filter({ has: page.getByRole("heading", { name: titulo, exact: true }) }).last();
const tarjeta = (page: Page, etiqueta: string) =>
  page.getByRole("region", { name: "Indicadores" }).locator("div").filter({ has: page.getByRole("heading", { name: etiqueta, exact: true }) }).first();

test("AC-UX-5: con el broker caído, lo que depende de él no aparece como actual y el resto se ve", async ({ page }) => {
  sembrar("broker-caido");
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Alertas" })).toContainText(/El broker no responde desde \d{2}:\d{2} \(UTC−6\)\. Los valores que dependen de él no están actualizados/);
  await expect(tarjeta(page, "Valor de cartera")).toContainText("No disponible");
  await expect(tarjeta(page, "Valor de cartera")).toContainText(/Última lectura \d{2}:\d{2} \(UTC−6\), desactualizada/);
  await expect(tarjeta(page, "PnL del día")).toContainText("No disponible");
  const posiciones = bloque(page, "Posiciones abiertas");
  await expect(posiciones.getByRole("table").getByText("No disponible")).toHaveCount(2);
  // El registro propio sigue visible: saldo, propuestas e investigación.
  await expect(tarjeta(page, "Saldo virtual")).toContainText(/\d[\d,]*\.\d{2} USD/);
  await expect(page.getByRole("table", { name: "Últimas propuestas" }).getByRole("row")).not.toHaveCount(1);
  await expect(page.getByText("Informativa: no interviene en la decisión de entrada")).toBeVisible();
  await expect(page.getByText(/Vigente: se adjunta a las evaluaciones/).first()).toBeVisible();
});

test.describe("AC-UX-7: base vacía", () => {
  test("S1 explica que no hay datos, el saldo inicial, la cadencia y la hora de la próxima ejecución e investigación", async ({ page }) => {
    sembrar("vacio");
    await page.goto("/");
    await expect(tarjeta(page, "Saldo virtual")).toContainText("10,000.00 USD");
    await expect(tarjeta(page, "Saldo virtual")).toContainText("saldo inicial");
    // Nada de "0.00 USD" ni "0 %" donde no hay dato: PnL con raya.
    await expect(tarjeta(page, "PnL del día")).toContainText("—");
    await expect(tarjeta(page, "PnL acumulado")).toContainText("—");
    await expect(page.getByText("Sin posiciones abiertas")).toBeVisible();
    await expect(page.getByText(/El ciclo aún no ha generado propuestas\. Evalúa BTC\/USD y SOL\/USD cada 30 minutos; la próxima ejecución se espera a las \d{2}:(00|30) \(UTC−6\)/)).toBeVisible();
    await expect(page.getByText(/Aún no llega ninguna investigación\. Llega cada hora; la próxima se espera a las \d{2}:15 \(UTC−6\)/).first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Alertas" })).toHaveCount(0);
  });

  test("con ejecuciones pero ninguna propuesta no se muestra como error", async ({ page }) => {
    sembrar("solo-ejecuciones-sin-senal");
    await page.goto("/");
    await expect(
      page.getByText(/Ninguna ejecución ha encontrado señal todavía\. Última ejecución: \d{2}:\d{2} \(UTC−6\) \(Sin señal en BTC\/USD y SOL\/USD\)/),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Alertas" })).toHaveCount(0);
  });
});

test("AC-UX-8: con la red lenta, ningún bloque muestra cifras mientras carga", async ({ page, context }) => {
  sembrar("ejecutada-y-rechazada");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  // "3G lento" de Chrome: 400 ms de latencia y unos 400 kbit/s.
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  const dinero = /\d[\d,]*\.\d{2}\s*USD|\d\s*%|\b0\.00\b/;
  let visto = 0;
  const navegacion = page.goto("/", { waitUntil: "commit" });
  // Se muestrea el DOM mientras la página llega: cada vez que hay marcadores de carga, no hay datos con pinta de dato.
  const fin = Date.now() + 20_000;
  while (Date.now() < fin) {
    const lectura = await page
      .evaluate(() => ({
        esqueletos: document.querySelectorAll("[data-cargando]").length,
        textosEnMarcadores: [...document.querySelectorAll("[aria-busy='true']")].map((e) => (e as HTMLElement).innerText),
      }))
      .catch(() => null);
    if (lectura && lectura.esqueletos > 0) {
      visto++;
      for (const t of lectura.textosEnMarcadores) expect(t).not.toMatch(dinero);
      expect(lectura.esqueletos).toBeGreaterThan(0);
    }
    if (lectura && lectura.esqueletos === 0 && visto > 0) break;
    await page.waitForTimeout(100);
  }
  await navegacion;
  expect(visto, "debió verse al menos un marcador de carga").toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "Indicadores" })).toContainText(/\d[\d,]*\.\d{2} USD/, { timeout: 30_000 });
});

test.describe("AC-UX-9: un bloque que falla lo dice y no oculta los demás", () => {
  const MENSAJE = (nombre: string) => new RegExp(`No se pudo cargar ${nombre}\\. Estos datos no se muestran; recarga la página para intentar de nuevo\\.`);

  async function restoSano(page: Page, salvo: string[]) {
    const comprobaciones: Record<string, () => Promise<void>> = {
      banda: async () => expect(page.getByRole("region", { name: "Modo de trading" })).toContainText("Operando"),
      indicadores: async () => expect(page.getByRole("region", { name: "Indicadores" })).toContainText(/\d[\d,]*\.\d{2} USD/),
      investigacion: async () => expect(page.getByText(/Vigente: se adjunta a las evaluaciones/).first()).toBeVisible(),
      propuestas: async () => expect(page.getByRole("table", { name: "Últimas propuestas" })).toBeVisible(),
    };
    for (const [nombre, comprobar] of Object.entries(comprobaciones)) if (!salvo.includes(nombre)) await comprobar();
    await expect(page.getByText(/Falla inyectada/)).toHaveCount(0);
  }

  test("la banda", async ({ page }) => {
    sembrar("ejecutada-y-rechazada");
    await page.goto(url(PUERTOS.fallaEstado));
    await expect(page.getByText(MENSAJE("la banda de estado"))).toBeVisible();
    await restoSano(page, ["banda"]);
  });

  test("la investigación", async ({ page }) => {
    sembrar("ejecutada-y-rechazada");
    await page.goto(url(PUERTOS.fallaInvestigaciones));
    await expect(page.getByText(MENSAJE("la investigación"))).toBeVisible();
    await restoSano(page, ["investigacion"]);
  });

  test("las últimas propuestas", async ({ page }) => {
    sembrar("ejecutada-y-rechazada");
    await page.goto(url(PUERTOS.fallaPropuestas));
    await expect(page.getByText(MENSAJE("las últimas propuestas"))).toBeVisible();
    await restoSano(page, ["propuestas"]);
  });

  test("los indicadores y las posiciones, que comparten fuente", async ({ page }) => {
    sembrar("ejecutada-y-rechazada");
    await page.goto(url(PUERTOS.fallaCartera));
    await expect(page.getByText(MENSAJE("los indicadores \\(saldo, valor de cartera y PnL\\)"))).toBeVisible();
    await expect(page.getByText(MENSAJE("las posiciones abiertas"))).toBeVisible();
    await restoSano(page, ["indicadores"]);
  });
});
