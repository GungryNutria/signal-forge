import { expect, test, type Page } from "@playwright/test";
import { BASE, CREDENCIALES, precioConocido, PUERTOS, SIN_BASE, sembrar, url } from "./ayuda";

// S6 Precio (spec 002), parte de página y estados (T-4): AC-12 a 15, AC-UX-7, 10, 12 a 15 y AC-UX-17 (sin escritura).
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES });

const K = BASE ? precioConocido() : (undefined as never);
const principal = (page: Page) => page.locator("main");
const usd = (n: string | number) => `${new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n))} USD`;

test.describe("selección y rótulos", () => {
  test("AC-12: sin parámetros BTC/USD en 24 h con sus posiciones abiertas; cambiar activo y rango actualiza la URL y se conserva", async ({ page }) => {
    sembrar("precio-operaciones");
    await page.goto("/precio");
    const activo = page.getByRole("navigation", { name: "Activo" });
    const rango = page.getByRole("navigation", { name: "Rango" });
    await expect(activo.getByRole("link", { name: "BTC/USD · 1 abierta" })).toHaveAttribute("aria-current", "true");
    await expect(activo.getByRole("link", { name: "SOL/USD · 0 abiertas" })).toBeVisible();
    await expect(rango.getByRole("link", { name: "24 h" })).toHaveAttribute("aria-current", "true");
    for (const l of await page.locator("nav[aria-label='Activo'] a, nav[aria-label='Rango'] a").all()) {
      const b = (await l.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }

    await rango.getByRole("link", { name: "7 días" }).click();
    await expect(page).toHaveURL(/rango=7d/);
    await expect(page).toHaveURL(/activo=BTC%2FUSD/);
    await activo.getByRole("link", { name: /SOL\/USD/ }).click();
    await expect(page).toHaveURL(/activo=SOL%2FUSD/);
    await expect(page).toHaveURL(/rango=7d/);
    await expect(page.getByRole("navigation", { name: "Activo" }).getByRole("link", { name: /SOL\/USD/ })).toHaveAttribute("aria-current", "true");
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Rango" }).getByRole("link", { name: "7 días" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("navigation", { name: "Activo" }).getByRole("link", { name: /SOL\/USD/ })).toHaveAttribute("aria-current", "true");
  });

  test("AC-14: el rótulo de lo que es la línea y los marcadores y la hora del último punto se ven sin abrir nada", async ({ page }) => {
    sembrar("precio-serie");
    await page.goto("/precio");
    await expect(principal(page).getByText("Cierre de velas de 30 min evaluadas por el ciclo · los marcadores son precios reales de llenado")).toBeVisible();
    await expect(principal(page).getByText(/Último punto: \d{2}:\d{2} \(UTC−6\) · cierre de la vela de \d{2}:\d{2} a \d{2}:\d{2} · hace \d+ min/)).toBeVisible();
  });
});

test.describe("estados", () => {
  test("AC-13 y AC-UX-12: aviso con la vela del último punto a 46 min y sin aviso a 44; nunca 'actual' ni 'ahora'", async ({ page }) => {
    sembrar("precio-atrasado-46");
    await page.goto("/precio");
    await expect(principal(page).getByText(/Los precios de esta gráfica llegan hasta las \d{2}:\d{2} \(UTC−6\), hace 4\d min\. El ciclo no ha registrado velas nuevas/)).toBeVisible();
    expect(await principal(page).innerText()).not.toMatch(/\bactual\b|\bahora\b/i);
    sembrar("precio-atrasado-44");
    await page.goto("/precio");
    await expect(principal(page).getByText(/Último punto/)).toBeVisible();
    await expect(principal(page).getByText(/llegan hasta/)).toHaveCount(0);
    expect(await principal(page).innerText()).not.toMatch(/\bactual\b|\bahora\b/i);
  });

  test("AC-15 y AC-UX-13: sin evaluaciones, sin ejes ni ceros", async ({ page }) => {
    sembrar("vacio");
    await page.goto("/precio");
    await expect(principal(page).getByText(/Todavía no hay precios registrados de BTC\/USD\. El ciclo evalúa BTC\/USD y SOL\/USD cada 30 minutos; la próxima ejecución se espera a las \d{2}:\d{2} \(UTC−6\)/)).toBeVisible();
    await expect(principal(page).locator("[data-grafica], svg.recharts-surface")).toHaveCount(0);
    // Los "· 0 abiertas" de los selectores son conteos reales; lo que no puede haber son ceros de datos.
    expect((await principal(page).innerText()).replace(/\d+ abiertas?/g, "")).not.toMatch(/\b0\b/);
  });

  test("AC-UX-13: hay evaluaciones pero ninguna en el rango, con el aviso de atrasados", async ({ page }) => {
    sembrar("precio-fuera-del-rango-24h");
    await page.goto("/precio");
    await expect(principal(page).getByText(/No hay precios de BTC\/USD en las últimas 24 h\. El último registrado es de las \d{2}:\d{2} \(UTC−6\) del \d+ nov/)).toBeVisible();
    await expect(principal(page).getByText(/Los precios de BTC\/USD llegan hasta las \d{2}:\d{2} \(UTC−6\) del \d+ nov, hace/)).toBeVisible();
    await expect(principal(page).locator("[data-grafica]")).toHaveCount(0);
  });

  test("AC-15: la historia incompleta dice desde cuándo hay datos y conserva el rango elegido", async ({ page }) => {
    sembrar("precio-historia-incompleta");
    await page.goto("/precio?activo=BTC%2FUSD&rango=30d");
    await expect(principal(page).getByText(/Rango: 30 días · Hay datos desde el \d+ nov, \d{2}:\d{2} \(UTC−6\)/)).toBeVisible();
    await page.goto("/precio?activo=BTC%2FUSD&rango=7d");
    await expect(principal(page).getByText(/Hay datos desde el/).first()).toBeVisible();
  });
});

test.describe("alternativa en texto", () => {
  test("AC-UX-7: nombre accesible con activo, rango y periodo, y tabla plegada igual a los valores sembrados", async ({ page }) => {
    sembrar("precio-serie");
    await page.goto("/precio");
    await expect(page.getByRole("group", { name: /^Precio de BTC\/USD, 24 h, del \d+ nov \d{2}:\d{2} al \d+ nov \d{2}:\d{2} \(UTC−6\)$/ })).toBeVisible();
    const detalles = principal(page).locator("details");
    await expect(detalles).not.toHaveAttribute("open", "");
    await detalles.locator("summary").click();
    const esperados = K.puntosBtc;
    await expect(detalles.locator("summary")).toContainText(`Tabla de puntos (${esperados.length} puntos)`);
    const filas = detalles.locator("tbody tr");
    await expect(filas).toHaveCount(esperados.length);
    const celdas = await filas.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent)));
    expect(celdas).toEqual(esperados.map((p) => [usd(p.cierre), usd(p.sma20), usd(p.cierrePrevio), p.resultado === "propuesta" ? "Propuesta" : "Sin señal"]));
  });

  test("AC-UX-7: el resumen dice último cierre, mínimo y máximo, huecos y desde cuándo hay datos", async ({ page }) => {
    sembrar("precio-serie");
    await page.goto("/precio");
    const r = principal(page).locator("section[aria-labelledby='alt-resumen']");
    await expect(r).toContainText(/Último cierre: [\d,]+\.\d{2} USD a las \d{2}:\d{2} \(UTC−6\) · SMA20: [\d,]+\.\d{2} USD/);
    await expect(r).toContainText(/Mínimo [\d,]+\.\d{2} USD · máximo [\d,]+\.\d{2} USD en el rango/);
    await expect(r).toContainText(/2 huecos sin datos: \d{2}:\d{2} a \d{2}:\d{2} y \d{2}:\d{2} a \d{2}:\d{2} \(UTC−6\)/);
    await expect(r).toContainText(/Datos desde el \d+ nov, \d{2}:\d{2} \(UTC−6\)/);
  });

  test("AC-UX-10, AC-UX-15: operaciones con enlace a S3 y posiciones abiertas con sus niveles", async ({ page }) => {
    sembrar("precio-operaciones");
    await page.goto("/precio");
    const ops = principal(page).getByRole("list", { name: "Operaciones del rango" }).getByRole("listitem");
    await expect(principal(page).getByRole("heading", { name: "Operaciones del rango (5)" })).toBeVisible();
    await expect(ops).toHaveCount(5);
    await expect(principal(page).locator("li[data-marca^='s:']").filter({ hasText: "Stop loss" })).toContainText(`${usd(K.sl.salida)} · −`);
    await expect(principal(page).locator("li[data-marca^='s:']").filter({ hasText: "Take profit" })).toContainText(/\+[\d,]+\.\d{2} USD \(\+[\d.]+\s%\)/);
    await expect(principal(page).locator("li[data-marca^='e:']").filter({ hasText: "Abierta" })).toContainText(usd(K.abierta.precio));
    for (const f of await ops.all()) await expect(f.getByRole("link", { name: /Ver operación/ })).toHaveAttribute("href", /^\/propuestas\/[0-9a-f-]{36}\?de=precio&v=/);
    const abiertas = principal(page).getByRole("list", { name: "Posiciones abiertas" }).getByRole("listitem");
    await expect(abiertas).toHaveCount(1);
    await expect(abiertas.first()).toContainText("#1");
    await expect(abiertas.first().locator("[data-nivel='stop_loss']")).toContainText(usd(K.abierta.niveles.stopLoss));
    await expect(abiertas.first().locator("[data-nivel='take_profit']")).toContainText(usd(K.abierta.niveles.takeProfit));
    await expect(abiertas.first()).toContainText(/Última vela: [\d.]+\s% (sobre|bajo) el SL · [\d.]+\s% (sobre|bajo) el TP/);
  });

  test("AC-UX-10: una salida cuya entrada queda fuera del rango lo dice", async ({ page }) => {
    sembrar("precio-fuera-de-rango");
    await page.goto("/precio");
    const ops = principal(page).getByRole("list", { name: "Operaciones del rango" }).getByRole("listitem");
    await expect(ops).toHaveCount(1);
    await expect(ops.first()).toContainText(/Entrada el \d+ nov, fuera de este rango/);
    await expect(ops.first()).toContainText("Take profit");
  });

  test("AC-UX-17: S6 no tiene formularios ni controles de escritura", async ({ page }) => {
    sembrar("precio-operaciones");
    await page.goto("/precio");
    await expect(principal(page).locator("form")).toHaveCount(0);
    await expect(principal(page).locator("button:not([data-consulta])")).toHaveCount(0);
  });
});

test.describe("errores", () => {
  test("AC-UX-14: si falla la serie se ve el error de 001 y la banda sigue visible", async ({ browser }) => {
    sembrar("precio-operaciones");
    const ctx = await browser.newContext({ httpCredentials: CREDENCIALES });
    const page = await ctx.newPage();
    await page.goto(`${url(PUERTOS.fallaSeriePrecio)}/precio`);
    await expect(
      page.getByRole("alert").filter({ hasText: "No se pudo cargar la gráfica de precio de BTC/USD. Estos datos no se muestran; recarga la página para intentar de nuevo." }),
    ).toBeVisible();
    await expect(page.getByText("Modo", { exact: true })).toBeVisible();
    await ctx.close();
  });

  test("AC-UX-14: si fallan solo las operaciones se ve la línea con el aviso y no 'Sin operaciones en este rango'", async ({ browser }) => {
    sembrar("precio-operaciones");
    const ctx = await browser.newContext({ httpCredentials: CREDENCIALES });
    const page = await ctx.newPage();
    await page.goto(`${url(PUERTOS.fallaOperacionesPrecio)}/precio`);
    await expect(page.getByText("No se pudieron cargar las entradas, las salidas ni los niveles. La gráfica no los muestra; recarga la página para intentar de nuevo")).toBeVisible();
    await expect(page.locator("main [data-grafica]")).toHaveCount(1);
    await expect(page.getByText("Sin operaciones en este rango")).toHaveCount(0);
    await ctx.close();
  });
});
