import { expect, test, type Locator, type Page } from "@playwright/test";
import { Pool } from "pg";
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

// ───────────────────────────── Gráfica (T-5) ─────────────────────────────

const grafica = (page: Page) => page.locator("[data-grafica]");
const panel = (page: Page) => page.locator("[data-panel-consulta]");
const lista = async (page: Page) => {
  await expect(page.locator("[data-grafica-lista]")).toBeVisible();
  await expect(page.locator("svg[data-capa]")).toBeVisible();
};
const centro = async (l: Locator) => {
  await l.page().locator("[data-grafica]").scrollIntoViewIfNeeded();
  const b = (await l.locator("path, rect").first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const marcador = (page: Page, prefijo: "e" | "s") => page.locator(`[data-marcador^='${prefijo}:']`);

test.describe("gráfica: líneas y consulta de puntos", () => {
  test("AC-3: ambas líneas se cortan en los dos huecos (3 tramos) y no hay un segmento que una los lados", async ({ page }) => {
    sembrar("precio-serie");
    await page.goto("/precio");
    await lista(page);
    const trazos = await page.locator("main svg.recharts-surface path.recharts-line-curve").evaluateAll((ps) => ps.map((p) => (p.getAttribute("d") ?? "").match(/M/g)?.length));
    expect(trazos).toEqual([3, 3]);
  });

  test("AC-4 y AC-UX-3: el puntero consulta el punto más cercano con vela, UTC, cierre, SMA20, cierre anterior y resultado", async ({ page }) => {
    sembrar("precio-serie");
    await page.goto("/precio");
    await lista(page);
    await expect(panel(page)).toContainText("Pasa el puntero o usa las flechas sobre la gráfica para ver el detalle de un punto");
    await expect(panel(page)).toContainText("Sin operaciones en este rango");
    await grafica(page).scrollIntoViewIfNeeded();
    const b = (await grafica(page).boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.6, b.y + 40);
    await expect(panel(page)).toContainText(/Vela \d{2}:\d{2} a \d{2}:\d{2} \(UTC−6\)/);
    await expect(panel(page)).toContainText(/\d{2}:\d{2} \(UTC−6\) · \d{2}:\d{2} UTC/);
    for (const t of ["Cierre", "SMA20", "Cierre anterior", "Resultado"]) await expect(panel(page).getByText(t, { exact: true })).toBeVisible();
    await expect(panel(page)).toContainText(/Sin señal|Propuesta/);
    await expect(panel(page)).toHaveAttribute("role", "status");
  });

  test("AC-UX-3: con el teclado, una sola parada de Tab, ← → Inicio Fin y Esc; los valores son los sembrados", async ({ page }) => {
    sembrar("precio-serie");
    await page.goto("/precio");
    await lista(page);
    const P = K.puntosBtc;
    await grafica(page).focus();
    await page.keyboard.press("End");
    await expect(panel(page)).toContainText(usd(P[P.length - 1].cierre));
    await expect(panel(page)).toContainText(usd(P[P.length - 1].sma20));
    await page.keyboard.press("ArrowLeft");
    await expect(panel(page)).toContainText(usd(P[P.length - 2].cierre));
    await page.keyboard.press("Home");
    await expect(panel(page)).toContainText(usd(P[0].cierre));
    await page.keyboard.press("ArrowRight");
    await expect(panel(page)).toContainText(usd(P[1].cierre));
    await page.keyboard.press("Escape");
    await expect(panel(page)).toContainText("Pasa el puntero");
    await expect(grafica(page)).toBeFocused();
    // Una sola parada de Tab: de la gráfica se sale al siguiente elemento, no a un punto interno.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("[data-grafica]") !== null)).toBe(false);
  });

  test("AC-4 y AC-UX-3: un toque consulta el punto más cercano al dedo", async ({ browser }) => {
    sembrar("precio-serie");
    const ctx = await browser.newContext({ httpCredentials: CREDENCIALES, hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${url(PUERTOS.normal)}/precio`);
    await lista(page);
    await expect(panel(page)).toContainText("Toca un punto o un marcador para ver su detalle");
    await grafica(page).scrollIntoViewIfNeeded();
    const b = (await grafica(page).boundingBox())!;
    await page.touchscreen.tap(b.x + b.width * 0.5, b.y + 30);
    await expect(panel(page)).toContainText(/Vela \d{2}:\d{2} a \d{2}:\d{2} \(UTC−6\)/);
    await ctx.close();
  });

  test("AC-UX-15: el eje va en horas de Torreón en 24 h y en días en 7 días, con la zona visible", async ({ page }) => {
    sembrar("precio-historia-incompleta");
    await page.goto("/precio?activo=BTC%2FUSD&rango=24h");
    await lista(page);
    await expect(page.locator("[class*='xAxis-tick-labels'] text")).not.toHaveCount(0);
    const horas = await page.locator("[class*='xAxis-tick-labels'] text").allTextContents();
    expect(horas.length).toBeGreaterThan(2);
    expect(horas.every((t) => /^\d{2}:00( · \d+ [a-z]{3})?$/.test(t))).toBe(true);
    await expect(page.locator("svg[data-capa]")).toContainText("Hora de Torreón (UTC−6)");
    await page.goto("/precio?activo=BTC%2FUSD&rango=7d");
    await lista(page);
    await expect(page.locator("[class*='xAxis-tick-labels'] text")).not.toHaveCount(0);
    const dias = await page.locator("[class*='xAxis-tick-labels'] text").allTextContents();
    expect(dias.length).toBeGreaterThan(1);
    expect(dias.every((t) => /^\d+ [a-z]{3}$/.test(t))).toBe(true);
    await expect(page.locator("svg[data-capa]")).toContainText("Día · hora de Torreón (UTC−6)");
  });
});

test.describe("gráfica: marcadores, niveles y consulta de operaciones", () => {
  test("AC-5: dos entradas y dos salidas con formas distintas, más la entrada abierta", async ({ page }) => {
    sembrar("precio-operaciones");
    await page.goto("/precio");
    await lista(page);
    await expect(marcador(page, "e")).toHaveCount(3);
    await expect(marcador(page, "s")).toHaveCount(2);
    const formas = await page.locator("[data-marcador]").evaluateAll((gs) =>
      gs.map((g) => [g.getAttribute("data-marcador")?.[0], g.querySelector("rect") ? "cuadrado" : (g.querySelector("path")?.getAttribute("d") ?? "").startsWith("M0 -9") ? "rombo" : "triangulo"]),
    );
    expect(formas.filter(([t]) => t === "e").every(([, f]) => f === "triangulo")).toBe(true);
    expect(formas.filter(([t]) => t === "s").map(([, f]) => f).sort()).toEqual(["cuadrado", "rombo"]);
    for (const t of ["Entrada", "Stop loss", "Take profit"]) await expect(page.getByRole("list", { name: "Leyenda" })).toContainText(t);
  });

  test("AC-6 y AC-UX-5: la consulta de una salida muestra hora, precio, motivo, nivel, PnL con signo y duración", async ({ page }) => {
    sembrar("precio-operaciones");
    await page.goto("/precio");
    await lista(page);
    const sl = marcador(page, "s").filter({ has: page.locator("rect") });
    const c = await centro(sl);
    await page.mouse.move(c.x, c.y);
    await expect(panel(page).getByRole("heading", { name: "Stop loss" })).toBeVisible();
    await expect(panel(page)).toContainText(usd(K.sl.salida));
    await expect(panel(page)).toContainText("Cierre por stop loss");
    await expect(panel(page)).toContainText(/PnL neto\s*−[\d,.]+ USD \(−[\d.]+\s%\)/);
    await expect(panel(page)).toContainText("3 h 20 min");
    await expect(panel(page)).toContainText(/Entrada \d{2}:\d{2}|Entrada \d+ nov, \d{2}:\d{2}/);
    const tp = marcador(page, "s").filter({ hasNot: page.locator("rect") });
    const c2 = await centro(tp);
    await page.mouse.move(c2.x, c2.y);
    await expect(panel(page).getByRole("heading", { name: "Take profit" })).toBeVisible();
    await expect(panel(page)).toContainText(/PnL neto\s*\+[\d,.]+ USD \(\+[\d.]+\s%\)/);
  });

  test("AC-6: la consulta de la entrada abierta muestra tamaño, valores de la regla y niveles vigentes", async ({ page }) => {
    sembrar("precio-operaciones");
    await page.goto("/precio");
    await lista(page);
    const c = await centro(marcador(page, "e").filter({ hasText: "#1" }));
    await page.mouse.move(c.x, c.y);
    await expect(panel(page).getByRole("heading", { name: "Entrada #1" })).toBeVisible();
    await expect(panel(page)).toContainText("Abierta");
    await expect(panel(page)).toContainText(usd(K.abierta.precio));
    await expect(panel(page)).toContainText(/Tamaño\s*[\d.]+ BTC · 500.00 USD/);
    await expect(panel(page)).toContainText(usd(K.abierta.regla.close_ultimo));
    await expect(panel(page)).toContainText(usd(K.abierta.regla.close_previo));
    await expect(panel(page)).toContainText(usd(K.abierta.regla.sma20));
    await expect(panel(page)).toContainText(`SL #1 · ${usd(K.abierta.niveles.stopLoss)}`);
    await expect(panel(page)).toContainText(`TP #1 · ${usd(K.abierta.niveles.takeProfit)}`);
    await expect(panel(page)).toContainText(/Última vela: [\d.]+\s% (sobre|bajo) el SL/);
  });

  test("AC-10: la posición abierta muestra SL y TP rotulados; al cerrarse, sin niveles y con su salida", async ({ page }) => {
    sembrar("precio-operaciones");
    await page.goto("/precio");
    await lista(page);
    await expect(page.locator("[data-nivel-linea]")).toHaveCount(2);
    await expect(page.locator("[data-rotulo-nivel]")).toHaveCount(2);
    await expect(page.locator("svg[data-capa]")).toContainText(`SL #1 · ${usd(K.abierta.niveles.stopLoss)}`);
    await expect(page.locator("svg[data-capa]")).toContainText(`TP #1 · ${usd(K.abierta.niveles.takeProfit)}`);
    sembrar("precio-operaciones-cerrada");
    await page.goto("/precio");
    await lista(page);
    await expect(page.locator("[data-nivel-linea]")).toHaveCount(0);
    await expect(page.locator("[data-rotulo-nivel]")).toHaveCount(0);
    await expect(marcador(page, "s")).toHaveCount(3);
  });

  test("AC-7 y AC-UX-4: un clic en un marcador lleva a S3 (1 clic); con el teclado, Intro", async ({ page }) => {
    sembrar("precio-operaciones");
    await page.goto("/precio");
    await lista(page);
    const c = await centro(marcador(page, "e").filter({ hasText: "#1" }));
    await page.mouse.click(c.x, c.y);
    await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}\?de=precio&v=/);
    await page.goto("/precio");
    await lista(page);
    await grafica(page).focus();
    await page.keyboard.press("PageDown");
    await expect(panel(page)).toContainText(/Entrada|Stop loss|Take profit/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}\?de=precio&v=/);
  });

  test("AC-7 y AC-UX-4: en táctil, un toque consulta y 'Ver operación' navega (2 toques)", async ({ browser }) => {
    sembrar("precio-operaciones");
    const ctx = await browser.newContext({ httpCredentials: CREDENCIALES, hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${url(PUERTOS.normal)}/precio`);
    await lista(page);
    const c = await centro(marcador(page, "e").filter({ hasText: "#1" }));
    await page.touchscreen.tap(c.x, c.y);
    await expect(panel(page).getByRole("heading", { name: "Entrada #1" })).toBeVisible();
    await expect(page).toHaveURL(/\/precio/);
    await panel(page).getByRole("link", { name: /Ver operación/ }).tap();
    await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}\?de=precio&v=/);
    await ctx.close();
  });

  test("AC-8: la salida cuya entrada queda fuera del rango lo dice en su consulta", async ({ page }) => {
    sembrar("precio-fuera-de-rango");
    await page.goto("/precio");
    await lista(page);
    await expect(marcador(page, "e")).toHaveCount(0);
    const c = await centro(marcador(page, "s"));
    await page.mouse.move(c.x, c.y);
    await expect(panel(page)).toContainText(/Entrada el \d+ nov, fuera de este rango/);
  });

  test("AC-11 y AC-UX-8: con 3 posiciones, rótulos con nombre, precio y número, sin intersección; consultar #2 destaca solo sus niveles", async ({ page }) => {
    sembrar("precio-abiertas-3");
    await page.goto("/precio?activo=SOL%2FUSD");
    await lista(page);
    const texto = await page.locator("[data-rotulo-nivel]").allTextContents();
    for (const n of ["#1", "#2", "#3"]) expect(texto.join(" ")).toContain(n);
    expect(texto.join(" ")).toMatch(/USD/);
    const cajas = await page.locator("[data-rotulo-nivel] rect").evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect()).map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height })));
    for (let i = 0; i < cajas.length; i++)
      for (let j = i + 1; j < cajas.length; j++) {
        const [a, b] = [cajas[i], cajas[j]];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `rótulos ${i} y ${j} se tocan`).toBe(false);
      }
    const c = await centro(marcador(page, "e").filter({ hasText: "#2" }));
    await page.mouse.move(c.x, c.y);
    await expect(panel(page).getByRole("heading", { name: "Entrada #2" })).toBeVisible();
    await expect(page.locator("[data-nivel-linea='2-stop_loss']")).toHaveAttribute("stroke-width", "3");
    await expect(page.locator("[data-nivel-linea='2-take_profit']")).toHaveAttribute("stroke-width", "3");
    await expect(page.locator("[data-nivel-linea='1-stop_loss']")).toHaveAttribute("opacity", "0.65");
    await expect(page.locator("[data-nivel-linea='3-take_profit']")).toHaveAttribute("opacity", "0.65");
  });

  test("AC-UX-9: con 48 entradas, ningún marcador queda oculto sin indicarlo: la suma de cuentas es 48 a 1280 y a 360 px", async ({ browser }) => {
    sembrar("precio-48-entradas");
    for (const ancho of [1280, 360]) {
      const ctx = await browser.newContext({ httpCredentials: CREDENCIALES, viewport: { width: ancho, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${url(PUERTOS.normal)}/precio`);
      await lista(page);
      const sueltos = await page.locator("[data-marcador]").count();
      const grupos = await page.locator("[data-grupo]").evaluateAll((gs) => gs.map((g) => Number(g.getAttribute("data-grupo"))));
      expect(sueltos + grupos.reduce((a, b) => a + b, 0)).toBe(48);
      expect(grupos.length).toBeGreaterThan(0);
      for (const g of await page.locator("[data-grupo]").all()) await expect(g).toContainText(/×\d+/);
      await ctx.close();
    }
  });

  test("AC-UX-4: un grupo lista sus operaciones, cada una con su enlace; Intro en el grupo lleva el foco al primer enlace", async ({ page }) => {
    sembrar("precio-48-entradas");
    await page.goto("/precio");
    await lista(page);
    const grupo = page.locator("[data-grupo]").first();
    const c = await centro(grupo);
    await page.mouse.move(c.x, c.y);
    const n = Number(await grupo.getAttribute("data-grupo"));
    await expect(panel(page).getByRole("heading", { name: `${n} operaciones` })).toBeVisible();
    await expect(panel(page).getByRole("list", { name: "Operaciones del grupo" }).getByRole("listitem")).toHaveCount(n);
    await expect(panel(page).getByRole("link", { name: /Ver operación/ })).toHaveCount(n);
    await grafica(page).focus();
    await page.keyboard.press("Enter");
    await expect(panel(page).getByRole("link").first()).toBeFocused();
  });
});

// ───────────────────────────── Navegación y S3 (T-6) ─────────────────────────────

test.describe("navegación y ida y vuelta con S3", () => {
  test("AC-UX-2 y AC-UX-16: Precio es el quinto destino, en las pestañas y en la barra inferior de 5", async ({ page }) => {
    sembrar("precio-serie");
    await page.goto("/");
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Precio" }).click();
    await expect(page).toHaveURL(/\/precio$/);
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Precio" })).toHaveAttribute("aria-current", "page");
    const textos = await page.getByRole("navigation", { name: "Principal" }).getByRole("link").allTextContents();
    expect(textos.map((t) => t.trim())).toEqual(["Resumen", "Propuestas", "Métricas", "Ejecuciones", "Precio"]);
  });

  test("AC-UX-16: a 360 px la barra inferior muestra los 5 destinos con su texto completo y 44 px como mínimo", async ({ browser }) => {
    sembrar("precio-serie");
    const ctx = await browser.newContext({ httpCredentials: CREDENCIALES, viewport: { width: 360, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${url(PUERTOS.normal)}/precio`);
    const barra = page.getByRole("navigation", { name: "Principal (móvil)" });
    const enlaces = barra.getByRole("link");
    await expect(enlaces).toHaveCount(5);
    for (const e of await enlaces.all()) {
      const b = (await e.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
      // El texto no se corta: ningún elemento del enlace desborda su caja.
      const corta = await e.evaluate((el) => [...el.querySelectorAll("*")].some((x) => x.scrollWidth > x.clientWidth + 1) || el.scrollWidth > el.clientWidth + 1);
      expect(corta).toBe(false);
    }
    expect((await enlaces.allTextContents()).map((t) => t.trim())).toEqual(["Resumen", "Propuestas", "Métricas", "Ejecuciones", "Precio"]);
    const a = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(a.s).toBeLessThanOrEqual(a.c);
    await ctx.close();
  });

  test("AC-7 y AC-UX-11: desde S3 'Ver en la gráfica' abre S6 con el rango más corto que incluye la operación, destacada y consultada, y vuelve", async ({ page }) => {
    sembrar("precio-desde-s3");
    await page.goto("/precio?activo=BTC%2FUSD&rango=todo");
    await lista(page);
    const filas = page.locator("li[data-marca^='e:']");
    await expect(filas).toHaveCount(K.desdeS3.length);
    const ids = new Map<number, string>();
    for (const o of K.desdeS3) ids.set(o.precio, (await filas.filter({ hasText: usd(o.precio) }).getAttribute("data-marca"))!.slice(2));
    for (const o of K.desdeS3) {
      const id = ids.get(o.precio)!;
      await page.goto(`/propuestas/${id}`);
      const enlace = page.getByRole("link", { name: "Ver en la gráfica" });
      await expect(enlace).toBeVisible();
      await expect(enlace).toHaveAttribute("href", `/precio?activo=BTC%2FUSD&rango=${o.rango}&op=${id}&de=propuesta`);
      await enlace.click(); // 1 toque
      await expect(page).toHaveURL(new RegExp(`rango=${o.rango}&op=${id}&de=propuesta`));
      await lista(page);
      await expect(page.getByRole("navigation", { name: "Rango" }).getByRole("link", { name: o.rango === "24h" ? "24 h" : o.rango === "7d" ? "7 días" : "30 días" })).toHaveAttribute("aria-current", "true");
      await expect(panel(page).getByRole("heading", { name: /^Entrada/ })).toBeVisible();
      await expect(panel(page)).toContainText(usd(o.precio));
      await expect(grafica(page)).toBeFocused();
      // "← Volver" lleva a S3.
      await page.getByRole("link", { name: "Propuesta", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/propuestas/${id}$`));
    }
  });

  test("AC-12 y AC-UX-11: de S6 a S3 y de vuelta con 'Volver' se conservan activo, rango y operación, con el foco en la gráfica", async ({ page }) => {
    sembrar("precio-desde-s3");
    await page.goto("/precio?activo=BTC%2FUSD&rango=7d");
    await lista(page);
    await page.getByRole("link", { name: /Ver operación/ }).first().click();
    await expect(page).toHaveURL(/de=precio&v=/);
    await page.locator("main").getByRole("link", { name: "Precio", exact: true }).click();
    await expect(page).toHaveURL(/\/precio\?activo=BTC%2FUSD&rango=7d&op=[0-9a-f-]{36}$/);
    await lista(page);
    await expect(page.getByRole("navigation", { name: "Rango" }).getByRole("link", { name: "7 días" })).toHaveAttribute("aria-current", "true");
    await expect(grafica(page)).toBeFocused();
    await expect(panel(page).getByRole("heading", { name: /^(Entrada|Stop loss|Take profit)/ })).toBeVisible();
  });

  test("REQ-12: 'Ver en la gráfica' no aparece en propuestas que no abrieron posición", async ({ page }) => {
    sembrar("precio-operaciones");
    const pool = new Pool({ connectionString: BASE, max: 1 });
    try {
      const { rows } = await pool.query("SELECT p.id FROM propuestas p LEFT JOIN lotes l ON l.propuesta_id = p.id WHERE l.id IS NULL");
      expect(rows.length).toBe(4);
      for (const r of rows) {
        await page.goto(`/propuestas/${r.id}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("link", { name: "Ver en la gráfica" })).toHaveCount(0);
      }
    } finally {
      await pool.end();
    }
  });

  test("D-5: en S6 móvil la banda va plegada tras una línea que despliega la banda completa, y en otras superficies sigue completa", async ({ browser }) => {
    sembrar("precio-operaciones");
    const ctx = await browser.newContext({ httpCredentials: CREDENCIALES, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`${url(PUERTOS.normal)}/precio`);
    const linea = page.getByRole("button", { name: /Operando.*Datos de las \d{2}:\d{2} \(UTC−6\)/ });
    await expect(linea).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("Última ejecución", { exact: true })).toBeHidden();
    // El estado más grave se dice en la línea con texto (aquí hay avisos en la banda completa).
    await expect(page.getByRole("list", { name: "Alertas" }).first()).toBeVisible();
    await linea.click();
    await expect(linea).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Última ejecución", { exact: true })).toBeVisible();
    await page.goto(`${url(PUERTOS.normal)}/propuestas`);
    await expect(page.getByText("Última ejecución", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Datos de las/ })).toHaveCount(0);
    await ctx.close();
  });
});
