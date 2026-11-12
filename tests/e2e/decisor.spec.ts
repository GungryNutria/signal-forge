import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { BASE, cambiarModos, capturar, CREDENCIALES, conocidasDecisor, consultarBase, MEDIDAS, PUERTOS, SIN_BASE, sembrar, url, vigilarCarga } from "./ayuda";

// Spec 004, T-10: S5 Decisor (AC-21, AC-UX-10, 11), detalle de decisión (AC-20, AC-UX-12), señal registrada (AC-UX-13),
// S4 Decisor frente a regla (AC-19, AC-UX-14 a 17), estados (AC-UX-18), recorridos (AC-UX-21) y axe (AC-UX-22).
test.skip(!BASE, SIN_BASE);
test.use({ httpCredentials: CREDENCIALES, baseURL: url(PUERTOS.decisorEjecuta) });

const conocidas = conocidasDecisor();
const C = conocidas.comparacion;
const sinNbsp = (t: string) => t.replace(/ /g, " ");

async function sinScroll(page: Page) {
  const a = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(a.s).toBeLessThanOrEqual(a.c);
}

const MALOS = /reintentar|decidir ahora|aprobar|activar|apagar|cambiar el modo|cambiar modo/i;

for (const m of MEDIDAS) {
  test.describe(`${m.ancho}×${m.alto}`, () => {
    test.use({ viewport: { width: m.ancho, height: m.alto } });
    const movil = m.ancho < 768;
    const fila = (page: Page, etiqueta: string) =>
      movil
        ? page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: etiqueta, exact: true }) })
        : page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: etiqueta, exact: true }) });

    test.describe("S5 Decisor", () => {
      test("AC-21 y AC-UX-10: vistas en la dirección, porcentajes con denominador y los cuatro estados", async ({ page }) => {
        sembrar("decisor-ranuras");
        await page.goto("/ejecuciones");
        await page.getByRole("navigation", { name: "Vistas de Ejecuciones" }).getByRole("link", { name: "Decisor" }).click();
        await expect(page).toHaveURL(/\/ejecuciones\?vista=decisor$/);
        const R = conocidas.ranuras;
        await expect(page.getByText(`${R.h24.pct} %, ${R.h24.completas} de ${R.h24.total} ranuras`.replace(" %", " %"))).toBeVisible();
        await expect(page.getByText(`${R.d7.pct} %, ${R.d7.completas} de ${R.d7.total} ranuras`.replace(" %", " %"))).toBeVisible();
        const lista = movil ? page.getByRole("list", { name: "Ranuras del decisor" }).getByRole("listitem") : page.getByRole("table", { name: "Ranuras del decisor" }).locator("tbody tr");
        // La primera es la que sigue en curso; después k = 1 (Completa), 2 (Parcial), 3 (Inválida) y 4 (Sin llegar).
        const textos = (await lista.allInnerTexts()).map(sinNbsp);
        expect(textos[0]).toContain("en curso");
        expect(textos[0]).toMatch(/\d{2}:45 a \d{2}:45/);
        expect(textos[1]).toContain("Completa");
        expect(textos[2]).toContain("Parcial");
        expect(textos[3]).toContain("Inválida");
        expect(textos[4]).toContain("Sin llegar");
        await expect(page.getByText("La ranura terminó sin envíos del decisor. Puede ser que la tarea no corrió").locator("visible=true").first()).toBeVisible();
        await expect(page.getByRole("button", { name: MALOS })).toHaveCount(0);
        await sinScroll(page);
        await capturar(page, m.ancho, "s5_decisor");
      });

      test("AC-UX-11: filtros combinados, resultados visibles, vacío por filtro y estados con estilo warn", async ({ page }) => {
        sembrar("decisor-ranuras");
        await page.goto("/ejecuciones?vista=decisor&estado=sin_llegar");
        await expect(page.getByText("2 resultados")).toBeVisible();
        await page.goto("/ejecuciones?vista=decisor&estado=parcial&activo=BTC%2FUSD&resultado=no_comprar");
        await expect(page.getByText("3 resultados")).toBeVisible(); // k = 2, 41 y la que sigue en curso
        await page.goto("/ejecuciones?vista=decisor&estado=parcial&activo=SOL%2FUSD&resultado=no_comprar");
        await expect(page.getByText("0 resultados")).toBeVisible();
        await page.goto("/ejecuciones?vista=decisor&estado=sin_llegar&resultado=no_comprar");
        await expect(page.getByText("0 resultados")).toBeVisible();
        await expect(page.getByText("Ninguna ranura coincide con los filtros.")).toBeVisible();
        await page.getByRole("link", { name: "Quitar los filtros" }).click();
        await expect(page).toHaveURL(/\/ejecuciones\?vista=decisor$/);
        // Parcial, Inválida y Sin llegar llevan texto y estilo warn; Completa va en neutro.
        for (const [estado, texto] of [["parcial", "Parcial"], ["invalida", "Inválida"], ["sin_llegar", "Sin llegar"]] as const) {
          await page.goto(`/ejecuciones?vista=decisor&estado=${estado}`);
          await expect(page.locator("main span.border-warn", { hasText: texto }).locator("visible=true").first()).toBeVisible();
        }
        await page.goto("/ejecuciones?vista=decisor&estado=completa");
        await expect(page.locator("main span.border-warn", { hasText: "Completa" })).toHaveCount(0);
      });

      test("AC-UX-11: al volver del detalle se conservan filtros y posición", async ({ page }) => {
        sembrar("decisor-ranuras");
        await page.goto("/ejecuciones?vista=decisor&estado=completa");
        await page.getByRole("link", { name: "Anteriores ›" }).click();
        await expect(page).toHaveURL(/cursor=a%3A/);
        const url2 = page.url();
        await page.getByRole("link", { name: /Ver detalle/ }).first().click();
        await expect(page.getByRole("heading", { level: 2, name: "Decisión del decisor" })).toBeVisible();
        await page.locator("main").getByRole("link", { name: "Ejecuciones" }).click();
        await expect(page).toHaveURL(url2);
      });

      test("AC-UX-18: sin activar, apagado y sin ranuras todavía", async ({ page }) => {
        sembrar("ejecutada-y-rechazada");
        await page.goto(`${url(PUERTOS.normal)}/ejecuciones?vista=decisor`);
        await expect(page.getByText("El decisor está apagado. Se activa en la configuración del despliegue")).toBeVisible();
        await cambiarModos(5, { ciclo: "solo_registra", decisor: "ejecuta" });
        await page.goto("/ejecuciones?vista=decisor");
        await expect(page.getByText(/sin ranuras todavía\. Corre cada hora en el minuto 45; la próxima ranura empieza a las \d{2}:45/).last()).toBeVisible();
      });

      test("AC-UX-18: con la red limitada no hay cifras mientras carga", async ({ page, context }) => {
        sembrar("decisor-ranuras");
        const r = await vigilarCarga(page, context, "/ejecuciones?vista=decisor");
        expect(r.visto).toBeGreaterThan(0);
        expect(r.textosConDato).toEqual([]);
      });

      test("AC-UX-18: un fallo en el historial muestra su error y no oculta Ciclo ni la banda", async ({ page }) => {
        sembrar("decisor-ranuras");
        await page.goto(`${url(PUERTOS.fallaRanuras)}/ejecuciones?vista=decisor`);
        await expect(page.getByRole("alert").filter({ hasText: "No se pudo cargar las ranuras del decisor" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Decisor, última ranura" })).toBeVisible();
        await page.getByRole("navigation", { name: "Vistas de Ejecuciones" }).getByRole("link", { name: "Ciclo" }).click();
        await expect(page.getByRole("heading", { name: "Ejecuciones" })).toBeVisible();
        await expect(page.getByRole("alert").filter({ hasText: "ranuras del decisor" })).toHaveCount(0);
      });
    });

    test.describe("detalle de decisión", () => {
      test("AC-UX-12: no comprar, en orden, con resultado hipotético y el contexto", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/ejecuciones?vista=decisor");
        await page.getByRole("link", { name: /^BTC\/USD: No comprar, ranura de las .*Ver detalle$/ }).first().click();
        await expect(page).toHaveURL(/\/ejecuciones\/decisiones\/[0-9a-f-]{36}/);
        await expect(page.getByRole("heading", { level: 1 })).toContainText("BTC/USD");
        const orden = await page.getByRole("heading", { level: 2 }).allTextContents();
        const pos = ["Decisión del decisor", "Motivo del sistema", "Resultado hipotético", "Contexto que vio el decisor"].map((t) => orden.indexOf(t));
        expect(pos.every((p) => p >= 0)).toBe(true);
        expect([...pos].sort((a, b) => a - b)).toEqual(pos);
        await expect(page.getByText("Razonamiento del decisor (texto del agente, literal)")).toBeVisible();
        await expect(page.getByText("«Motivo del sistema»")).toBeVisible();
        await expect(page.getByRole("button", { name: MALOS })).toHaveCount(0);
        await sinScroll(page);
        await capturar(page, m.ancho, "detalle_decision");
        await page.locator("main").getByRole("link", { name: "Ejecuciones" }).click();
        await expect(page).toHaveURL(/vista=decisor/);
      });

      test("AC-UX-12: contexto vencido con su detalle y el contenido recibido literal", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/ejecuciones?vista=decisor&resultado=invalida");
        await page.getByRole("link", { name: /^BTC\/USD: Inválida \(Contexto vencido\)/ }).first().click();
        await expect(page.getByText("contexto de hace 16 min, máximo 15")).toBeVisible();
        await expect(page.getByText("Contexto vencido: contexto de hace 16 min, máximo 15")).toBeVisible();
        await expect(page.getByRole("heading", { level: 2, name: "Motivo del sistema" }).locator("xpath=..")).not.toContainText("contexto_id");
        await expect(page.getByRole("heading", { level: 2, name: "Motivo del sistema" }).locator("xpath=..")).toContainText("Contexto vencido");
        await expect(page.getByText("Contenido recibido (texto del agente, literal)")).toBeVisible();
        await sinScroll(page);
        await capturar(page, m.ancho, "detalle_decision_invalida");
      });

      test("AC-UX-12: una decisión inválida de esquema se abre por su dirección y muestra lo recibido", async ({ page }) => {
        sembrar("decisor-decisiones");
        const [d] = await consultarBase<{ id: string }>("SELECT id FROM decisiones WHERE activo IS NULL LIMIT 1");
        await page.goto(`/ejecuciones/decisiones/${d.id}`);
        await expect(page.getByText("Decisión inválida").first()).toBeVisible();
        await expect(page.getByText('{"decision":"comprar","confianza":7}')).toBeVisible();
        await expect(page.getByText("Too big: expected number to be <=1")).toBeVisible();
      });

      test("AC-UX-12: una decisión inválida sin activo se ve y se abre desde su ranura, conservando los filtros", async ({ page }) => {
        sembrar("decisor-inyeccion");
        await page.goto("/ejecuciones?vista=decisor&estado=invalida");
        const linea = page.getByText("Envío inválido sin activo", { exact: true }).locator("visible=true");
        await expect(linea).toHaveCount(1);
        const enlace = page.getByRole("link", { name: /^Envío inválido sin activo, ranura de las .*Decisión inválida\. Ver detalle$/ }).locator("visible=true");
        await expect(enlace).toContainText("Inválida (Decisión inválida)");
        expect(await enlace.getAttribute("href")).toMatch(/^\/ejecuciones\/decisiones\/[0-9a-f-]{36}\?v=/);
        await enlace.click();
        await expect(page).toHaveURL(/\/ejecuciones\/decisiones\/[0-9a-f-]{36}\?v=/);
        await expect(page.getByText("Contenido recibido (texto del agente, literal)")).toBeVisible();
        await page.locator("main").getByRole("link", { name: "Ejecuciones" }).click();
        await expect(page).toHaveURL(/vista=decisor&estado=invalida/);
      });

      test("AC-UX-12: comprar con propuesta lleva a su S3, desde la lista y desde la dirección", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/ejecuciones?vista=decisor");
        await page.getByRole("link", { name: /^BTC\/USD: Comprar: Ejecutada/ }).first().click();
        await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}/);
        await expect(page.getByRole("heading", { level: 2, name: "Decisión del decisor" })).toBeVisible();
        const [d] = await consultarBase<{ id: string }>("SELECT decision_id AS id FROM propuestas WHERE decision_id IS NOT NULL LIMIT 1");
        await page.goto(`/ejecuciones/decisiones/${d.id}`);
        await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}/);
      });

      test("una dirección que no existe es 404", async ({ page }) => {
        const r = await page.goto("/ejecuciones/decisiones/00000000-0000-4000-8000-000000000000");
        await expect(page.getByText(/no se encontr|no existe|404/i).first()).toBeVisible();
        expect(r).not.toBeNull();
      });

      test("AC-UX-8: lo que escribió el agente queda literal en el contenido recibido", async ({ page }) => {
        sembrar("decisor-inyeccion");
        const dialogos: string[] = [];
        page.on("dialog", async (d) => {
          dialogos.push(d.message());
          await d.dismiss();
        });
        const [d] = await consultarBase<{ id: string }>("SELECT id FROM decisiones WHERE NOT valida ORDER BY recibida_en DESC LIMIT 1");
        await page.goto(`/ejecuciones/decisiones/${d.id}`);
        const lit = page.locator("[data-literal]").last();
        await expect(lit).toContainText("<script>alert('xss-1')</script>");
        expect(await lit.locator("*").count()).toBe(0);
        expect(await page.locator("main script, main img").count()).toBe(0);
        await sinScroll(page);
        await page.waitForTimeout(300);
        expect(dialogos).toEqual([]);
      });
    });

    test.describe("señal registrada", () => {
      test.use({ baseURL: url(PUERTOS.cicloSoloRegistra) });

      test("AC-UX-13: 'Señal (solo registro)' en S5, no en S2, y su detalle con el hipotético", async ({ page }) => {
        sembrar("ciclo-solo-registra");
        await page.goto("/ejecuciones?resultado=senal_registrada");
        await expect(page.getByText("2 resultados")).toBeVisible();
        const filas = movil ? page.getByRole("list", { name: "Ejecuciones del ciclo" }) : page.getByRole("table", { name: "Ejecuciones del ciclo" });
        await expect(filas.getByText("Propuesta", { exact: true })).toHaveCount(0);
        await page.goto("/propuestas");
        await expect(page.getByText("Señal (solo registro)")).toHaveCount(0);
        await page.goto("/ejecuciones?resultado=senal_registrada");
        await page.getByRole("link", { name: /^BTC\/USD: Señal \(solo registro\)/ }).last().click();
        await expect(page.getByRole("heading", { level: 2, name: "Resultado hipotético" })).toBeVisible();
        await expect(page.getByText("Habría cerrado por take profit").first()).toBeVisible();
        await expect(page.getByText("PnL a nivel (hipotético)")).toBeVisible();
        await expect(page.getByText("Informativa: no interviene en la decisión de entrada").first()).toBeVisible();
        await sinScroll(page);
        await capturar(page, m.ancho, "detalle_senal_registrada");
      });

      test("AC-UX-14: el hipotético pendiente con su hueco de muestras, en neutro", async ({ page }) => {
        sembrar("ciclo-solo-registra");
        await page.goto("/ejecuciones?resultado=senal_registrada");
        await page.getByRole("link", { name: /^BTC\/USD: Señal \(solo registro\)/ }).nth(0).click();
        const res = page.getByRole("heading", { level: 2, name: "Resultado hipotético" }).locator("xpath=..");
        await expect(res).toContainText("Pendiente (hipotético)");
        await expect(res).toContainText(/Sin datos de precio de \d{2}:\d{2} a \d{2}:\d{2} \(UTC−6\)/);
        await expect(res).not.toHaveClass(/text-(pos|neg)/);
        expect(await res.locator(".text-pos, .text-neg").count()).toBe(0);
      });
    });

    test.describe("S4 Decisor frente a regla", () => {
      test("AC-19 y AC-UX-15, 16: cifras de resultado conocido, tabs en la dirección y periodo real", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto("/metricas");
        await page.getByRole("navigation", { name: "Vistas de Métricas" }).getByRole("link", { name: "Decisor frente a regla" }).click();
        await expect(page).toHaveURL(/\/metricas\?vista=comparacion$/);
        await expect(page.getByText(/Periodo real: .* a .*\(UTC−6\) · el decisor se activó el /)).toBeVisible();
        const d = C.activacion.decisor;
        const r = C.activacion.regla;
        const k = C.activacion.coincidencia;
        const t = (x: string) => sinNbsp(x);
        const tx = async (e: string) => t(await fila(page, e).innerText());
        expect(await tx("Entradas")).toContain(`${d.entradas}`);
        expect(await tx("Entradas")).toContain(`${r.cuentan}`);
        expect(await tx("Bloqueadas por el tope (hipotético)")).toContain(`${r.bloqueadasPorTope}`);
        const cerradas = await tx("Entradas cerradas");
        expect(cerradas).toContain(`${d.cerradas}`);
        expect(cerradas).toContain(`${r.cerradas}`);
        const tasa = await tx("Tasa de aciertos");
        expect(tasa).toContain(`${d.tasa.pct} %`);
        expect(tasa).toContain(`${d.tasa.aciertos} de ${d.tasa.cerradas} entradas cerradas`);
        expect(tasa).toContain(`${r.tasa.pct} %`);
        expect(tasa).toContain(`${r.tasa.aciertos} de ${r.tasa.cerradas}`);
        const nivel = await tx("PnL a nivel (comparable)");
        expect(nivel).toContain(`+${d.pnlANivelUsd} USD`);
        expect(nivel).toContain(`+${r.pnlANivelUsd} USD`);
        expect(await tx("PnL neto real")).toContain(`+${d.pnlNetoRealUsd} USD`);
        expect(await tx("Rechazadas por regla (R1 a R11)")).toContain("R11 entradas abiertas: 1");
        const ev = await tx("Entradas evitadas (hipotético)");
        expect(ev).toContain(`${d.evitadas.total}`);
        expect(ev).toContain(`stop loss: ${d.evitadas.stopLoss} · take profit: ${d.evitadas.takeProfit} · pendientes: ${d.evitadas.pendientes} · sin precio de entrada: ${d.evitadas.sinPrecio}`);
        // 2×2: los cuatro conteos suman las decisiones del periodo.
        const tabla = page.getByRole("table", { name: "Señal de la regla y compra del decisor" });
        const celdas = (await tabla.locator("td").allInnerTexts()).filter((x) => x.trim() !== "").map((x) => Number(x.trim().split(/\s/)[0]));
        expect(celdas).toEqual([k.senalCompro, k.senalNoCompro, k.sinSenalCompro, k.sinSenalNoCompro]);
        await expect(page.getByText(`${celdas.reduce((a, b) => a + b, 0)} decisiones en el periodo`)).toBeVisible();
        // AC-UX-16: las celdas de desacuerdo no usan "evitadas", que es la métrica de arriba.
        await expect(tabla).toContainText("la regla entra, el decisor no");
        await expect(tabla).toContainText("el decisor entra, la regla no");
        await expect(tabla).not.toContainText("evitadas por el decisor");
        await sinScroll(page);
        await capturar(page, m.ancho, "s4_comparacion");
      });

      test("AC-UX-14: lo hipotético lleva la palabra y la columna de la regla no usa colores de dinero", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto("/metricas?vista=comparacion");
        for (const e of ["Entradas", "Entradas cerradas", "Tasa de aciertos", "PnL a nivel (comparable)"]) {
          await expect(fila(page, e)).toContainText("hipotético");
        }
        expect(await fila(page, "PnL a nivel (comparable)").locator(".text-pos, .text-neg").count()).toBe(0);
        expect(await page.locator("[aria-labelledby='evitadas'] .text-pos, [aria-labelledby='evitadas'] .text-neg").count()).toBe(0);
      });

      test("AC-UX-15: filtros de activo y periodo con las cifras de cada corte", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto("/metricas?vista=comparacion&periodo=7d");
        expect(sinNbsp(await fila(page, "Tasa de aciertos").innerText())).toContain(`${C.d7.regla.tasa.pct} %`);
        expect(sinNbsp(await fila(page, "Entradas evitadas (hipotético)").innerText())).toContain(`stop loss: ${C.d7.decisor.evitadas.stopLoss} · take profit: ${C.d7.decisor.evitadas.takeProfit}`);
        await page.goto("/metricas?vista=comparacion&activo=BTC%2FUSD");
        expect(sinNbsp(await fila(page, "PnL a nivel (comparable)").innerText())).toContain(`+${C.btc.regla.pnlANivelUsd} USD`);
        await expect(page.getByRole("combobox", { name: "Activo" }).or(page.getByLabel("Activo")).first()).toBeVisible();
      });

      test("AC-20 y AC-UX-17: evitadas y rechazadas con confianza y razonamiento; abrir y volver conserva todo", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto("/metricas?vista=comparacion&hipotetico=take_profit&activo=SOL%2FUSD");
        await expect(page.getByRole("heading", { level: 2, name: /^Entradas evitadas/ })).toContainText("(1)");
        const lista = page.getByRole("list").filter({ has: page.locator("[data-literal]") }).first();
        await expect(lista).toContainText("Habría cerrado por take profit");
        await expect(lista).toContainText(/Confianza 0\.72 · Tendencia al alza/);
        await lista.getByRole("link", { name: /Ver detalle/ }).click();
        await expect(page.getByRole("heading", { level: 2, name: "Resultado hipotético" })).toBeVisible();
        // B-4: la fracción guardada (0.0348) se muestra como porcentaje, no como "+0.03 %".
        expect(sinNbsp(await page.getByText("PnL a nivel (hipotético)").locator("xpath=..").innerText())).toContain("+3.48 %");
        await expect(page.getByRole("heading", { level: 2, name: "Decisión del decisor" })).toBeVisible();
        await expect(page.getByText("Razonamiento del decisor (texto del agente, literal)")).toBeVisible();
        await page.locator("main").getByRole("link", { name: "Métricas" }).click();
        await expect(page).toHaveURL(/vista=comparacion/);
        await expect(page).toHaveURL(/hipotetico=take_profit/);
        await expect(page).toHaveURL(/activo=SOL%2FUSD/);
        // La rechazada abre su S3 con la regla que la rechazó.
        await page.goto("/metricas?vista=comparacion");
        const rech = page.getByRole("list", { name: /Rechazadas por regla/ });
        await expect(rech).toContainText("Rechazada (R11 entradas abiertas)");
        await rech.getByRole("link", { name: /Ver detalle/ }).click();
        await expect(page.getByText("R11 entradas abiertas").locator("visible=true").first()).toBeVisible();
        await page.locator("main").getByRole("link", { name: "Métricas" }).click();
        await expect(page).toHaveURL(/\/metricas\?vista=comparacion/);
      });

      test("AC-UX-17: el filtro de resultado incluye 'Sin precio de entrada' y el vacío ofrece quitarlo", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto("/metricas?vista=comparacion&hipotetico=sin_precio_entrada");
        await expect(page.getByRole("heading", { level: 2, name: /^Entradas evitadas/ })).toContainText("(1)");
        await page.goto("/metricas?vista=comparacion&hipotetico=stop_loss&activo=SOL%2FUSD");
        await expect(page.getByText("Ninguna entrada evitada coincide con el resultado elegido.")).toBeVisible();
        await page.getByRole("link", { name: "Quitar el filtro" }).click();
        await expect(page).not.toHaveURL(/hipotetico=/);
      });

      test("AC-UX-18: sin activar, sin entradas cerradas y ciclo apagado", async ({ page }) => {
        sembrar("ejecutada-y-rechazada");
        await page.goto(`${url(PUERTOS.normal)}/metricas?vista=comparacion`);
        await expect(page.getByText("La comparación empieza cuando se activa el decisor")).toBeVisible();
        await expect(page.getByRole("table", { name: /Decisor frente a regla/ })).toHaveCount(0);
        sembrar("decisor-alerta");
        await page.goto("/metricas?vista=comparacion");
        await expect(fila(page, "Tasa de aciertos")).toContainText("0 entradas cerradas");
        expect(sinNbsp(await fila(page, "Tasa de aciertos").innerText())).not.toContain("0 %");
        await cambiarModos(60, { ciclo: "apagado", decisor: "ejecuta" });
        await page.goto("/metricas?vista=comparacion");
        await expect(fila(page, "Tasa de aciertos")).toContainText(/Sin serie de la regla: el ciclo está apagado desde \d+ \w+ \d{2}:\d{2} \(UTC−6\)/);
      });

      test("AC-UX-18: con la red limitada no hay cifras mientras carga", async ({ page, context }) => {
        sembrar("decisor-comparacion");
        const r = await vigilarCarga(page, context, "/metricas?vista=comparacion");
        expect(r.visto).toBeGreaterThan(0);
        expect(r.textosConDato).toEqual([]);
      });

      test("AC-UX-18: un fallo en la comparación muestra su error y no oculta Cartera ni la banda", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto(`${url(PUERTOS.fallaComparacion)}/metricas?vista=comparacion`);
        await expect(page.getByRole("alert").filter({ hasText: "No se pudo cargar la comparación" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Decisor, última ranura" })).toBeVisible();
        await page.getByRole("navigation", { name: "Vistas de Métricas" }).getByRole("link", { name: "Cartera" }).click();
        await expect(page.getByText("Tasa de aciertos").first()).toBeVisible();
        await expect(page.getByRole("alert").filter({ hasText: "la comparación" })).toHaveCount(0);
      });

      test("AC-UX-19: sin controles para cambiar modos ni decidir en las superficies nuevas", async ({ page }) => {
        sembrar("decisor-comparacion");
        for (const ruta of ["/metricas?vista=comparacion", "/ejecuciones?vista=decisor"]) {
          await page.goto(ruta);
          await expect(page.getByRole("button", { name: MALOS })).toHaveCount(0);
          await expect(page.locator("form[method='post']")).toHaveCount(0);
        }
      });
    });

    test.describe("recorridos (AC-UX-21)", () => {
      test("por qué no compró: banda, S5 Decisor y detalle (2 toques)", async ({ page }) => {
        sembrar("decisor-banda-parcial");
        await page.goto("/");
        await page.getByRole("region", { name: "Decisor, última ranura" }).getByRole("link", { name: "Ver el historial del decisor" }).click();
        await expect(page).toHaveURL(/vista=decisor/);
        await page.getByRole("link", { name: /^BTC\/USD: No comprar/ }).first().click();
        await expect(page.getByRole("heading", { level: 2, name: "Decisión del decisor" })).toBeVisible();
        await expect(page.getByText("Razonamiento del decisor (texto del agente, literal)")).toBeVisible();
      });

      test("por qué entró la última operación del decisor: 1 toque desde S1", async ({ page }) => {
        sembrar("decisor-decisiones");
        await page.goto("/");
        await page.getByRole("link", { name: /Ver la propuesta de las/ }).first().click();
        await expect(page).toHaveURL(/\/propuestas\/[0-9a-f-]{36}/);
        await expect(page.getByRole("heading", { level: 2, name: "Decisión del decisor" })).toBeVisible();
      });

      test("la comparación: 2 toques desde S1", async ({ page }) => {
        sembrar("decisor-comparacion");
        await page.goto("/");
        await page.getByRole("navigation", { name: movil ? "Principal (móvil)" : "Principal" }).getByRole("link", { name: "Métricas" }).click();
        await page.getByRole("navigation", { name: "Vistas de Métricas" }).getByRole("link", { name: "Decisor frente a regla" }).click();
        await expect(page.getByRole("table", { name: /Decisor frente a regla/ }).or(page.getByRole("list", { name: /Decisor frente a regla/ }))).toBeVisible();
      });
    });

    test.describe("axe (AC-UX-22)", () => {
      const casos: [string, string][] = [
        ["decisor-ranuras", "/ejecuciones?vista=decisor"],
        ["decisor-ranuras", "/ejecuciones?vista=decisor&estado=sin_llegar"],
        ["decisor-comparacion", "/metricas?vista=comparacion"],
        ["decisor-comparacion", "/metricas?vista=comparacion&hipotetico=stop_loss"],
        ["decisor-decisiones", "DETALLE:no_comprar"],
        ["decisor-decisiones", "DETALLE:contexto_vencido"],
        ["decisor-inyeccion", "DETALLE:invalida"],
        ["ciclo-solo-registra", "/ejecuciones?resultado=senal_registrada"],
      ];
      for (const [escenario, ruta] of casos) {
        test(`axe wcag2a/aa/21aa/22aa y sin scroll horizontal: ${escenario} ${ruta}`, async ({ page }) => {
          sembrar(escenario);
          const puerto = escenario === "ciclo-solo-registra" ? PUERTOS.cicloSoloRegistra : PUERTOS.decisorEjecuta;
          if (ruta.startsWith("DETALLE:")) {
            const caso = ruta.slice(8);
            const donde = caso === "no_comprar" ? "decision = 'no_comprar' AND valida" : caso === "contexto_vencido" ? "motivo = 'contexto_vencido'" : "NOT valida AND activo IS NULL OR (NOT valida)";
            const [d] = await consultarBase<{ id: string }>(`SELECT id FROM decisiones WHERE ${donde} ORDER BY recibida_en DESC LIMIT 1`);
            await page.goto(`${url(puerto)}/ejecuciones/decisiones/${d.id}`);
          } else {
            await page.goto(`${url(puerto)}${ruta}`);
            if (escenario === "ciclo-solo-registra") await page.getByRole("link", { name: /^BTC\/USD: Señal \(solo registro\)/ }).first().click();
          }
          await page.waitForLoadState("networkidle");
          await expect(page.locator("[data-cargando]")).toHaveCount(0);
          await sinScroll(page);
          const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
          const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
        });
      }
    });
  });
}
