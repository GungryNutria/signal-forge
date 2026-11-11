import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { deCentavos } from "@/core/dinero";
import { pnlNetoCentavos } from "@/core/pnl";
import { detalleEvaluacion, listarEjecuciones } from "@/server/consultas/ejecuciones";
import { resumenCartera } from "@/server/consultas/cartera";
import { estadoSistema } from "@/server/consultas/estado";
import { ultimasInvestigaciones } from "@/server/consultas/investigaciones";
import { detallePropuesta, listarPropuestas } from "@/server/consultas/propuestas";
import { sembrar } from "../../scripts/sembrar";
import { abrirPool, urlDePrueba, vaciarBase } from "./arnes";

// T-10: el read model del dashboard contra los escenarios sembrados (S1 a S5, REQ-6, REQ-41, REQ-43, REQ-44).

let pool: Pool;
async function con(escenario: string) {
  await vaciarBase();
  await sembrar(pool, escenario);
}

beforeAll(() => {
  process.env.DATABASE_URL = urlDePrueba();
  process.env.APP_ENV = "test";
  process.env.TRADING_PAUSADO = "false";
  pool = abrirPool(3);
});
afterEach(() => {
  process.env.TRADING_PAUSADO = "false";
  process.env.APP_ENV = "test";
  delete process.env.SF_FALLA_INYECTADA;
});
afterAll(() => pool.end());

describe("base vacía", () => {
  it("estado vacío: ni alertas ni ceros inventados", async () => {
    await vaciarBase();
    const ahora = new Date();
    const e = await estadoSistema(ahora);
    expect(e.modo).toBe("operando");
    expect(e.ultimaEjecucion).toBeNull();
    expect(e.cicloDetenido).toBeNull();
    expect(e.investigacionPorActivo).toEqual({ "BTC/USD": null, "SOL/USD": null });
    expect(e.broker).toEqual({ ok: true, leidoEn: null, desactualizado: false });
    expect(e.horaDatos).toBeNull();
    expect(new Date(e.proximaEjecucion).getTime()).toBeGreaterThan(ahora.getTime());
    expect(new Date(e.proximaInvestigacion).getUTCMinutes()).toBe(15);

    const c = await resumenCartera(ahora);
    expect(c).toMatchObject({ saldoVirtualUsd: "10000.00", valorCarteraUsd: "10000.00", pnlAcumuladoUsd: "0.00", lotesAbiertos: [], vacio: true });
    expect(await listarPropuestas()).toEqual({ filas: [], total: 0, siguiente: null, anterior: null });
    expect(await listarEjecuciones()).toEqual({ filas: [], total: 0, siguiente: null, anterior: null });
    expect(await ultimasInvestigaciones(ahora)).toEqual({ "BTC/USD": null, "SOL/USD": null });
    expect(await detallePropuesta("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await detallePropuesta("no-es-uuid")).toBeNull();
  });
});

describe("ciclo detenido (REQ-44, AC-37)", () => {
  it("46 min: alerta con la hora de inicio; 44 min: sin alerta", async () => {
    await con("ciclo-detenido-46");
    const e46 = await estadoSistema(new Date());
    expect(e46.cicloDetenido).toEqual({ desde: e46.ultimaEjecucion!.inicio });
    await con("ciclo-44");
    expect((await estadoSistema(new Date())).cicloDetenido).toBeNull();
  });
});

describe("investigación (REQ-41, AC-35)", () => {
  it("59 min vigente, 61 vencida y sin alerta", async () => {
    await con("investigacion-59-61");
    const i = (await estadoSistema(new Date())).investigacionPorActivo;
    expect(i["BTC/USD"]).toMatchObject({ antiguedadMin: 59, vigente: true, alerta: false });
    expect(i["SOL/USD"]).toMatchObject({ antiguedadMin: 61, vigente: false, alerta: false });
    const u = await ultimasInvestigaciones(new Date());
    expect(u["BTC/USD"]).toMatchObject({ vigente: true, sentimiento: "0.420", confianza: "0.800", noticiaFuerte: false });
    expect(u["SOL/USD"]?.vigente).toBe(false);
  });

  it("alerta solo para el activo con más de 2 h", async () => {
    await con("investigacion-sol-121-btc-30");
    const i = (await estadoSistema(new Date())).investigacionPorActivo;
    expect(i["SOL/USD"]).toMatchObject({ antiguedadMin: 121, alerta: true });
    expect(i["BTC/USD"]).toMatchObject({ antiguedadMin: 30, alerta: false, vigente: true });
  });

  it("a 1 h 59 min no hay alerta", async () => {
    await con("investigacion-119");
    const i = (await estadoSistema(new Date())).investigacionPorActivo;
    expect(i["SOL/USD"]).toMatchObject({ antiguedadMin: 119, alerta: false, vigente: false });
  });

  it("una rechazada no cuenta como última investigación", async () => {
    await con("investigacion-119");
    await pool.query("INSERT INTO investigaciones (estado, motivo, activo) VALUES ('rechazada', 'investigacion_invalida', 'SOL/USD')");
    expect((await ultimasInvestigaciones(new Date()))["SOL/USD"]?.antiguedadMin).toBe(119);
  });
});

describe("pausas (REQ-30, REQ-31)", () => {
  it("automática: PnL del día frente al límite y hora en que se levanta", async () => {
    await con("pausa-auto");
    const ahora = new Date();
    const e = await estadoSistema(ahora);
    expect(e.modo).toBe("pausa_automatica");
    expect(e.pausaAutomatica).toMatchObject({ pnlDiaUsd: "-312.00", pnlDiaPct: "-3.12", limiteUsd: "-300.00", limitePct: "-3" });
    const sale = new Date(e.pausaAutomatica!.seLevantaEn);
    expect(sale.getTime()).toBeGreaterThan(ahora.getTime());
    expect(sale.getUTCHours() + sale.getUTCMinutes()).toBe(0);
    expect((await resumenCartera(ahora)).pnlDiaUsd).toBe("-312.00");
  });

  it("manual: gana sobre la automática y la deja visible", async () => {
    await con("pausa-auto");
    process.env.TRADING_PAUSADO = "true";
    const e = await estadoSistema(new Date());
    expect(e.modo).toBe("pausa_manual");
    expect(e.pausaAutomatica).not.toBeNull();
    await con("pausa-manual");
    expect((await estadoSistema(new Date())).modo).toBe("pausa_manual");
  });

  it("sin eventos, opera", async () => {
    await con("ejecutada-y-rechazada");
    const e = await estadoSistema(new Date());
    expect(e.modo).toBe("operando");
    expect(e.pausaAutomatica).toBeNull();
  });
});

describe("broker (REQ-6, AC-UX-5)", () => {
  it("lectura vieja con error posterior: desactualizado, sin precio actual ni valor de cartera", async () => {
    await con("broker-caido");
    const ahora = new Date();
    const e = await estadoSistema(ahora);
    expect(e.broker.ok).toBe(false);
    expect(e.broker.desactualizado).toBe(true);
    expect(e.broker.leidoEn).not.toBeNull();
    const c = await resumenCartera(ahora);
    expect(c.lotesAbiertos).toHaveLength(1);
    expect(c.lotesAbiertos[0]).toMatchObject({ precioActual: null, pnlNoRealizadoUsd: null });
    expect(c.valorCarteraUsd).toBeNull();
    expect(c.pnlDiaUsd).toBeNull();
    expect(c.saldoVirtualUsd).toBe("10000.00");
    // Lo del registro propio sigue visible.
    expect((await listarPropuestas()).total).toBe(1);
    expect((await ultimasInvestigaciones(ahora))["BTC/USD"]).not.toBeNull();
  });

  it("lecturas frescas: broker ok", async () => {
    await con("ciclo-44");
    expect((await estadoSistema(new Date())).broker).toMatchObject({ ok: true, desactualizado: false });
  });
});

describe("órdenes en estado desconocido (R9, AC-UX-6)", () => {
  it("se listan con su activo y su propuesta, y la fila dice desconocido", async () => {
    await con("orden-desconocida");
    const e = await estadoSistema(new Date());
    expect(e.ordenesDesconocidas).toHaveLength(1);
    expect(e.ordenesDesconocidas[0]).toMatchObject({ activo: "BTC/USD" });
    const p = await listarPropuestas({ estado: "desconocido" });
    expect(p.filas).toHaveLength(1);
    expect(p.filas[0].id).toBe(e.ordenesDesconocidas[0].propuestaId);
  });
});

describe("S1 a S3 con una ejecutada y una rechazada (AC-21)", () => {
  beforeAll(() => con("ejecutada-y-rechazada"));

  it("resumen: saldo realizado, lote abierto con SL/TP y PnL no realizado a bid", async () => {
    const c = await resumenCartera(new Date());
    expect(c.saldoVirtualUsd).toBe("10004.95"); // +17.40 (TP) y -12.45 (SL)
    expect(c.pnlAcumuladoUsd).toBe("4.95");
    expect(c.vacio).toBe(false);
    expect(c.lotesAbiertos).toHaveLength(1);
    const [l] = c.lotesAbiertos;
    expect(l).toMatchObject({ activo: "BTC/USD", precioEntrada: "100000.0000000000", precioActual: "101500" });
    expect(Number(l.stopLoss)).toBeCloseTo(98_000);
    expect(Number(l.takeProfit)).toBeCloseTo(104_000);
    const noReal = deCentavos(pnlNetoCentavos(Math.round(Number(l.nocionalEntradaUsd) * 100), Number(l.cantidad), 101_500));
    expect(l.pnlNoRealizadoUsd).toBe(noReal);
    expect(c.pnlNoRealizadoUsd).toBe(noReal);
    expect(c.valorCarteraUsd).toBe(deCentavos(1_000_495 + pnlNetoCentavos(50_000, Number(l.cantidad), 101_500)));
    expect(c.pnlDiaUsd).not.toBeNull();
  });

  it("lista con filtros que se combinan y total filtrado", async () => {
    expect((await listarPropuestas()).total).toBe(4);
    expect((await listarPropuestas({ decision: "ejecutada" })).total).toBe(3);
    expect((await listarPropuestas({ decision: "rechazada" })).total).toBe(1);
    expect((await listarPropuestas({ activo: "SOL/USD" })).total).toBe(2);
    expect((await listarPropuestas({ activo: "SOL/USD", decision: "ejecutada" })).total).toBe(1);
    expect((await listarPropuestas({ activo: "BTC/USD", decision: "rechazada" }))).toMatchObject({ filas: [], total: 0 });
    for (const [estado, n] of [["abierta", 1], ["cerrada_tp", 1], ["cerrada_sl", 1], ["pendiente_llenado", 0]] as const)
      expect((await listarPropuestas({ estado })).total, estado).toBe(n);
  });

  it("filas: más recientes primero, regla principal con valor y límite, y PnL solo en las cerradas", async () => {
    const { filas } = await listarPropuestas();
    const tiempos = filas.map((f) => Date.parse(f.recibidaEn));
    expect(tiempos).toEqual([...tiempos].sort((a, b) => b - a));
    const rechazada = filas.find((f) => f.decision === "rechazada")!;
    expect(rechazada).toMatchObject({
      activo: "SOL/USD",
      estado: null,
      pnlUsd: null,
      reglaPrincipal: { regla: "R3", observado: "1001.00 USD", limite: "1000.00 USD" },
      masReglas: 0,
    });
    const abierta = filas.find((f) => f.estado === "abierta")!;
    expect(abierta).toMatchObject({ pnlUsd: null, reglaPrincipal: null, nocionalUsd: "500.00" });
    expect(filas.find((f) => f.estado === "cerrada_tp")?.pnlUsd).toBe("17.40");
    expect(filas.find((f) => f.estado === "cerrada_sl")?.pnlUsd).toBe("-12.45");
  });

  it("detalle de la rechazada: R1 a R11 con las incumplidas primero", async () => {
    const id = (await listarPropuestas({ decision: "rechazada" })).filas[0].id;
    const d = (await detallePropuesta(id))!;
    expect(d.reglas).toHaveLength(11);
    expect(d.reglas[0]).toMatchObject({ regla: "R3", estado: "incumple" });
    expect(d.reglas.slice(1).every((r) => r.estado !== "incumple")).toBe(true);
    expect(d.reglas.find((r) => r.regla === "R2")?.estado).toBe("no_aplica");
    expect(d.ordenes).toEqual([]);
    expect(d.lote).toBeNull();
    expect(d.etiqueta.estado).toBe("no_aplica");
    expect(d.reglaEntrada).toHaveProperty("entradas");
    expect(d.ejecucion?.versionRegla).toBe("tendencia-sma-v1");
    expect(d.investigacion).toMatchObject({ antiguedadMin: 35 - 12 }); // SOL: recibida hace 35 min, evaluada hace 12
  });

  it("detalle de la cerrada en TP: órdenes, lote, etiqueta y respuesta del broker", async () => {
    const id = (await listarPropuestas({ estado: "cerrada_tp" })).filas[0].id;
    const d = (await detallePropuesta(id))!;
    expect(d.decision).toBe("ejecutada");
    expect(d.ordenes.map((o) => o.tramo)).toEqual(["entrada", "salida"]);
    expect(d.ordenes[0].estado).toBe("llenada");
    expect(d.ordenes[0].respuestaBroker).toMatchObject({ status: "filled" });
    expect(d.ordenes[0].eventos.map((e) => e.estado)).toEqual(["pendiente_envio", "enviada", "llenada"]);
    expect(d.lote).toMatchObject({ comisionBps: 25 });
    expect(d.etiqueta).toMatchObject({ estado: "cerrada", exito: 1, motivoCierre: "take_profit", pnlNetoUsd: "17.40" });
    expect(d.etiqueta.duracionMin).toBeGreaterThan(0);
    expect(d.investigacion).toBeNull(); // esa evaluación se sembró sin investigación
  });

  it("detalle de la abierta: etiqueta pendiente y la investigación adjunta con su antigüedad al evaluar", async () => {
    const id = (await listarPropuestas({ estado: "abierta" })).filas[0].id;
    const d = (await detallePropuesta(id))!;
    expect(d.etiqueta).toMatchObject({ estado: "pendiente", exito: null, pnlNetoUsd: null });
    expect(d.investigacion).toMatchObject({ sentimiento: "0.650", noticiaFuerte: true, antiguedadMin: 8, vigente: true, alerta: false });
    expect(d.investigacion?.fuentes).toEqual(["https://example.com/btc/nota"]);
  });
});

describe("rechazada por el broker (AC-UX-32)", () => {
  it("entrada rechazada o no enviada: estado propio, sin PnL, con la respuesta o su ausencia", async () => {
    await con("rechazada-por-broker");
    const { filas } = await listarPropuestas({ estado: "rechazada_broker" });
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.decision === "ejecutada" && f.pnlUsd === null)).toBe(true);
    expect((await listarPropuestas({ estado: "abierta" })).total).toBe(0);
    const detalles = await Promise.all(filas.map((f) => detallePropuesta(f.id)));
    const estados = detalles.map((d) => d!.ordenes[0].estado).sort();
    expect(estados).toEqual(["no_enviada", "rechazada"]);
    const rechazada = detalles.find((d) => d!.ordenes[0].estado === "rechazada")!;
    expect(rechazada.ordenes[0].respuestaBroker).toMatchObject({ status: 403 });
    expect(rechazada.lote).toBeNull();
    expect(rechazada.etiqueta.estado).toBe("no_aplica");
  });
});

describe("casos de AC-9 (AC-UX-11)", () => {
  it("cada fila trae la regla principal y «+N» si hay más", async () => {
    await con("casos-ac9");
    const { filas } = await listarPropuestas({ decision: "rechazada" });
    const principales = filas.map((f) => f.reglaPrincipal?.regla ?? f.motivo).sort();
    expect(principales).toEqual(["R1", "R10", "R3", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "propuesta_invalida"].sort());
    const doble = filas.find((f) => f.masReglas === 1)!;
    expect(doble.reglaPrincipal?.regla).toBe("R3");
    const invalida = filas.find((f) => f.motivo === "propuesta_invalida")!;
    expect(invalida).toMatchObject({ activo: null, reglaPrincipal: null, masReglas: 0 });
    expect((await detallePropuesta(invalida.id))!.reglas).toEqual([]);
    expect((await listarPropuestas({ decision: "error" })).total).toBe(1); // R2: venta no habilitada
  });
});

describe("S5 Ejecuciones (REQ-43, AC-36)", () => {
  beforeAll(() => con("ejecuciones-por-caso"));

  it("lista los cinco casos, más recientes primero, con resultado por activo", async () => {
    const r = await listarEjecuciones();
    expect(r.total).toBe(5);
    expect(r.siguiente).toBeNull();
    expect(r.anterior).toBeNull();
    const inicios = r.filas.map((f) => Date.parse(f.inicio));
    expect(inicios).toEqual([...inicios].sort((a, b) => b - a));
    const [propuesta, datos, omitida, sinSenal, caida] = r.filas;
    expect(propuesta.porActivo["BTC/USD"]).toMatchObject({ resultado: "propuesta", decision: "ejecutada" });
    expect(propuesta.porActivo["BTC/USD"]?.propuestaId).toBeTruthy();
    expect(propuesta.porActivo["SOL/USD"]).toEqual({ resultado: "sin_senal" });
    expect(datos.porActivo).toEqual({ "BTC/USD": { resultado: "datos_no_disponibles" }, "SOL/USD": { resultado: "error" } });
    expect(omitida).toMatchObject({ estado: "omitida_solapamiento", porActivo: { "BTC/USD": null, "SOL/USD": null } });
    expect(sinSenal.porActivo["BTC/USD"]).toEqual({ resultado: "sin_senal" });
    expect(caida).toMatchObject({ estado: "error", error: "plazo interno de 120 s agotado" });
    expect(caida.porActivo).toEqual({ "BTC/USD": { resultado: "error" }, "SOL/USD": { resultado: "error" } });
    expect(propuesta.fin).not.toBeNull();
  });

  it("filtros por resultado y activo; las omitidas salen con cualquier activo solo si se filtran como tales", async () => {
    const total = async (f: Parameters<typeof listarEjecuciones>[0]) => (await listarEjecuciones(f)).total;
    expect(await total({ activo: "SOL/USD" })).toBe(5);
    expect(await total({ resultado: "omitida_solapamiento" })).toBe(1);
    expect(await total({ resultado: "omitida_solapamiento", activo: "BTC/USD" })).toBe(1);
    expect(await total({ resultado: "sin_senal" })).toBe(2);
    expect(await total({ resultado: "propuesta" })).toBe(1);
    expect(await total({ resultado: "propuesta", activo: "SOL/USD" })).toBe(0);
    expect(await total({ resultado: "error", activo: "SOL/USD" })).toBe(2);
    expect(await total({ resultado: "error", activo: "BTC/USD" })).toBe(1);
    expect(await total({ resultado: "datos_no_disponibles" })).toBe(1);
  });

  it("estadoSistema: última ejecución con su resultado por activo", async () => {
    const e = await estadoSistema(new Date());
    expect(e.ultimaEjecucion).toMatchObject({ estado: "completada", versionRegla: "tendencia-sma-v1" });
    expect(e.ultimaEjecucion?.porActivo["BTC/USD"]?.resultado).toBe("propuesta");
  });

  it("detalle de una evaluación sin señal: valores de la regla, resultado e investigación o ninguna", async () => {
    const { filas } = await listarEjecuciones();
    const d = (await detalleEvaluacion(filas[3].id, "SOL-USD"))!; // la forma de la URL
    expect(d.evaluacion).toMatchObject({ activo: "SOL/USD", resultado: "sin_senal" });
    expect(d.regla).toMatchObject({ version: "tendencia-sma-v1", resultado: { senal: false } });
    expect((d.regla as { entradas: { closes: string[] } }).entradas.closes).toHaveLength(49);
    expect(d.propuesta).toBeNull();
    expect(d.investigacion).toBeNull();
    expect(d.ejecucion).toMatchObject({ estado: "completada", versionRegla: "tendencia-sma-v1" });

    const conInv = (await detalleEvaluacion(filas[0].id, "BTC/USD"))!;
    expect(conInv.investigacion).toMatchObject({ antiguedadMin: 25 - 12, vigente: true });
    expect(conInv.propuesta).toMatchObject({ decision: "ejecutada" });

    const sinDatos = (await detalleEvaluacion(filas[1].id, "BTC/USD"))!;
    expect(sinDatos.regla).toMatchObject({ version: null });
    expect(sinDatos.evaluacion.errorDetalle).toMatch(/sin respuesta/);
  });

  it("detalle inexistente: null", async () => {
    const { filas } = await listarEjecuciones();
    expect(await detalleEvaluacion(filas[2].id, "BTC/USD")).toBeNull(); // la omitida no evaluó nada
    expect(await detalleEvaluacion(filas[0].id, "DOGE/USD")).toBeNull();
    expect(await detalleEvaluacion("no-es-uuid", "BTC/USD")).toBeNull();
  });
});

describe("paginación por cursor (50 por página)", () => {
  it("S5: 120 ejecuciones se recorren hacia atrás y hacia delante sin perder ni repetir filas", async () => {
    await vaciarBase();
    await pool.query(
      `WITH e AS (
         INSERT INTO ejecuciones (id, ranura, inicio, version_regla)
         SELECT gen_random_uuid(), now(), now() - (g || ' minutes')::interval, 'tendencia-sma-v1' FROM generate_series(1, 120) g
         RETURNING id)
       INSERT INTO ejecuciones_cierre (ejecucion_id, estado) SELECT id, 'completada' FROM e`,
    );
    const p1 = await listarEjecuciones();
    expect(p1).toMatchObject({ total: 120, anterior: null });
    expect(p1.filas).toHaveLength(50);
    const p2 = await listarEjecuciones({ antes: p1.siguiente! });
    expect(p2.filas).toHaveLength(50);
    expect(p2.anterior).not.toBeNull();
    const p3 = await listarEjecuciones({ antes: p2.siguiente! });
    expect(p3.filas).toHaveLength(20);
    expect(p3.siguiente).toBeNull();

    const ids = [...p1.filas, ...p2.filas, ...p3.filas].map((f) => f.id);
    expect(new Set(ids).size).toBe(120);
    const inicios = [...p1.filas, ...p2.filas, ...p3.filas].map((f) => Date.parse(f.inicio));
    expect(inicios).toEqual([...inicios].sort((a, b) => b - a));

    // «Más recientes» desde la última página vuelve a la segunda, y desde esa, a la primera.
    const vuelta2 = await listarEjecuciones({ antes: p3.anterior! });
    expect(vuelta2.filas.map((f) => f.id)).toEqual(p2.filas.map((f) => f.id));
    expect(vuelta2.siguiente).toBe(p2.siguiente);
    const vuelta1 = await listarEjecuciones({ antes: vuelta2.anterior! });
    expect(vuelta1.filas.map((f) => f.id)).toEqual(p1.filas.map((f) => f.id));
    expect(vuelta1.anterior).toBeNull();
  });

  it("S2: 60 propuestas, 50 + 10, y un cursor inventado se ignora", async () => {
    await vaciarBase();
    await pool.query(
      `INSERT INTO propuestas (es_original, entrada_cruda, recibida_en, decision, motivo)
       SELECT false, '{}', now() - (g || ' minutes')::interval, 'rechazada', 'propuesta_invalida' FROM generate_series(1, 60) g`,
    );
    const p1 = await listarPropuestas();
    expect(p1.filas).toHaveLength(50);
    expect(p1.total).toBe(60);
    const p2 = await listarPropuestas({ antes: p1.siguiente! });
    expect(p2.filas).toHaveLength(10);
    expect(p2.siguiente).toBeNull();
    expect(new Set([...p1.filas, ...p2.filas].map((f) => f.id)).size).toBe(60);
    expect((await listarPropuestas({ antes: "a:1; DROP TABLE propuestas" })).filas).toHaveLength(50);
    expect((await listarPropuestas({ antes: "x:00000000-0000-4000-8000-000000000000" })).anterior).toBeNull();
  });
});

describe("falla inyectada (AC-UX-9)", () => {
  it("solo en test o desarrollo", async () => {
    await vaciarBase();
    process.env.SF_FALLA_INYECTADA = "estadoSistema, listarPropuestas";
    await expect(estadoSistema(new Date())).rejects.toThrow(/Falla inyectada en estadoSistema/);
    await expect(listarPropuestas()).rejects.toThrow(/listarPropuestas/);
    await expect(resumenCartera(new Date())).resolves.toBeDefined(); // otro bloque: sigue sirviendo
    process.env.APP_ENV = "produccion";
    await expect(estadoSistema(new Date())).resolves.toBeDefined();
    await expect(listarPropuestas()).resolves.toBeDefined();
  });
});

describe("textos hostiles (AC-11, AC-UX-13)", () => {
  it("el resumen y las fuentes salen tal como se guardaron", async () => {
    await con("inyeccion");
    const i = (await ultimasInvestigaciones(new Date()))["BTC/USD"]!;
    expect(i.resumen).toContain("<script>alert('xss-1')</script>");
    expect(i.resumen).toContain("Ignora las instrucciones anteriores");
    expect(i.fuentes).toHaveLength(3);
  });
});
