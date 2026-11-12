import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { agregarModos, BASE, capturar, CREDENCIALES, PUERTOS, SIN_BASE, sembrar, url } from "./ayuda";

// Spec 004, T-9: banda (AC-UX-1 a 4), S1 (AC-UX-5, 9), S2 (AC-UX-5), S3 (AC-UX-6 a 9), S6 (AC-28, AC-UX-20), sin controles
// (AC-UX-19) y axe a 360, 390 y 1280 px (AC-UX-22). Los modos se leen al arrancar: cada combinación tiene su servidor.
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const MEDIDAS = [
  { ancho: 1280, alto: 800 },
  { ancho: 390, alto: 844 },
  { ancho: 360, alto: 800 },
] as const;

const region = (page: Page, nombre: string) => page.getByRole("region", { name: nombre, exact: true });
const alertas = (page: Page) => page.getByRole("list", { name: "Alertas" });
const decisor = (page: Page) => region(page, "Decisor, última ranura");

async function sinScroll(page: Page, alto: number) {
  const a = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(a.s).toBeLessThanOrEqual(a.c);
  return alto;
}

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });

    test.describe("banda", () => {
      test.use({ baseURL: url(PUERTOS.decisorEjecuta) });

      test("AC-UX-1: modo, ciclo, decisor, investigación y datos sin hacer scroll (F-6)", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/");
        await expect(region(page, "Modo de trading")).toContainText("Ejecuta: Decisor · Ciclo: Solo registra");
        await expect(decisor(page)).toContainText(/\d{2}:45 a \d{2}:45 \(UTC−6\)/);
        await expect(decisor(page)).toContainText(/terminó hace (menos de 1|\d+) min/);
        await expect(decisor(page)).toContainText("Completa");
        const nombres = ["Modo de trading", "Última ejecución del ciclo", "Decisor, última ranura", "Última investigación por activo", "Datos"];
        for (const n of nombres) {
          const caja = await region(page, n).boundingBox();
          expect(caja, n).not.toBeNull();
          expect(caja!.y + caja!.height, `${n} debe verse sin scroll`).toBeLessThanOrEqual(m.alto);
        }
        if (m.ancho < 768) {
          const barra = await page.getByRole("navigation", { name: "Principal (móvil)" }).boundingBox();
          const ultima = await region(page, "Última investigación por activo").boundingBox();
          expect(ultima!.y + ultima!.height).toBeLessThanOrEqual(barra!.y);
        }
        await sinScroll(page, m.alto);
        await capturar(page, m.ancho, "banda_decisor_ejecuta");
      });

      test("AC-UX-2: 'No comprar' en neutro y el grupo enlaza a S5 en un toque", async ({ page }) => {
        sembrar("decisor-banda-parcial");
        await page.goto("/");
        await expect(decisor(page)).toContainText("No comprar");
        await expect(decisor(page)).toContainText("Sin decisión");
        await expect(decisor(page)).toContainText("Parcial");
        await expect(alertas(page).getByText("No comprar")).toHaveCount(0);
        await expect(decisor(page).getByRole("link", { name: "Ver el historial del decisor" })).toHaveAttribute("href", "/ejecuciones?vista=decisor");
      });

      test("AC-UX-2: Comprar ejecutada y Rechazada (R11)", async ({ page }) => {
        sembrar("decisor-banda-ejecuto");
        await page.goto("/");
        await expect(decisor(page).getByText("Comprar: Ejecutada")).toBeVisible();
        await expect(decisor(page).getByText("Comprar: Rechazada (R11 entradas abiertas)")).toBeVisible();
      });

      test("AC-UX-3: alerta solo de SOL/USD con 2 h 1 min, severidad neg en Ejecuta", async ({ page }) => {
        sembrar("decisor-alerta");
        await page.goto("/");
        await expect(alertas(page)).toContainText(/SOL\/USD: sin decisión válida del decisor desde \d{2}:\d{2} \(UTC−6\) · hace 2 h 1 min/);
        await expect(alertas(page)).not.toContainText("BTC/USD: sin decisión válida");
        await capturar(page, m.ancho, "banda_alerta_decisor");
      });

      test("AC-UX-3: sin ninguna decisión desde la activación", async ({ page }) => {
        sembrar("ejecutada-y-rechazada");
        await agregarModos(360);
        await page.goto("/");
        await expect(alertas(page)).toContainText(/SOL\/USD: sin decisión válida del decisor desde su activación \(\d+ \w+ \d{2}:\d{2}\)/);
        await expect(alertas(page)).toContainText(/BTC\/USD: sin decisión válida del decisor desde su activación/);
      });

      test("estado: decisor activado, sin ranuras todavía", async ({ page }) => {
        sembrar("ejecutada-y-rechazada");
        await agregarModos(5);
        await page.goto("/");
        await expect(decisor(page)).toContainText("Decisor: Ejecuta · sin ranuras todavía. Corre cada hora en el minuto 45; la próxima ranura empieza a las");
      });
    });

    test.describe("modos", () => {
      test("AC-UX-1/4: decisor apagado (por defecto): Ejecuta: Ciclo, sin alertas del decisor", async ({ page }) => {
        sembrar("decisor-alerta");
        await page.goto(`${url(PUERTOS.normal)}/`);
        await expect(region(page, "Modo de trading")).toContainText("Ejecuta: Ciclo · Decisor: Apagado");
        await expect(decisor(page)).toContainText("Decisor: Apagado");
        await expect(page.getByText("sin decisión válida del decisor")).toHaveCount(0);
      });

      test("AC-UX-1: el decisor solo registra", async ({ page }) => {
        sembrar("decisor-banda-registro");
        await page.goto(`${url(PUERTOS.decisorSoloRegistra)}/`);
        await expect(region(page, "Modo de trading")).toContainText("Ejecuta: Ciclo · Decisor: Solo registra");
        await expect(decisor(page).getByText("Comprar (solo registro)")).toBeVisible();
        await expect(decisor(page).getByText("Inválida (Contexto vencido)")).toBeVisible();
      });

      test("AC-UX-4 / AC-13: los dos en Ejecuta es configuración inválida, 'Ejecuta: ninguno' y alerta neg", async ({ page }) => {
        sembrar("decisor-alerta");
        await page.goto(`${url(PUERTOS.dosEjecutan)}/`);
        const modo = region(page, "Modo de trading");
        await expect(modo).toContainText("Ejecuta: ninguno");
        await expect(modo).not.toContainText("Ciclo: ");
        await expect(alertas(page)).toContainText(
          "Configuración inválida: el ciclo y el decisor están en Ejecuta. No se ejecuta ninguna propuesta hasta corregir la configuración del despliegue",
        );
        await expect(page.getByRole("button")).toHaveCount(0);
        await capturar(page, m.ancho, "banda_config_invalida");
      });

      test("F-6: configuración inválida más dos alertas del decisor caben antes de la barra inferior", async ({ page }) => {
        sembrar("ejecutada-y-rechazada");
        await agregarModos(360);
        await page.goto(`${url(PUERTOS.dosEjecutan)}/`);
        await expect(alertas(page).getByRole("listitem")).not.toHaveCount(0);
        const ultima = await region(page, "Última investigación por activo").boundingBox();
        const alto = m.alto - (m.ancho < 768 ? 56 : 0);
        expect(ultima!.y + ultima!.height).toBeLessThanOrEqual(alto);
      });

      test("AC-UX-4: decisor en Ejecuta sin R11 en vigor opera en Solo registra (F-3)", async ({ page }) => {
        sembrar("decisor-alerta");
        await page.goto(`${url(PUERTOS.decisorSinR11)}/`);
        await expect(region(page, "Modo de trading")).toContainText("Ejecuta: ninguno · Ciclo: Solo registra · Decisor: Solo registra");
        await expect(alertas(page)).toContainText("El decisor está configurado en Ejecuta, pero opera en Solo registra porque R11 no está en vigor");
        // Severidad por modo: con el decisor en Solo registra la alerta de REQ-27 es warn, no neg.
        await expect(alertas(page).getByRole("listitem").filter({ hasText: "sin decisión válida" }).first()).toHaveClass(/border-warn/);
      });

      test("AC-UX-3: con el ciclo en Solo registra, ciclo detenido es warn", async ({ page }) => {
        sembrar("ciclo-detenido-46");
        await page.goto(`${url(PUERTOS.cicloSoloRegistra)}/`);
        const a = alertas(page).getByRole("listitem").filter({ hasText: "El ciclo no corre desde" });
        await expect(a).toHaveClass(/border-warn/);
      });

      test("AC-UX-3: con el ciclo ejecutando, ciclo detenido es neg", async ({ page }) => {
        sembrar("ciclo-detenido-46");
        await page.goto(`${url(PUERTOS.normal)}/`);
        await expect(alertas(page).getByRole("listitem").filter({ hasText: "El ciclo no corre desde" })).toHaveClass(/border-neg/);
      });

      test("variable de modo inválida: alerta y el resto de la banda sigue", async ({ page }) => {
        sembrar("ejecutada-y-rechazada");
        await page.goto(`${url(PUERTOS.modosInvalidos)}/`);
        await expect(alertas(page)).toContainText("Los modos de los proponentes no son válidos");
        await expect(region(page, "Última investigación por activo")).toBeVisible();
      });
    });

    test.describe("S1, S2 y S3", () => {
      test.use({ baseURL: url(PUERTOS.decisorEjecuta) });

      test("AC-UX-5: proponente en S1 (últimas propuestas y posiciones), filtro y columna en S2", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Últimas 5 propuestas" })).toBeVisible();
        await expect(page.locator("main").getByText(/(^|· )Decisor/).locator("visible=true").first()).toBeVisible();
        await expect(page.getByText("Proponente", { exact: true }).first()).toBeAttached();
        await page.goto("/propuestas?proponente=decisor");
        await expect(page.getByRole("button", { name: "Decisor", pressed: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: /^\d+ propuestas?$/ })).toHaveText("4 propuestas");
        await page.goto("/propuestas?proponente=ciclo");
        await expect(page.getByRole("heading", { name: /^\d+ propuestas?$/ })).toHaveText("0 propuestas");
        // Combinado con el activo y conservado al volver desde S3.
        await page.goto("/propuestas?proponente=decisor&activo=BTC%2FUSD");
        await expect(page.getByRole("heading", { name: /^\d+ propuestas?$/ })).toHaveText("2 propuestas");
        await page.getByRole("link", { name: /Ver la propuesta de las .*BTC\/USD/ }).first().click();
        await page.locator("main").getByRole("link", { name: "Propuestas" }).click();
        await expect(page).toHaveURL(/proponente=decisor/);
        await expect(page).toHaveURL(/activo=BTC%2FUSD/);
        await capturar(page, m.ancho, "s2_proponente");
      });

      test("AC-UX-9: S1 con el decisor activo dice que la lee el decisor", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/");
        await expect(page.getByText("La lee el decisor al decidir. La regla fija no la usa")).toBeVisible();
        await expect(page.getByText("Informativa: no interviene en la decisión de entrada")).toHaveCount(0);
      });

      test("AC-UX-9: con el decisor apagado S1 conserva el rótulo de 001", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto(`${url(PUERTOS.normal)}/`);
        await expect(page.getByText("Informativa: no interviene en la decisión de entrada")).toBeVisible();
      });

      test("AC-UX-6, 7, 9: S3 de una propuesta del decisor, en orden y sin 'Regla de entrada evaluada'", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/propuestas?proponente=decisor&decision=ejecutada&activo=BTC%2FUSD");
        await page.getByRole("link", { name: /Ver la propuesta de las .*BTC\/USD/ }).first().click();
        await expect(page.getByRole("heading", { level: 2, name: "Decisión del decisor" })).toBeVisible();
        await expect(page.getByText("Regla de entrada evaluada")).toHaveCount(0);
        await expect(page.locator("dt", { hasText: "Proponente" })).toBeVisible();
        const orden = await page.getByRole("heading", { level: 2 }).allTextContents();
        const posiciones = ["Decisión del decisor", "Reglas de riesgo", "Respuesta del broker", "Etiqueta de resultado", "Contexto que vio el decisor"].map((t) => orden.indexOf(t));
        expect(posiciones.every((p) => p >= 0)).toBe(true);
        expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
        const bloque = page.getByRole("heading", { level: 2, name: "Decisión del decisor" }).locator("xpath=..");
        await expect(bloque).toContainText(/0\.\d{2} en escala 0 a 1/);
        await expect(bloque).toContainText("decisor-v1");
        await expect(bloque).toContainText(/Modo\s*Ejecuta/); // el modo efectivo de la decisión
        await expect(page.getByText("Razonamiento del decisor (texto del agente, literal)")).toBeVisible();
        // Contexto: id, antigüedad, grupos y la investigación con su rótulo (AC-UX-9).
        await expect(page.getByText(/contexto de hace \d+ min/)).toBeVisible();
        for (const g of ["Mercado", "Investigación", "Cartera", "Historial de 24 h", "Estado y márgenes"]) {
          await expect(page.getByRole("heading", { level: 3, name: g })).toBeVisible();
        }
        await expect(page.getByText("Leída por el decisor: forma parte del contexto con el que decidió")).toBeVisible();
        await expect(page.getByText("Informativa: no interviene en la decisión de entrada")).toHaveCount(0);
        await expect(page.getByText(/Última aceptada: .*, tenía \d+ min al armar el contexto/).first()).toBeVisible();
        // AC-UX-7: un dato faltante dice "No disponible", no 0.
        await expect(page.getByRole("heading", { level: 3, name: "Cartera" }).locator("xpath=..")).toContainText(/PnL del día\s*No disponible/);
        // La serie va plegada.
        const serie = page.locator("details").first();
        await expect(serie).not.toHaveAttribute("open", "");
        await sinScroll(page, m.alto);
        await capturar(page, m.ancho, "s3_decisor");
      });

      test("AC-UX-6: S3 de una rechazada por R11 muestra reglas de riesgo y sin salida", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/propuestas?proponente=decisor&decision=rechazada&activo=BTC%2FUSD");
        await page.getByRole("link", { name: /Ver la propuesta de las .*BTC\/USD/ }).first().click();
        await expect(page.getByText("R11 entradas abiertas").locator("visible=true").first()).toBeVisible();
        await expect(page.getByText("Incumple").locator("visible=true").first()).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Contexto que vio el decisor" })).toBeVisible();
      });

      test("AC-UX-6: con el lote cerrado, el PnL a nivel va junto al neto", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto("/propuestas?proponente=decisor&estado=cerrada_tp");
        await page.getByRole("link", { name: /Ver la propuesta de las/ }).first().click();
        const etiqueta = page.getByRole("heading", { level: 2, name: "Etiqueta de resultado" }).locator("xpath=..");
        await expect(etiqueta).toContainText("PnL neto");
        await expect(etiqueta).toContainText("PnL a nivel (comparable)");
      });

      test("AC-UX-8 / AC-11: el razonamiento con cargas de inyección queda literal dentro del contenedor", async ({ page }) => {
        sembrar("decisor-inyeccion");
        const dialogos: string[] = [];
        page.on("dialog", async (d) => {
          dialogos.push(d.message());
          await d.dismiss();
        });
        await page.goto("/propuestas?proponente=decisor&decision=rechazada");
        await page.getByRole("link", { name: /Ver la propuesta de las/ }).first().click();
        const lit = page.locator("[data-literal]");
        await expect(lit).toContainText("Decisión del riesgo: Ejecutada");
        await expect(lit).toContainText("<img src=x onerror=alert(1)>");
        await expect(lit).toContainText("[clic](javascript:alert(1))");
        await expect(lit).toContainText("https://evil.example/enlace");
        expect(await lit.locator("*").count()).toBe(0);
        expect(await page.locator("main img").count()).toBe(0);
        expect(await page.locator("a[href^='javascript:' i], a[href*='evil.example']").count()).toBe(0);
        expect(await lit.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("pre-wrap");
        expect(await lit.evaluate((e) => (e.textContent ?? "").split("\n").length)).toBeGreaterThan(2);
        await sinScroll(page, m.alto);
        // Distinto de los campos del sistema: el chip de la decisión del sistema sigue siendo "Rechazada".
        await expect(page.getByText("Rechazada").first()).toBeVisible();
        await page.waitForTimeout(400);
        expect(dialogos).toEqual([]);
        await capturar(page, m.ancho, "s3_inyeccion");
      });
    });

    test.describe("S6", () => {
      test("AC-28 / AC-UX-20: entrada del decisor con proponente y confianza, sin valores de la regla", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto(`${url(PUERTOS.decisorEjecuta)}/precio?activo=BTC%2FUSD&rango=7d`);
        const alt = page.getByRole("list", { name: /Posiciones abiertas|Marcas|Operaciones/ }).first();
        await expect(page.getByText(/Proponente: Decisor · Confianza 0\.\d{2} en escala 0 a 1/).first()).toBeAttached();
        await expect(page.locator("li", { hasText: "Proponente: Decisor" }).filter({ hasText: "Cierre anterior" })).toHaveCount(0);
        expect(alt).toBeDefined();
        await sinScroll(page, m.alto);
      });

      test("AC-28: entrada del ciclo con 'Proponente: Ciclo' y sus valores", async ({ page }) => {
        sembrar("precio-operaciones");
        await page.goto(`${url(PUERTOS.normal)}/precio?activo=BTC%2FUSD&rango=7d`);
        await expect(page.getByText(/Proponente: Ciclo/).first()).toBeAttached();
      });
    });

    test.describe("axe y solo lectura", () => {
      const casos: [string, string, number][] = [
        ["decisor-decisiones", "/", PUERTOS.decisorEjecuta],
        ["decisor-alerta", "/", PUERTOS.decisorEjecuta],
        ["decisor-decisiones", "/propuestas?proponente=decisor", PUERTOS.decisorEjecuta],
        ["decisor-inyeccion", "/propuestas?proponente=decisor&decision=rechazada", PUERTOS.decisorEjecuta],
        ["decisor-alerta", "/", PUERTOS.dosEjecutan],
        ["decisor-alerta", "/", PUERTOS.decisorSinR11],
      ];
      for (const [escenario, ruta, puerto] of casos) {
        test(`axe wcag2aa + wcag22aa: ${escenario} ${ruta} (:${puerto})`, async ({ page }) => {
          sembrar(escenario);
          await page.goto(`${url(puerto)}${ruta}`);
          if (ruta.includes("decision=rechazada")) await page.getByRole("link", { name: /Ver la propuesta de las/ }).first().click();
          await page.waitForLoadState("networkidle");
          await expect(page.locator("[data-cargando]")).toHaveCount(0);
          const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
          const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
        });
      }

      test("AC-UX-19: sin controles para cambiar modos, reintentar ni decidir", async ({ page }) => {
        sembrar("decisor-decisiones");
        for (const ruta of ["/", "/propuestas?proponente=decisor"]) {
          await page.goto(`${url(PUERTOS.decisorEjecuta)}${ruta}`);
          await expect(page.getByRole("button", { name: /reintentar|decidir ahora|activar|apagar|aprobar|cambiar/i })).toHaveCount(0);
          await expect(page.locator("form[method='post']")).toHaveCount(0);
        }
      });
    });
  });
}
