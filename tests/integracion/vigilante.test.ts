import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarVigilante, type DepsVigilante } from "@/procesos/vigilante";
import { DatosSimulados } from "@/server/broker/simulado";
import type { Snapshot } from "@/server/broker/tipos";
import { procesarPropuesta } from "@/server/propuestas/procesar";
import { reiniciarBase } from "./arnes";
import { AHORA, URL_REAL, compra, crearEntorno } from "./ayudas";

// AC-14 (reconciliación), AC-16, AC-19 (integración), AC-25 y REQ-16 a REQ-19, REQ-31 sobre ejecutarVigilante.
const SECRETO = `sf-senuelo-${randomUUID()}`;

let e: ReturnType<typeof crearEntorno>;
let datos: DatosSimulados;
let ahora: Date;
let log: string[];
const q = async (texto: string, valores: unknown[] = []) => (await e.pool.query(texto, valores)).rows;

const snap = (bid: number): Snapshot => ({ bid, ask: bid + 1, ultimo: bid, tsQuote: ahora, tsTrade: ahora });
const ponerBid = (btc: number, sol = 200) => (datos.instantaneas = { "BTC/USD": snap(btc), "SOL/USD": snap(sol) });
const deps = (extra: Partial<DepsVigilante> = {}): DepsVigilante => ({
  pool: e.pool as Pool,
  broker: e.broker,
  datos,
  ahora: () => ahora,
  env: { APCA_API_BASE_URL: "https://paper-api.alpaca.markets" },
  secretos: [SECRETO],
  log: (l) => log.push(JSON.stringify(l)),
  ...extra,
});
const ventas = () => e.broker.llamadas.filter((l) => l.metodo === "enviarOrden" && (l.arg as { lado: string }).lado === "sell");
const abrir = (extra: Record<string, unknown> = {}) => procesarPropuesta(compra(extra), e.ctx);

beforeEach(async () => {
  await e?.pool.end();
  await reiniciarBase();
  e = crearEntorno();
  datos = new DatosSimulados();
  ahora = AHORA;
  log = [];
  ponerBid(100_000);
});
afterAll(() => e?.pool.end());
afterEach(() => vi.unstubAllEnvs());

describe("protecciones (AC-16, REQ-17, REQ-18)", () => {
  it("sin tocar ningún nivel no vende", async () => {
    await abrir();
    const r = await ejecutarVigilante(deps());
    expect(r).toMatchObject({ estado: "completada", ventas: 0, cierres: 0 });
    expect(ventas()).toHaveLength(0);
  });

  it("el lote que toca el stop genera exactamente 1 orden de venta en 3 vueltas seguidas y su cierre", async () => {
    await abrir();
    const [lote] = await q("SELECT * FROM lotes");
    expect(Number(lote.stop_loss)).toBeCloseTo(98_000, 4);
    expect(Number(lote.take_profit)).toBeCloseTo(104_000, 4);
    ponerBid(97_999);
    e.broker.precios = { "BTC/USD": 98_000 };
    for (let i = 0; i < 3; i++) await ejecutarVigilante(deps());
    expect(ventas()).toHaveLength(1);
    expect(ventas()[0].arg).toMatchObject({
      simbolo: "BTC/USD",
      lado: "sell",
      cantidad: "0.0049875000",
      clientOrderId: `sf-x-${lote.id.replaceAll("-", "")}-1`,
    });
    expect(await q("SELECT 1 FROM ordenes WHERE tramo = 'salida'")).toHaveLength(1);
    const [c] = await q("SELECT * FROM cierres_lote");
    expect(c.motivo_cierre).toBe("stop_loss");
    expect(c.etiqueta_exito).toBe(0);
    expect(Number(c.pnl_neto_usd)).toBe(-12.45); // stop exacto con 25 bps de salida
    expect((await q("SELECT estado FROM v_lotes"))[0].estado).toBe("cerrado");
    expect((await q("SELECT estado FROM v_ordenes WHERE tramo = 'salida'"))[0].estado).toBe("llenada");
  });

  it("el lote que toca el take profit cierra con etiqueta 1 y PnL +17.40 (AC-19)", async () => {
    await abrir();
    ponerBid(104_000);
    e.broker.precios = { "BTC/USD": 104_000 };
    await ejecutarVigilante(deps());
    const [c] = await q("SELECT * FROM cierres_lote");
    expect(c).toMatchObject({ motivo_cierre: "take_profit", etiqueta_exito: 1 });
    expect(Number(c.pnl_neto_usd)).toBe(17.4);
    expect(c.duracion_s).toBe(0);
  });

  it("un take profit con deslizamiento extremo da PnL negativo y etiqueta 0 (AC-19)", async () => {
    await abrir();
    ponerBid(104_000);
    e.broker.precios = { "BTC/USD": 90_000 };
    await ejecutarVigilante(deps());
    const [c] = await q("SELECT * FROM cierres_lote");
    expect(c).toMatchObject({ motivo_cierre: "take_profit", etiqueta_exito: 0 });
    expect(Number(c.pnl_neto_usd)).toBeLessThan(0);
  });

  it("con un precio de más de 120 s no vende", async () => {
    await abrir();
    await e.pool.query(
      "INSERT INTO lecturas_mercado (activo, bid, ask, ultimo, fuente_ts, leido_en) VALUES ('BTC/USD', 97000, 97001, 97000, $1, $1)",
      [new Date(ahora.getTime() - 130_000)],
    );
    datos.caido = true;
    await ejecutarVigilante(deps());
    expect(ventas()).toHaveLength(0);
    expect((await q("SELECT ultimo_error_en FROM lecturas_mercado WHERE activo = 'BTC/USD'"))[0].ultimo_error_en).toBeInstanceOf(Date);
  });

  it("una orden de salida en el broker sin llenar no se duplica y se cierra al llenarse", async () => {
    await abrir();
    ponerBid(97_000);
    e.broker.llenado = "ninguno";
    await ejecutarVigilante(deps());
    await ejecutarVigilante(deps());
    expect(ventas()).toHaveLength(1);
    expect(await q("SELECT 1 FROM cierres_lote")).toHaveLength(0);
    const coid = (await q("SELECT client_order_id FROM ordenes WHERE tramo = 'salida'"))[0].client_order_id;
    e.broker.fijarEstado(coid, "filled", "0.0049875", "97000");
    await ejecutarVigilante(deps());
    expect(ventas()).toHaveLength(1);
    expect((await q("SELECT motivo_cierre FROM cierres_lote"))[0].motivo_cierre).toBe("stop_loss");
  });
});

describe("reconciliación (AC-14, REQ-16)", () => {
  it("timeout con la orden llegada: desconocido bloquea por R9 y la reconciliación abre el lote", async () => {
    e.broker.programarEnvio({ tipo: "timeout", llega: true });
    const r1 = await abrir();
    expect((await q("SELECT estado FROM v_ordenes"))[0].estado).toBe("desconocido");
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(0);
    const r2 = await abrir();
    expect(r2.reglas?.filter((x) => !x.cumple).map((x) => x.regla)).toEqual(["R9"]);

    const r = await ejecutarVigilante(deps());
    expect(r.reconciliadas).toBe(1);
    const lotes = await q("SELECT propuesta_id FROM lotes");
    expect(lotes).toEqual([{ propuesta_id: r1.propuestaId }]);
    await ejecutarVigilante(deps());
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(1); // idempotente
    expect((await abrir()).decision).toBe("ejecutada"); // R9 ya pasa
  });

  it("timeout con la orden perdida: tras 60 s es no_enviada, sin lote y sin reenviar la entrada", async () => {
    e.broker.programarEnvio({ tipo: "timeout", llega: false });
    await abrir();
    await ejecutarVigilante(deps({ ahora: () => new Date(AHORA.getTime() + 30_000) }));
    expect((await q("SELECT estado FROM v_ordenes"))[0].estado).toBe("desconocido");
    await ejecutarVigilante(deps({ ahora: () => new Date(AHORA.getTime() + 61_000) }));
    expect((await q("SELECT estado FROM v_ordenes"))[0].estado).toBe("no_enviada");
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(0);
    expect(e.broker.llamadas.filter((l) => l.metodo === "enviarOrden")).toHaveLength(1);
    expect((await abrir()).decision).toBe("ejecutada");
  });

  it("un llenado tardío de la entrada abre el lote con los precios del broker", async () => {
    e.broker.llenado = "ninguno";
    await abrir();
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(0);
    const coid = (await q("SELECT client_order_id FROM ordenes"))[0].client_order_id;
    e.broker.fijarEstado(coid, "filled", "0.005", "100000");
    await ejecutarVigilante(deps());
    expect(Number((await q("SELECT stop_loss FROM lotes"))[0].stop_loss)).toBeCloseTo(98_000, 4);
  });

  it("salida con respuesta perdida: no se crea otra (R9) y al reconciliar se cierra con su motivo", async () => {
    await abrir();
    ponerBid(97_000);
    e.broker.programarEnvio({ tipo: "timeout", llega: true });
    await ejecutarVigilante(deps());
    expect((await q("SELECT estado FROM v_ordenes WHERE tramo = 'salida'"))[0].estado).toBe("desconocido");
    await ejecutarVigilante(deps());
    expect(ventas()).toHaveLength(1);
    expect((await q("SELECT motivo_cierre FROM cierres_lote"))[0].motivo_cierre).toBe("stop_loss");
  });

  it("salida que el broker no conoce: tras 60 s es no_enviada y se recrea como intento 2", async () => {
    await abrir();
    ponerBid(97_000);
    e.broker.programarEnvio({ tipo: "timeout", llega: false });
    await ejecutarVigilante(deps());
    ahora = new Date(AHORA.getTime() + 61_000);
    ponerBid(97_000);
    await ejecutarVigilante(deps());
    expect(ventas()).toHaveLength(2);
    const ids = (await q("SELECT client_order_id FROM ordenes WHERE tramo = 'salida' ORDER BY creada_en, client_order_id")).map((x) => x.client_order_id);
    expect(ids[0].endsWith("-1") && ids[1].endsWith("-2")).toBe(true);
    expect(await q("SELECT 1 FROM cierres_lote")).toHaveLength(1);
  });
});

describe("pausa automática (AC-25, REQ-31)", () => {
  it("al cerrar pérdidas de -3 % del día se registra la pausa, R6 bloquea la compra y al día siguiente se evalúa normal", async () => {
    for (let i = 0; i < 5; i++) await abrir({ nocional_usd: 1000 });
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(5);
    ponerBid(92_000);
    e.broker.precios = { "BTC/USD": 92_000 };
    const r = await ejecutarVigilante(deps());
    expect(r.cierres).toBe(5);
    const [{ perdida }] = await q("SELECT sum(pnl_neto_usd)::float AS perdida FROM cierres_lote");
    expect(perdida).toBeLessThan(-300);
    expect(await q("SELECT 1 FROM eventos WHERE tipo = 'pausa_automatica' AND dia_utc = '2026-11-06'")).toHaveLength(1);

    const hoy = await abrir();
    expect(hoy.reglas?.filter((x) => !x.cumple).map((x) => x.regla)).toContain("R6");
    const manana = await procesarPropuesta(compra(), { ...e.ctx, ahora: () => new Date("2026-11-07T00:00:01Z") });
    expect(manana.decision).toBe("ejecutada");
  });
});

describe("candado, entorno y secretos", () => {
  it("dos vigilantes a la vez: uno trabaja y el otro termina sin tocar nada", async () => {
    await abrir();
    ponerBid(97_000);
    const lento = datos.snapshots.bind(datos);
    datos.snapshots = async (...a) => {
      await new Promise((r) => setTimeout(r, 300));
      return lento(...a);
    };
    const rs = await Promise.all([ejecutarVigilante(deps()), ejecutarVigilante(deps())]);
    expect(rs.map((r) => r.estado).sort()).toEqual(["completada", "omitida_solapamiento"]);
    expect(ventas()).toHaveLength(1);
  });

  it("fuera de paper no toca el broker y deja el evento (REQ-15)", async () => {
    await abrir();
    const antes = e.broker.llamadas.length;
    ponerBid(97_000);
    await ejecutarVigilante(deps({ env: { APCA_API_BASE_URL: URL_REAL } }));
    expect(e.broker.llamadas).toHaveLength(antes);
    expect(await q("SELECT 1 FROM eventos WHERE tipo = 'entorno_no_paper'")).toHaveLength(1);
  });

  it("un error con la llave dentro no llega al log ni a la base (AC-4)", async () => {
    datos.snapshots = async () => {
      throw new Error(`caída con ${SECRETO}`);
    };
    await ejecutarVigilante(deps());
    expect(log.join("\n")).not.toContain(SECRETO);
    expect(JSON.stringify(await q("SELECT ultimo_error FROM lecturas_mercado"))).not.toContain(SECRETO);
  });

  it("el plazo interno aborta y deja el evento error_vigilante", async () => {
    datos.snapshots = () => new Promise(() => {});
    const r = await ejecutarVigilante(deps({ plazoMs: 100 }));
    expect(r.estado).toBe("error");
    expect(await q("SELECT 1 FROM eventos WHERE tipo = 'error_vigilante'")).toHaveLength(1);
  });
});

describe("medición del deslizamiento (spec 003, AC-13, REQ-13)", () => {
  it("la orden de salida guarda el bid que disparó el stop y la hora de su quote; v_cierres lo descompone", async () => {
    await abrir();
    ponerBid(97_990);
    e.broker.precios = { "BTC/USD": 97_500 }; // llena peor que el stop de 98000
    await ejecutarVigilante(deps());
    const [o] = await q("SELECT precio_disparo, precio_disparo_ts FROM ordenes WHERE tramo = 'salida'");
    expect(Number(o.precio_disparo)).toBe(97_990);
    expect(o.precio_disparo_ts).toEqual(ahora);
    expect((await q("SELECT precio_disparo FROM ordenes WHERE tramo = 'entrada'"))[0].precio_disparo).toBeNull();
    const [c] = await q("SELECT * FROM v_cierres");
    expect(c).toMatchObject({ nivel: "stop_loss", deslizamiento_usd: "-2.49", deslizamiento_pct: "-0.005102" });
    expect(Number(c.precio_disparo)).toBe(97_990);
    expect(Number(c.movimiento_usd) + Number(c.deslizamiento_usd) + Number(c.comision_usd)).toBeCloseTo(Number(c.pnl_neto_usd), 10);
  });

  it("el take profit guarda su disparo y no tiene deslizamiento cuando llena en el nivel", async () => {
    await abrir();
    ponerBid(104_100);
    e.broker.precios = { "BTC/USD": 104_000 };
    await ejecutarVigilante(deps());
    const [c] = await q("SELECT * FROM v_cierres");
    expect(c).toMatchObject({ nivel: "take_profit", deslizamiento_usd: "0.00", deslizamiento_pct: "0.000000" });
    expect(Number(c.precio_disparo)).toBe(104_100);
  });
});

describe("R11 no afecta a las salidas (spec 003, AC-7, AC-9, RNF-4)", () => {
  it("AC-7: con 4 entradas de BTC abiertas (por encima de N = 1) y N inválido en el entorno, el vigilante cierra las 4 por stop y R11 no crea órdenes", async () => {
    vi.stubEnv("MAX_ENTRADAS_ABIERTAS_POR_ACTIVO", "x"); // el vigilante ni lo lee
    for (let i = 0; i < 4; i++) expect((await abrir()).decision).toBe("ejecutada"); // el contexto de pruebas tiene un N alto
    const antes = (await q("SELECT 1 FROM ordenes WHERE tramo = 'entrada'")).length;
    ponerBid(97_999);
    e.broker.precios = { "BTC/USD": 98_000 };
    const r = await ejecutarVigilante(deps());
    expect(r).toMatchObject({ estado: "completada", ventas: 4, cierres: 4 });
    expect(ventas()).toHaveLength(4);
    expect(await q("SELECT 1 FROM ordenes WHERE tramo = 'entrada'")).toHaveLength(antes);
    expect(await q("SELECT 1 FROM cierres_lote WHERE motivo_cierre = 'stop_loss'")).toHaveLength(4);
  });
});
