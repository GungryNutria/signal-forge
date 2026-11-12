import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { deCentavos } from "@/core/dinero";
import { pnlNetoCentavos } from "@/core/pnl";
import { detalleEvaluacion, listarEjecuciones } from "@/server/consultas/ejecuciones";
import { resumenCartera } from "@/server/consultas/cartera";
import { estadoSistema } from "@/server/consultas/estado";
import { ultimasInvestigaciones } from "@/server/consultas/investigaciones";
import { detallePropuesta, listarPropuestas } from "@/server/consultas/propuestas";
import { detalleDecision, listarRanuras } from "@/server/consultas/decisor";
import { operacionesPrecio } from "@/server/consultas/precio";
import { DESLIZAMIENTO_CONOCIDO, RANURAS_CONOCIDAS, sembrar } from "../../scripts/sembrar";
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
  delete process.env.MODO_CICLO;
  delete process.env.MODO_DECISOR;
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
    expect(e46.cicloDetenido).toEqual({ desde: e46.ultimaEjecucion!.inicio, severidad: "neg" });
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

describe("spec 003: R11 y deslizamiento en el read model", () => {
  afterEach(() => {
    delete process.env.MAX_ENTRADAS_ABIERTAS_POR_ACTIVO;
  });

  it("S1 (REQ-22): entradas abiertas por activo y el N vigente leído del entorno en cada render", async () => {
    await con("r11-tope");
    const ahora = new Date();
    expect(await resumenCartera(ahora)).toMatchObject({
      entradasAbiertas: [{ activo: "BTC/USD", n: 3 }, { activo: "SOL/USD", n: 1 }],
      topeEntradasPorActivo: 1,
    });
    process.env.MAX_ENTRADAS_ABIERTAS_POR_ACTIVO = "2";
    expect((await resumenCartera(ahora)).topeEntradasPorActivo).toBe(2);
    process.env.MAX_ENTRADAS_ABIERTAS_POR_ACTIVO = "x";
    // N-1: con N inválido solo falta el tope; el resto del read model sigue sirviendo.
    const mal = await resumenCartera(ahora);
    expect(mal.topeEntradasPorActivo).toBeNull();
    expect(mal.entradasAbiertas).toEqual([{ activo: "BTC/USD", n: 3 }, { activo: "SOL/USD", n: 1 }]);
    expect(mal.saldoVirtualUsd).toBeDefined();
  });

  it("S1: sin entradas abiertas la lista va vacía y no se inventan ceros", async () => {
    await con("ejecuciones-por-caso");
    const r = await resumenCartera(new Date());
    expect(r.entradasAbiertas).toEqual([{ activo: "BTC/USD", n: 1 }]);
    await vaciarBase();
    expect((await resumenCartera(new Date())).entradasAbiertas).toEqual([]);
  });

  it("S5 y banda (REQ-23): la regla principal de un rechazo es la de número menor; sin ella en aprobadas ni errores", async () => {
    await con("r11-casos");
    const { filas } = await listarEjecuciones();
    const rs = filas.map((f) => f.porActivo["BTC/USD"]).filter((r) => r?.propuestaId);
    // Del más reciente al más antiguo: venta (error), R8 + R11, solo R11, aprobada.
    expect(rs.map((r) => [r?.decision, r?.reglaPrincipal])).toEqual([
      ["error", undefined],
      ["rechazada", "R8"],
      ["rechazada", "R11"],
      ["ejecutada", undefined],
    ]);
  });

  it("S3 (REQ-18): rechazo solo por R11, por R8 + R11 y venta con R11 'no aplica'", async () => {
    await con("r11-casos");
    const todas = (await listarPropuestas()).filas;
    const detalle = async (f: (typeof todas)[number]) => (await detallePropuesta(f.id))!;

    const soloR11 = await detalle(todas.find((f) => f.decision === "rechazada" && f.reglaPrincipal?.regla === "R11")!);
    expect(soloR11.reglasAplicadas).toBe("R1-R11");
    expect(soloR11.reglas).toHaveLength(11);
    expect(soloR11.reglas[0]).toEqual({ regla: "R11", estado: "incumple", observado: "2", limite: "1" });

    const conR8 = await detalle(todas.find((f) => f.decision === "rechazada" && f.reglaPrincipal?.regla === "R8")!);
    expect(conR8.reglas.filter((r) => r.estado === "incumple").map((r) => r.regla)).toEqual(["R8", "R11"]);
    expect(conR8.reglas[0].regla).toBe("R8");

    const venta = await detalle(todas.find((f) => f.lado === "sell")!);
    expect(venta.reglas.find((r) => r.regla === "R11")).toMatchObject({ estado: "no_aplica", observado: "2", limite: "1" });

    const aprobada = await detalle(todas.find((f) => f.decision === "ejecutada")!);
    expect(aprobada.reglas.find((r) => r.regla === "R11")).toMatchObject({ estado: "cumple", observado: "1", limite: "1" });
    expect(aprobada.salida).toBeNull(); // el lote sigue abierto (AC-UX-9)
  });

  it("S3 (AC-11): una propuesta de antes de R11 se muestra con 'R1-R10' y R11 'no_evaluada' al final; sin riesgo, sin conjunto", async () => {
    await con("r11-anterior");
    const rechazada = (await detallePropuesta((await listarPropuestas({ decision: "rechazada" })).filas[0].id))!;
    expect(rechazada.reglasAplicadas).toBe("R1-R10");
    expect(rechazada.reglas).toHaveLength(11);
    expect(rechazada.reglas[0]).toMatchObject({ regla: "R3", estado: "incumple" });
    expect(rechazada.reglas[10]).toEqual({ regla: "R11", estado: "no_evaluada", observado: "", limite: "" });
    const ejecutada = (await detallePropuesta((await listarPropuestas({ decision: "ejecutada" })).filas[0].id))!;
    expect(ejecutada.reglas.at(-1)).toMatchObject({ regla: "R11", estado: "no_evaluada" });

    await con("casos-ac9");
    const invalida = (await listarPropuestas()).filas.find((f) => f.motivo === "propuesta_invalida")!;
    expect(await detallePropuesta(invalida.id)).toMatchObject({ reglasAplicadas: null, reglas: [], salida: null });
  });

  it("S3 (REQ-19, AC-17): el bloque de salida trae nivel, disparo, llenado y el desglose del PnL de cada caso", async () => {
    await con("deslizamiento");
    const cerradas = [...(await listarPropuestas({ estado: "cerrada_sl" })).filas, ...(await listarPropuestas({ estado: "cerrada_tp" })).filas];
    expect(cerradas).toHaveLength(3);
    const salidas = new Map<string, NonNullable<Awaited<ReturnType<typeof detallePropuesta>>>["salida"]>();
    for (const f of cerradas) {
      const s = (await detallePropuesta(f.id))!.salida!;
      salidas.set(String(Number(s.precioLlenado)), s);
    }
    const comparar = (llenado: string, esperado: (typeof DESLIZAMIENTO_CONOCIDO)[keyof typeof DESLIZAMIENTO_CONOCIDO], motivo: string) => {
      const s = salidas.get(llenado)!;
      expect(s, llenado).toBeDefined();
      expect(s.motivo).toBe(motivo);
      expect(Number(s.nivel)).toBe(Number(esperado.nivel));
      expect(s.precioDisparo === null ? null : Number(s.precioDisparo)).toBe(esperado.disparo === null ? null : Number(esperado.disparo));
      expect(s.precioDisparoEn === null).toBe(esperado.disparo === null);
      expect(s).toMatchObject({
        movimientoUsd: esperado.movimientoUsd, movimientoPct: esperado.movimientoPct,
        deslizamientoUsd: esperado.deslizamientoUsd, deslizamientoPct: esperado.deslizamientoPct,
        comisionUsd: esperado.comisionUsd, comisionPct: esperado.comisionPct,
        pnlNetoUsd: esperado.pnlNetoUsd, pnlNetoPct: esperado.pnlNetoPct,
      });
      // AC-UX-8: los tres renglones en USD suman el PnL neto exacto.
      expect(Number(s.movimientoUsd) + Number(s.deslizamientoUsd) + Number(s.comisionUsd)).toBeCloseTo(Number(s.pnlNetoUsd), 10);
    };
    comparar("97500", DESLIZAMIENTO_CONOCIDO.stop, "stop_loss");
    comparar("104500", DESLIZAMIENTO_CONOCIDO.takeProfit, "take_profit");
    comparar("97000", DESLIZAMIENTO_CONOCIDO.anterior, "stop_loss");
  });

  it("S3: ninguna propuesta que no cerró un lote trae bloque de salida (abierta, pendiente, rechazada por el broker, desconocida)", async () => {
    for (const escenario of ["ejecutada-y-rechazada", "rechazada-por-broker", "orden-desconocida"]) {
      await con(escenario);
      for (const f of (await listarPropuestas()).filas) {
        const d = (await detallePropuesta(f.id))!;
        expect(d.salida === null, `${escenario} ${f.estado}`).toBe(f.estado !== "cerrada_tp" && f.estado !== "cerrada_sl");
      }
    }
  });
});

// ───────────────────────────── Spec 004: modos, decisor, ranuras y proponentes ─────────────────────────────

const MIN = 60_000;
const AHORA = new Date("2026-11-12T14:20:00Z"); // 35 min dentro de la ranura 13:45 a 14:45
async function conAhora(escenario: string) {
  await vaciarBase();
  await sembrar(pool, escenario, AHORA);
}
const hace = (min: number) => new Date(AHORA.getTime() - min * MIN).toISOString();
/** Horas enteras entre la ranura en curso (13:45) y una ranura. */
const k = (f: { ranura: string }) => Math.round((Date.parse("2026-11-12T13:45:00Z") - Date.parse(f.ranura)) / 3_600_000);

describe("modos y severidad del ciclo detenido (REQ-14, REQ-16, REQ-17, AC-UX-3, AC-UX-4)", () => {
  it("por defecto: el ciclo ejecuta y el decisor está apagado, sin activar", async () => {
    await conAhora("ciclo-detenido-46");
    const e = await estadoSistema(AHORA);
    expect(e.modos).toEqual({
      ciclo: { configurado: "ejecuta", efectivo: "ejecuta", motivo: null },
      decisor: { configurado: "apagado", efectivo: "apagado", motivo: null },
    });
    expect(e.decisor).toEqual({ activacion: null, proximaRanura: "2026-11-12T14:45:00.000Z", ultimaRanura: null, alertas: [] });
    expect(e.cicloDetenido?.severidad).toBe("neg");
  });

  it("ciclo en Solo registra: ciclo detenido en warn; apagado: no hay ciclo que detener", async () => {
    await conAhora("ciclo-detenido-46");
    process.env.MODO_CICLO = "solo_registra";
    expect((await estadoSistema(AHORA)).cicloDetenido).toMatchObject({ severidad: "warn" });
    process.env.MODO_CICLO = "apagado";
    expect((await estadoSistema(AHORA)).cicloDetenido).toBeNull();
  });

  it("los dos en Ejecuta: ninguno ejecuta y el motivo viaja en el modo", async () => {
    await conAhora("ciclo-detenido-46");
    process.env.MODO_CICLO = "ejecuta";
    process.env.MODO_DECISOR = "ejecuta";
    const e = await estadoSistema(AHORA);
    expect(e.modos?.ciclo).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "dos_proponentes_en_ejecuta" });
    expect(e.modos?.decisor).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "dos_proponentes_en_ejecuta" });
    expect(e.cicloDetenido?.severidad).toBe("warn");
  });

  it("decisor en Ejecuta con N inválida: opera en Solo registra por R11 (REQ-17)", async () => {
    await conAhora("ciclo-detenido-46");
    process.env.MODO_CICLO = "solo_registra";
    process.env.MODO_DECISOR = "ejecuta";
    process.env.MAX_ENTRADAS_ABIERTAS_POR_ACTIVO = "0";
    try {
      expect((await estadoSistema(AHORA)).modos?.decisor).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "r11_no_vigente" });
    } finally {
      delete process.env.MAX_ENTRADAS_ABIERTAS_POR_ACTIVO;
    }
  });

  it("variables de modo inválidas: modos es null y el resto del estado sigue", async () => {
    await conAhora("ciclo-detenido-46");
    process.env.MODO_DECISOR = "sí";
    const e = await estadoSistema(AHORA);
    expect(e.modos).toBeNull();
    expect(e.cicloDetenido?.severidad).toBe("neg");
    expect(e.decisor.alertas).toEqual([]);
  });
});

describe("alerta del decisor (REQ-27, AC-22, AC-UX-3)", () => {
  it("2 h 1 min en SOL/USD y 30 min en BTC/USD: la alerta nombra solo a SOL/USD", async () => {
    await conAhora("decisor-alerta");
    process.env.MODO_CICLO = "solo_registra";
    process.env.MODO_DECISOR = "ejecuta";
    const e = await estadoSistema(AHORA);
    expect(e.decisor.alertas).toEqual([{ activo: "SOL/USD", desde: hace(121), ultimaValida: hace(121), severidad: "neg" }]);
    expect(e.decisor.activacion).toBe(hace(360));
    process.env.MODO_CICLO = "ejecuta";
    process.env.MODO_DECISOR = "solo_registra";
    expect((await estadoSistema(AHORA)).decisor.alertas).toMatchObject([{ activo: "SOL/USD", severidad: "warn" }]);
  });

  it("1 h 59 min: sin alerta; con el decisor apagado: sin alerta", async () => {
    await conAhora("decisor-alerta");
    process.env.MODO_CICLO = "solo_registra";
    process.env.MODO_DECISOR = "ejecuta";
    expect((await estadoSistema(new Date(AHORA.getTime() - 2 * MIN))).decisor.alertas).toEqual([]);
    process.env.MODO_DECISOR = "apagado";
    expect((await estadoSistema(AHORA)).decisor.alertas).toEqual([]);
  });

  it("sin ninguna decisión válida desde la activación: alerta de los dos activos, sin hora", async () => {
    await vaciarBase();
    await pool.query(`INSERT INTO eventos (momento, tipo, detalle) VALUES ($1, 'modo_proponentes', $2)`, [
      hace(30),
      JSON.stringify({ ciclo: { configurado: "solo_registra", efectivo: "solo_registra", motivo: null }, decisor: { configurado: "ejecuta", efectivo: "ejecuta", motivo: null } }),
    ]);
    process.env.MODO_CICLO = "solo_registra";
    process.env.MODO_DECISOR = "ejecuta";
    const e = await estadoSistema(AHORA);
    expect(e.decisor.activacion).toBe(hace(30));
    expect(e.decisor.alertas).toEqual([
      { activo: "BTC/USD", desde: null, ultimaValida: null, severidad: "neg" },
      { activo: "SOL/USD", desde: null, ultimaValida: null, severidad: "neg" },
    ]);
  });

  it("la última ranura se calcula aunque seguimiento aún no la cierre: terminada y en curso", async () => {
    await conAhora("decisor-alerta");
    const r = await listarRanuras({}, AHORA);
    expect(r.filas.map((f) => [f.ranura, f.estado, f.enCurso])).toEqual([
      ["2026-11-12T13:45:00.000Z", "parcial", true],
      ["2026-11-12T11:45:00.000Z", "parcial", false],
    ]);
    const u = (await estadoSistema(AHORA)).decisor.ultimaRanura!;
    expect(u).toMatchObject({ ranura: "2026-11-12T13:45:00.000Z", fin: "2026-11-12T14:45:00.000Z", estado: "parcial", enCurso: true, modo: "ejecuta" });
    expect(u.porActivo["BTC/USD"].tipo).toBe("no_comprar");
    expect(u.porActivo["SOL/USD"].tipo).toBe("sin_decision");
  });
});

describe("historial de ranuras (REQ-26, REQ-28, AC-21, AC-23, AC-30)", () => {
  it("porcentajes de 24 h y 7 días contra el conteo a mano, sin las ranuras apagadas", async () => {
    await conAhora("decisor-ranuras");
    const r = await listarRanuras({}, AHORA);
    expect(r.h24).toEqual(RANURAS_CONOCIDAS.h24);
    expect(r.d7).toEqual(RANURAS_CONOCIDAS.d7);
    expect(r.total).toBe(61);
    expect(r.filas[0]).toMatchObject({ enCurso: true, estado: "parcial", ranura: "2026-11-12T13:45:00.000Z" });
    expect(r.filas).toHaveLength(50);
  });

  it("cada caso de la spec tiene su estado, con las más recientes primero", async () => {
    await conAhora("decisor-ranuras");
    const p1 = await listarRanuras({}, AHORA);
    const todas = [...p1.filas, ...(await listarRanuras({ antes: p1.siguiente! }, AHORA)).filas];
    expect(todas).toHaveLength(61);
    for (const [hora, estado] of Object.entries(RANURAS_CONOCIDAS.estados)) {
      expect(todas.find((f) => k(f) === Number(hora))?.estado, `k=${hora}`).toBe(estado);
    }
    expect(todas.find((f) => k(f) === 3)?.porActivo["BTC/USD"]).toMatchObject({ tipo: "invalida", motivo: "contexto_vencido" });
    expect(todas.find((f) => k(f) === 5)?.porActivo["SOL/USD"]).toMatchObject({ tipo: "comprar_rechazada", motivo: "datos_no_disponibles" });
    expect(todas.find((f) => k(f) === 2)?.porActivo).toMatchObject({ "BTC/USD": { tipo: "no_comprar" }, "SOL/USD": { tipo: "sin_decision" } });
    expect(todas.find((f) => k(f) === 7)).toMatchObject({ modo: "apagado", versionInstrucciones: null });
    expect(todas.find((f) => k(f) === 6)).toMatchObject({ modo: "ejecuta", versionInstrucciones: expect.stringMatching(/^decisor-v1@/) });
  });

  it("filtros de estado y de resultado se combinan; paginación por cursor", async () => {
    await conAhora("decisor-ranuras");
    expect((await listarRanuras({ estado: "sin_llegar" }, AHORA)).total).toBe(2);
    expect((await listarRanuras({ estado: "apagado" }, AHORA)).total).toBe(2);
    expect((await listarRanuras({ resultado: "comprar_rechazada" }, AHORA)).total).toBe(1);
    expect((await listarRanuras({ resultado: "comprar_rechazada", activo: "BTC/USD" }, AHORA)).total).toBe(0);
    expect((await listarRanuras({ resultado: "no_comprar", estado: "parcial" }, AHORA)).total).toBe(3);

    const p1 = await listarRanuras({}, AHORA);
    expect(p1).toMatchObject({ anterior: null, siguiente: expect.stringMatching(/^a:/) });
    const p2 = await listarRanuras({ antes: p1.siguiente! }, AHORA);
    expect(p2.filas).toHaveLength(11);
    expect(p2).toMatchObject({ siguiente: null, anterior: expect.stringMatching(/^d:/) });
    expect(Date.parse(p2.filas[0].ranura)).toBeLessThan(Date.parse(p1.filas[49].ranura));
    const atras = await listarRanuras({ antes: p2.anterior! }, AHORA);
    expect(atras.filas.map((f) => f.ranura)).toEqual(p1.filas.map((f) => f.ranura));
    expect(atras.anterior).toBeNull();
  });

  it("sin activación no hay ranuras; con falla inyectada la vista falla sola", async () => {
    await vaciarBase();
    expect(await listarRanuras({}, AHORA)).toMatchObject({ filas: [], total: 0, h24: { total: 0, pct: null } });
    process.env.SF_FALLA_INYECTADA = "listarRanuras";
    await expect(listarRanuras({}, AHORA)).rejects.toThrow(/Falla inyectada en listarRanuras/);
    process.env.SF_FALLA_INYECTADA = "detalleDecision";
    await expect(detalleDecision("00000000-0000-4000-8000-000000000000", AHORA)).rejects.toThrow(/Falla inyectada en detalleDecision/);
  });
});

describe("detalle de una decisión (REQ-24, REQ-29, AC-UX-12)", () => {
  async function idDe(hora: number, activo: "BTC/USD" | "SOL/USD"): Promise<string> {
    const f = (await listarRanuras({}, AHORA)).filas.find((x) => k(x) === hora)!;
    const a = f.porActivo[activo];
    if (a.tipo === "sin_decision") throw new Error("sin decisión");
    return a.decisionId;
  }

  it("no comprar: razonamiento, contexto de hace 3 min y resultado hipotético pendiente con su hueco", async () => {
    await conAhora("decisor-decisiones");
    const d = (await detalleDecision(await idDe(1, "BTC/USD"), AHORA))!;
    expect(d.decision).toMatchObject({ activo: "BTC/USD", decision: "no_comprar", confianza: "0.720", valida: true, estado: "aceptada", motivo: null, motivos: null, cuerpoCrudo: null, modoEfectivo: "ejecuta" });
    expect(d.decision.razonamiento).toContain("Tendencia al alza");
    expect(d.contexto).toMatchObject({ antiguedadAlRecibirMin: 3 });
    expect((d.contexto!.contenido as { version: string }).version).toBe("contexto-v1");
    expect(d.propuestaId).toBeNull();
    // Sin muestras de precio desde la decisión: pendiente, con todo el tiempo como hueco.
    expect(d.hipotetico).toMatchObject({ estado: "pendiente", huecos: [{ hasta: AHORA.toISOString() }] });
    expect(d.hipotetico).toHaveProperty("precioEntrada");
  });

  it("comprar ejecutada y rechazada por R11: llevan su propuesta y no tienen hipotético", async () => {
    await conAhora("decisor-decisiones");
    for (const hora of [3, 2]) {
      const d = (await detalleDecision(await idDe(hora, "BTC/USD"), AHORA))!;
      expect(d.propuestaId, `k=${hora}`).not.toBeNull();
      expect(d.hipotetico).toBeNull();
    }
  });

  it("inválida: contenido recibido literal y motivo; contexto vencido: el detalle registrado", async () => {
    await conAhora("decisor-decisiones");
    const crudo = (await pool.query(`SELECT id FROM decisiones WHERE motivo = 'decision_invalida'`)).rows[0].id as string;
    const inv = (await detalleDecision(crudo, AHORA))!;
    expect(inv.decision).toMatchObject({ valida: false, estado: "rechazada", motivo: "decision_invalida", activo: null, cuerpoCrudo: '{"decision":"comprar","confianza":7}' });
    expect(inv.contexto).toBeNull();
    expect(inv.hipotetico).toBeNull();

    const vencida = (await pool.query(`SELECT id FROM decisiones WHERE motivo = 'contexto_vencido' AND activo = 'BTC/USD'`)).rows[0].id as string;
    const venc = (await detalleDecision(vencida, AHORA))!;
    expect(venc.decision).toMatchObject({ valida: false, motivo: "contexto_vencido", motivos: [{ campo: "contexto_id", motivo: "contexto de hace 16 min, máximo 15" }] });
    expect(venc.decision.cuerpoCrudo).not.toBeNull();
  });

  it("comprar sin datos: rechazada por datos no disponibles, válida y sin propuesta", async () => {
    await conAhora("decisor-decisiones");
    const d = (await detalleDecision(await idDe(4, "SOL/USD"), AHORA))!;
    expect(d.decision).toMatchObject({ valida: true, estado: "rechazada", motivo: "datos_no_disponibles", decision: "comprar" });
    expect(d.propuestaId).toBeNull();
  });

  it("id desconocido o mal formado: null", async () => {
    await conAhora("decisor-decisiones");
    expect(await detalleDecision("no-es-un-uuid", AHORA)).toBeNull();
    expect(await detalleDecision("00000000-0000-4000-8000-000000000000", AHORA)).toBeNull();
  });

  it("entrada evitada resuelta: su PnL a nivel y precio de entrada; sin precio: sin_precio_entrada", async () => {
    await conAhora("decisor-comparacion");
    const evitadas = (await pool.query(`SELECT d.id, h.resultado FROM decisiones d JOIN resultados_hipoteticos h ON h.decision_id = d.id ORDER BY d.recibida_en`)).rows;
    expect(evitadas.map((r) => r.resultado)).toEqual(["take_profit", "stop_loss", "take_profit", "sin_precio_entrada"]);
    expect((await detalleDecision(evitadas[0].id, AHORA))!.hipotetico).toMatchObject({ estado: "resuelto", resultado: "take_profit", pnlANivelUsd: "17.40", huecos: [] });
    expect((await detalleDecision(evitadas[1].id, AHORA))!.hipotetico).toMatchObject({ estado: "resuelto", resultado: "stop_loss", pnlANivelUsd: "-12.45" });
    expect((await detalleDecision(evitadas[3].id, AHORA))!.hipotetico).toEqual({ estado: "sin_precio_entrada" });
  });
});

describe("proponente en S1, S2, S3 y S6 (REQ-14, REQ-32)", () => {
  it("S2: cada fila trae su proponente y el filtro los separa", async () => {
    await conAhora("decisor-decisiones");
    const todas = await listarPropuestas();
    expect(todas.total).toBe(4);
    expect(todas.filas.every((f) => f.proponente === "decisor")).toBe(true);
    expect((await listarPropuestas({ proponente: "decisor" })).total).toBe(4);
    expect((await listarPropuestas({ proponente: "ciclo" })).total).toBe(0);
    await conAhora("ejecutada-y-rechazada");
    expect((await listarPropuestas({ proponente: "ciclo" })).total).toBeGreaterThan(0);
    expect((await listarPropuestas({ proponente: "decisor" })).total).toBe(0);
    expect((await listarPropuestas()).filas.every((f) => f.proponente === "ciclo")).toBe(true);
  });

  it("S3: la propuesta del decisor trae su decisión y su contexto; la del ciclo, ninguno", async () => {
    await conAhora("decisor-decisiones");
    const filas = (await listarPropuestas()).filas;
    const ejecutada = filas.find((f) => f.decision === "ejecutada" && f.activo === "BTC/USD")!;
    const d = (await detallePropuesta(ejecutada.id))!;
    expect(d.proponente).toBe("decisor");
    expect(d.decisor?.decision).toMatchObject({ decision: "comprar", activo: "BTC/USD", confianza: "0.720" });
    expect(d.decisor?.contexto?.contenido).toMatchObject({ version: "contexto-v1" });
    expect(d.reglas).toHaveLength(11);

    const rechazada = (await detallePropuesta(filas.find((f) => f.decision === "rechazada" && f.activo === "BTC/USD")!.id))!;
    expect(rechazada.reglas.find((r) => r.estado === "incumple")?.regla).toBe("R11");

    await conAhora("ejecutada-y-rechazada");
    const delCiclo = (await detallePropuesta((await listarPropuestas()).filas[0].id))!;
    expect(delCiclo).toMatchObject({ proponente: "ciclo", decisor: null });
  });

  it("S3: el PnL a nivel junto al neto de una entrada del decisor que cerró (REQ-21)", async () => {
    await conAhora("decisor-comparacion");
    const cerradas = (await listarPropuestas({ proponente: "decisor" })).filas.filter((f) => f.estado === "cerrada_tp" || f.estado === "cerrada_sl");
    const salidas = new Map<string, unknown>();
    for (const f of cerradas) salidas.set(f.estado!, (await detallePropuesta(f.id))!.salida);
    expect(salidas.get("cerrada_tp")).toMatchObject({ pnlNetoUsd: "17.40", pnlANivelUsd: "17.40", pnlANivelPct: "0.034800" });
    expect(salidas.get("cerrada_sl")).toMatchObject({ pnlNetoUsd: "-14.93", pnlANivelUsd: "-12.45", pnlANivelPct: "-0.024900" });
  });

  it("S1: los lotes abiertos llevan su proponente", async () => {
    await conAhora("decisor-comparacion");
    const abiertos = (await resumenCartera(AHORA)).lotesAbiertos;
    expect(abiertos).toHaveLength(1);
    expect(abiertos[0]).toMatchObject({ proponente: "decisor", activo: "SOL/USD" });
  });

  it("S6: la entrada del decisor trae su proponente y su confianza, y la del ciclo no", async () => {
    await conAhora("decisor-comparacion");
    const btc = (await operacionesPrecio("BTC/USD", "todo", AHORA)).filas;
    expect(btc.map((f) => [f.entrada.proponente, f.entrada.confianza, f.entrada.cierre])).toEqual([
      ["decisor", "0.720", null],
      ["decisor", "0.720", null],
    ]);
    await conAhora("precio-operaciones");
    const ciclo = (await operacionesPrecio("BTC/USD", "todo", new Date())).filas;
    expect(ciclo.length).toBeGreaterThan(0);
    expect(ciclo.every((f) => f.entrada.proponente === "ciclo" && f.entrada.confianza === null)).toBe(true);
  });
});

describe("señal registrada en S5 (REQ-18, REQ-20, AC-UX-9)", () => {
  it("el filtro de resultado la encuentra y el detalle trae el modo y el hipotético", async () => {
    await conAhora("ciclo-solo-registra");
    const l = await listarEjecuciones({ resultado: "senal_registrada" });
    expect(l.total).toBe(2);
    expect(l.filas[0].porActivo["BTC/USD"]).toEqual({ resultado: "senal_registrada" });
    expect(l.filas[0].porActivo["SOL/USD"]).toEqual({ resultado: "sin_senal" });

    const [nueva, vieja] = l.filas;
    const pendiente = (await detalleEvaluacion(nueva.id, "BTC/USD", AHORA))!;
    expect(pendiente.evaluacion.resultado).toBe("senal_registrada");
    expect(pendiente.modo).toBe("solo_registra");
    expect(pendiente.propuesta).toBeNull();
    // Una muestra por minuto menos las de 100 a 90 min antes: un solo hueco, entre la de 101 y la de 89.
    expect(pendiente.hipotetico).toMatchObject({ estado: "pendiente", huecos: [{ desde: hace(101), hasta: hace(89) }] });

    const resuelta = (await detalleEvaluacion(vieja.id, "BTC/USD", AHORA))!;
    expect(resuelta.hipotetico).toMatchObject({ estado: "resuelto", resultado: "take_profit", pnlANivelUsd: "17.40" });
    const sinSenal = (await detalleEvaluacion(vieja.id, "SOL/USD", AHORA))!;
    expect(sinSenal).toMatchObject({ modo: "solo_registra", hipotetico: null });
  });
});
