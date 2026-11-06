import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ErrorBroker } from "@/server/broker/tipos";
import { procesarPropuesta, clientOrderIdEntrada } from "@/server/propuestas/procesar";
import { reiniciarBase } from "./arnes";
import { AHORA, URL_REAL, compra, crearEntorno } from "./ayudas";

// AC-8, AC-9 (alcanzables), AC-12, AC-14, AC-15, AC-17 (campos), AC-24 (pausa manual) y REQ-7, REQ-17.
let e: ReturnType<typeof crearEntorno>;
const q = async (texto: string, valores: unknown[] = []) => (await e.pool.query(texto, valores)).rows;

// Base limpia por test: las tablas de registro no admiten TRUNCATE.
beforeEach(async () => {
  await e?.pool.end();
  await reiniciarBase();
  e = crearEntorno();
});
afterAll(async () => {
  await (e?.pool as Pool | undefined)?.end();
});

const reglasFalladas = (r: { reglas: { regla: string; cumple: boolean }[] | null }) =>
  (r.reglas ?? []).filter((x) => !x.cumple).map((x) => x.regla);

describe("esquema (AC-8)", () => {
  it.each([
    ["sin clave", { clave_idempotencia: undefined }],
    ["sin activo", { activo: undefined }],
    ["lado inválido", { lado: "x" }],
  ])("%s: rechazada, sin broker y con la entrada cruda", async (_n, extra) => {
    const entrada = compra(extra);
    const r = await procesarPropuesta(entrada, e.ctx);
    expect(r).toMatchObject({ decision: "rechazada", motivo: "propuesta_invalida", ordenId: null });
    expect(e.broker.llamadas).toHaveLength(0);
    const [f] = await q("SELECT entrada_cruda, decision, motivo FROM propuestas WHERE id = $1", [r.propuestaId]);
    expect(f).toMatchObject({ decision: "rechazada", motivo: "propuesta_invalida" });
    expect(f.entrada_cruda.ejecucion_id).toBe(entrada.ejecucion_id);
  });
});

describe("camino feliz", () => {
  it("compra: outbox, envío con id derivado, llenado y lote con stop y take profit", async () => {
    const p = compra();
    const r = await procesarPropuesta(p, e.ctx);
    expect(r).toMatchObject({ decision: "ejecutada", motivo: "aprobada", repetida: false });
    expect(r.reglas).toHaveLength(10);

    const coid = clientOrderIdEntrada(p.clave_idempotencia);
    expect(coid).toMatch(/^sf-e-[0-9a-f]{32}$/);
    expect(e.broker.llamadas[0]).toMatchObject({
      metodo: "enviarOrden",
      arg: { clientOrderId: coid, simbolo: "BTC/USD", lado: "buy", nocionalUsd: "500.00" },
    });

    const estados = (await q("SELECT estado FROM eventos_orden ORDER BY id")).map((x) => x.estado);
    expect(estados).toEqual(["pendiente_envio", "enviada", "llenada"]);
    const [lote] = await q("SELECT * FROM lotes");
    expect(Number(lote.precio_entrada)).toBe(100_000);
    expect(Number(lote.cantidad_llenada)).toBeCloseTo(0.005, 10);
    expect(Number(lote.cantidad_neta)).toBeCloseTo(0.0049875, 9);
    expect(lote.nocional_entrada_usd).toBe("500.00");
    expect(Number(lote.stop_loss)).toBeCloseTo(98_000, 4);
    expect(Number(lote.take_profit)).toBeCloseTo(104_000, 4);
    expect(lote.comision_bps).toBe(25);
  });

  it("guarda todos los campos de la propuesta con la hora del servidor (AC-17)", async () => {
    const p = compra();
    const r = await procesarPropuesta(p, e.ctx);
    const [f] = await q("SELECT * FROM propuestas WHERE id = $1", [r.propuestaId]);
    expect(f).toMatchObject({
      clave_idempotencia: p.clave_idempotencia,
      es_original: true,
      proponente: "tendencia-sma-v1",
      ejecucion_id: p.ejecucion_id,
      version_regla: "tendencia-sma-v1",
      activo: "BTC/USD",
      lado: "buy",
      nocional_usd: "500.00",
      tipo_orden: "mercado",
      decision: "ejecutada",
      motivo: "aprobada",
      reglas_incumplidas: [],
    });
    expect(f.huella_contenido).toMatch(/^[0-9a-f]{64}$/);
    expect(f.justificacion).toEqual(p.justificacion);
    expect(f.reglas).toHaveLength(10);
    expect(f.recibida_en.toISOString()).toBe(AHORA.toISOString());
  });

  it("llenado parcial o sin llenar: sin lote, y la entrada pendiente cuenta en la exposición (R4)", async () => {
    e.broker.llenado = "ninguno";
    for (let i = 0; i < 5; i++) {
      const r = await procesarPropuesta(compra({ nocional_usd: 1000 }), e.ctx);
      expect(r.decision).toBe("ejecutada");
    }
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(0);
    const consultas = e.broker.llamadas.filter((l) => l.metodo === "consultarOrden").length;
    expect(consultas).toBe(5 * 10);
    const r = await procesarPropuesta(compra({ nocional_usd: 1 }), e.ctx);
    expect(reglasFalladas(r)).toEqual(["R4"]);
  });

  it("llenado parcial deja el evento parcial y ningún lote", async () => {
    e.broker.llenado = "parcial";
    const r = await procesarPropuesta(compra(), e.ctx);
    const estados = (await q("SELECT estado FROM eventos_orden WHERE orden_id = $1 ORDER BY id", [r.ordenId])).map(
      (x) => x.estado,
    );
    expect(estados).toEqual(["pendiente_envio", "enviada", "parcial"]);
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(0);
  });
});

describe("R1 a R10 de punta a punta (AC-9)", () => {
  const solo = async (extra: Record<string, unknown>, regla: string) => {
    const r = await procesarPropuesta(compra(extra), e.ctx);
    expect(r).toMatchObject({ decision: "rechazada", motivo: "reglas_incumplidas", ordenId: null });
    expect(reglasFalladas(r)).toEqual([regla]);
    expect(e.broker.llamadas).toHaveLength(0);
    const [f] = await q("SELECT reglas_incumplidas FROM propuestas WHERE id = $1", [r.propuestaId]);
    expect(f.reglas_incumplidas).toEqual([regla]);
    return r;
  };

  it("R1 ETH/USD", async () => {
    const r = await solo({ activo: "ETH/USD" }, "R1");
    expect(r.reglas?.find((x) => x.regla === "R1")).toMatchObject({ observado: "ETH/USD", limite: "BTC/USD, SOL/USD" });
  });
  it("R2 vender 0.5 BTC sin posición", () => solo({ lado: "sell", nocional_usd: undefined, cantidad: 0.5 }, "R2"));
  it("R3 compra de 1001 USD", () => solo({ nocional_usd: 1001 }, "R3"));
  it("R10 orden que no es a mercado", () => solo({ tipo_orden: "limite" }, "R10"));

  it("R8 pausa manual (AC-24)", async () => {
    const m = crearEntorno({ TRADING_PAUSADO: "true" });
    try {
      const r = await procesarPropuesta(compra(), m.ctx);
      expect(reglasFalladas(r)).toEqual(["R8"]);
      expect(m.broker.llamadas).toHaveLength(0);
    } finally {
      await m.pool.end();
    }
  });

  it("R6 pausa automática ya registrada hoy", async () => {
    await q("INSERT INTO eventos (tipo, dia_utc) VALUES ('pausa_automatica', '2026-11-06')");
    await solo({}, "R6");
  });

  it("R9 orden desconocida del mismo activo; el otro activo sigue libre", async () => {
    e.broker.programarEnvio({ tipo: "timeout", llega: false });
    const a = await procesarPropuesta(compra(), e.ctx);
    expect(a.decision).toBe("ejecutada");
    const antes = e.broker.llamadas.length;
    const b = await procesarPropuesta(compra(), e.ctx);
    expect(reglasFalladas(b)).toEqual(["R9"]);
    expect(e.broker.llamadas).toHaveLength(antes);
    const c = await procesarPropuesta(compra({ activo: "SOL/USD" }), e.ctx);
    expect(c.decision).toBe("ejecutada");
  });

  it("R5 la entrada número 49 del día", async () => {
    for (let i = 0; i < 48; i++) {
      const r = await procesarPropuesta(compra({ nocional_usd: 1 }), e.ctx);
      expect(r.decision).toBe("ejecutada");
    }
    e.broker.llamadas.length = 0;
    await solo({ nocional_usd: 1 }, "R5");
  });

  it("R4 exposición de 5001 USD, y R3+R4+R7 juntas", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await procesarPropuesta(compra({ nocional_usd: 1000 }), e.ctx)).decision).toBe("ejecutada");
    }
    e.broker.llamadas.length = 0;
    await solo({ nocional_usd: 1 }, "R4");
    const r = await procesarPropuesta(compra({ nocional_usd: 6000 }), e.ctx);
    expect(reglasFalladas(r)).toEqual(["R3", "R4", "R7"]);
  });

  it("pausa automática: la pérdida del día cruza -3 %, registra el evento y rechaza por R6 (REQ-31)", async () => {
    expect((await procesarPropuesta(compra({ nocional_usd: 1000 }), e.ctx)).decision).toBe("ejecutada");
    // 0.009975 BTC a 60 000 USD, menos la comisión de salida, es -400 USD sobre un costo de 1 000.
    await q("INSERT INTO lecturas_mercado (activo, bid, ask, ultimo) VALUES ('BTC/USD', 60000, 60010, 60005)");
    const r = await procesarPropuesta(compra({ nocional_usd: 100 }), e.ctx);
    expect(reglasFalladas(r)).toEqual(["R6"]);
    const ev = await q("SELECT dia_utc::text AS dia FROM eventos WHERE tipo = 'pausa_automatica'");
    expect(ev).toEqual([{ dia: "2026-11-06" }]);
  });
});

describe("una por ejecución (REQ-7)", () => {
  it("la segunda propuesta del mismo activo y ejecución queda en error", async () => {
    const a = compra();
    const r1 = await procesarPropuesta(a, e.ctx);
    const r2 = await procesarPropuesta(compra({ ejecucion_id: a.ejecucion_id }), e.ctx);
    expect(r1.decision).toBe("ejecutada");
    expect(r2).toMatchObject({ decision: "error", motivo: "segunda_propuesta_misma_ejecucion", ordenId: null });
    expect(e.broker.registradas).toHaveLength(1);
    const r3 = await procesarPropuesta(compra({ ejecucion_id: a.ejecucion_id, activo: "SOL/USD" }), e.ctx);
    expect(r3.decision).toBe("ejecutada");
  });
});

describe("idempotencia (AC-12)", () => {
  it("mismo contenido: devuelve el original, sin orden ni registro nuevos", async () => {
    const p = compra();
    const a = await procesarPropuesta(p, e.ctx);
    const b = await procesarPropuesta({ ...p, justificacion: { entradas: {}, resultado: { otra: 1 } } }, e.ctx);
    expect(b).toMatchObject({ propuestaId: a.propuestaId, ordenId: a.ordenId, decision: "ejecutada", repetida: true });
    expect(e.broker.registradas).toHaveLength(1);
    expect(e.broker.llamadas.filter((l) => l.metodo === "enviarOrden")).toHaveLength(1);
    expect(await q("SELECT 1 FROM propuestas")).toHaveLength(1);
    expect(await q("SELECT 1 FROM ordenes")).toHaveLength(1);
  });

  it("otro contenido con la misma clave: conflicto registrado y sin orden nueva", async () => {
    const p = compra();
    const a = await procesarPropuesta(p, e.ctx);
    const b = await procesarPropuesta({ ...p, nocional_usd: 600 }, e.ctx);
    expect(b).toMatchObject({ decision: "conflicto", motivo: "clave_con_otro_contenido", ordenId: null, repetida: false });
    expect(b.propuestaId).not.toBe(a.propuestaId);
    expect(e.broker.registradas).toHaveLength(1);
    const filas = await q("SELECT decision, es_original FROM propuestas ORDER BY recibida_en, decision");
    expect(filas).toHaveLength(2);
    expect(filas.filter((f) => f.es_original)).toHaveLength(1);
  });

  it("el rechazo también es idempotente", async () => {
    const p = compra({ nocional_usd: 1001 });
    const a = await procesarPropuesta(p, e.ctx);
    const b = await procesarPropuesta(p, e.ctx);
    expect(b).toMatchObject({ propuestaId: a.propuestaId, decision: "rechazada", repetida: true });
    expect(reglasFalladas(b)).toEqual(["R3"]);
  });
});

describe("fallos del broker (AC-14)", () => {
  it("corte tras el envío: la orden llegó, la respuesta no; el reintento no reenvía", async () => {
    e.broker.programarEnvio({ tipo: "timeout", llega: true });
    const p = compra();
    const a = await procesarPropuesta(p, e.ctx);
    const b = await procesarPropuesta(p, e.ctx);
    expect(b.repetida).toBe(true);
    expect(e.broker.registradas).toHaveLength(1);
    expect(e.broker.registradas[0].clientOrderId).toBe(clientOrderIdEntrada(p.clave_idempotencia));
    const estados = (await q("SELECT estado FROM eventos_orden WHERE orden_id = $1 ORDER BY id", [a.ordenId])).map(
      (x) => x.estado,
    );
    expect(estados).toEqual(["pendiente_envio", "desconocido"]);
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(0);
  });

  it("5xx y red también dejan la orden en estado desconocido", async () => {
    e.broker.programarEnvio({ tipo: "5xx", llega: false }, { tipo: "red", llega: false });
    await procesarPropuesta(compra(), e.ctx);
    await procesarPropuesta(compra({ activo: "SOL/USD" }), e.ctx);
    const filas = await q("SELECT estado FROM v_ordenes ORDER BY creada_en");
    expect(filas.map((f) => f.estado)).toEqual(["desconocido", "desconocido"]);
  });

  it("rechazo 4xx: evento rechazada con la respuesta, sin lote", async () => {
    e.broker.programarEnvio({ tipo: "rechazada", status: 403, cuerpo: { message: "insufficient balance" } });
    const r = await procesarPropuesta(compra(), e.ctx);
    expect(r.decision).toBe("ejecutada");
    const [ev] = await q("SELECT estado, respuesta FROM eventos_orden WHERE estado = 'rechazada'");
    expect(ev.respuesta).toEqual({ status: 403, cuerpo: { message: "insufficient balance" } });
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(0);
  });

  it("la consulta de llenado que falla no rompe la propuesta", async () => {
    e.broker.llenado = "ninguno";
    e.broker.programarConsulta(new ErrorBroker("x", "red"));
    const r = await procesarPropuesta(compra(), e.ctx);
    expect(r.decision).toBe("ejecutada");
    const estados = (await q("SELECT estado FROM eventos_orden WHERE orden_id = $1 ORDER BY id", [r.ordenId])).map(
      (x) => x.estado,
    );
    expect(estados).toEqual(["pendiente_envio", "enviada"]);
  });
});

describe("entorno (AC-15)", () => {
  it("con la URL real: error, evento y 0 llamadas al broker", async () => {
    const m = crearEntorno({ APCA_API_BASE_URL: URL_REAL });
    try {
      const r = await procesarPropuesta(compra(), m.ctx);
      expect(r).toMatchObject({ decision: "error", motivo: "entorno_no_paper", ordenId: null });
      expect(m.broker.llamadas).toHaveLength(0);
      const ev = await q("SELECT tipo, activo, detalle FROM eventos");
      expect(ev).toEqual([{ tipo: "entorno_no_paper", activo: "BTC/USD", detalle: { propuestaId: r.propuestaId } }]);
    } finally {
      await m.pool.end();
    }
  });
});

describe("ventas en la etapa 1", () => {
  it("una venta que pasa R1 a R10 queda en error venta_no_habilitada y no llega al broker", async () => {
    await procesarPropuesta(compra(), e.ctx);
    e.broker.llamadas.length = 0;
    const r = await procesarPropuesta(compra({ lado: "sell", nocional_usd: undefined, cantidad: 0.001 }), e.ctx);
    expect(r).toMatchObject({ decision: "error", motivo: "venta_no_habilitada", ordenId: null });
    expect(r.reglas).toHaveLength(10);
    expect(e.broker.llamadas).toHaveLength(0);
  });
});
