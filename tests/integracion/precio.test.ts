import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operacionesPrecio, seriePrecio } from "@/server/consultas/precio";
import { obtenerDb } from "@/server/db/cliente";
import { PRECIO_CONOCIDO as K, sembrar } from "../../scripts/sembrar";
import { abrirPool, urlDePrueba, vaciarBase } from "./arnes";

// S6 (spec 002), T-1: AC-1, 2, 3, 6, 8, 9, 10, 11 y 16 (lectura) contra los valores de `PRECIO_CONOCIDO`.

const AHORA = new Date();
const MIN = 60_000;
const haceMin = (m: number) => new Date(AHORA.getTime() - m * MIN).toISOString();
const num = (x: string | null | undefined) => Number(x);

let pool: Pool;
beforeAll(() => {
  // AC-16: las consultas se conectan con transacciones de solo lectura por defecto; cualquier escritura fallaría.
  const url = new URL(urlDePrueba());
  url.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = url.toString();
  process.env.APP_ENV = "test";
  pool = abrirPool(3);
});
afterAll(() => pool.end());

async function con(escenario: string) {
  await vaciarBase();
  await sembrar(pool, escenario, AHORA);
}

describe("seriePrecio (precio-serie)", () => {
  beforeAll(() => con("precio-serie"));

  it("AC-1, AC-3: los puntos de BTC/USD son los conocidos, sin SOL/USD, con hueco en los dos puntos esperados", async () => {
    const s = await seriePrecio("BTC/USD", "24h", AHORA);
    const esperados = K.puntosBtc(AHORA);
    expect(esperados).toHaveLength(40);
    expect(s.puntos.map(({ t, cierre, sma20, cierrePrevio, resultado, hueco }) => ({ t, cierre, sma20, cierrePrevio, resultado, hueco }))).toEqual(esperados);
    expect(s.puntos.filter((p) => p.hueco)).toHaveLength(2);
    // t = cierre de la vela = inicio + 30 min
    for (const p of s.puntos) expect(Date.parse(p.t) - Date.parse(p.inicioVela)).toBe(30 * MIN);
    expect(s).toMatchObject({ activo: "BTC/USD", rango: "24h", hasta: AHORA.toISOString(), desde: haceMin(24 * 60) });
    expect(s.ultimoPunto).toBe(esperados.at(-1)?.t);
  });

  it("AC-1: SOL/USD trae solo sus 10 puntos, en su escala", async () => {
    const s = await seriePrecio("SOL/USD", "24h", AHORA);
    expect(s.puntos).toHaveLength(10);
    expect(s.puntos.every((p) => num(p.cierre) < 1000)).toBe(true);
    expect(s.puntos.every((p) => !p.hueco)).toBe(true);
  });

  it("AC-2: una sola fila por vela, con los valores de la primera evaluación", async () => {
    const s = await seriePrecio("BTC/USD", "24h", AHORA);
    const { slot, sumaAlCierre } = K.btc.duplicada;
    const t = haceMin(K.btc.ultimoHace + (K.btc.total - 1 - slot) * 30);
    const delaVela = s.puntos.filter((p) => p.t === t);
    expect(delaVela).toHaveLength(1);
    expect(num(delaVela[0].cierre)).toBe(100_000 + 10 * (slot + 20) + ((slot + 20) % 2 ? 7 : -3));
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM evaluaciones WHERE activo = 'BTC/USD' AND (foto->'mercado'->>'ts_ultima_barra')::timestamptz = $1::timestamptz - interval '30 minutes'",
      [t],
    );
    expect(rows[0].n).toBe(2);
    expect(sumaAlCierre).toBeGreaterThan(0);
  });

  it("REQ-4: un rango más corto recorta los puntos y primerPunto/ultimoPunto miran toda la historia", async () => {
    const corto = await seriePrecio("BTC/USD", "24h", new Date(AHORA.getTime() + 20 * 60 * MIN));
    const todo = await seriePrecio("BTC/USD", "todo", AHORA);
    expect(todo.desde).toBeNull();
    expect(todo.puntos).toHaveLength(40);
    expect(todo.primerPunto).toBe(K.puntosBtc(AHORA)[0].t);
    expect(corto.puntos.length).toBeLessThan(40);
    expect(corto.primerPunto).toBe(todo.primerPunto);
  });

  it("AC-16: la conexión de las consultas es de solo lectura y las dos consultas corren sin error", async () => {
    const db = obtenerDb();
    expect((await db.execute(sql`SHOW transaction_read_only`)).rows[0]).toEqual({ transaction_read_only: "on" });
    const escritura = await db.execute(sql`DELETE FROM evaluaciones`).catch((e: Error) => e);
    expect((escritura as Error).cause).toMatchObject({ message: expect.stringMatching(/read-only/) });
    await Promise.all([seriePrecio("BTC/USD", "todo", AHORA), operacionesPrecio("BTC/USD", "todo", AHORA)]);
  });

  it("sin lotes: filas vacías y cero abiertas", async () => {
    expect(await operacionesPrecio("BTC/USD", "24h", AHORA)).toEqual({ filas: [], abiertasPorActivo: { "BTC/USD": 0, "SOL/USD": 0 } });
  });
});

describe("operacionesPrecio (precio-operaciones)", () => {
  beforeAll(() => con("precio-operaciones"));

  it("AC-9: solo los 3 lotes con entrada llenada; riesgo, broker, no enviada y desconocida no aparecen", async () => {
    const r = await operacionesPrecio("BTC/USD", "24h", AHORA);
    expect(r.filas).toHaveLength(3);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM propuestas WHERE activo = 'BTC/USD'");
    expect(rows[0].n).toBe(7); // 3 con lote + 4 sin posición
    expect(r.abiertasPorActivo).toEqual({ "BTC/USD": 1, "SOL/USD": 0 });
  });

  it("AC-6: los campos son los de la justificación y del cierre sembrados (orden ascendente por entrada)", async () => {
    const r = await operacionesPrecio("BTC/USD", "24h", AHORA);
    expect(r.filas.map((f) => num(f.entrada.precio))).toEqual([K.tp.precio, K.sl.precio, K.abierta.precio]);
    const [tp, sl, ab] = r.filas;

    expect(tp.entrada).toMatchObject({ t: haceMin(K.tp.entradaHace - 0.05), nocionalUsd: "500.00", enRango: true });
    expect([num(tp.entrada.cierre), num(tp.entrada.cierrePrevio), num(tp.entrada.sma20)]).toEqual([K.tp.regla.close_ultimo, K.tp.regla.close_previo, K.tp.regla.sma20]);
    expect(tp.salida).toMatchObject({ t: haceMin(K.tp.salidaHace), motivo: "take_profit", enRango: true });
    expect(num(tp.salida?.precio)).toBe(K.tp.salida);
    expect(num(tp.salida?.nivel)).toBe(K.tp.salida);

    expect(sl.salida).toMatchObject({ t: haceMin(K.sl.salidaHace), motivo: "stop_loss" });
    expect(num(sl.salida?.nivel)).toBe(K.sl.salida);
    expect([num(sl.entrada.cierre), num(sl.entrada.cierrePrevio), num(sl.entrada.sma20)]).toEqual([K.sl.regla.close_ultimo, K.sl.regla.close_previo, K.sl.regla.sma20]);

    expect(num(sl.entrada.cantidad)).toBeCloseTo(500 / K.sl.precio, 8);
    expect(sl.numero).toBeNull();
    expect(sl.niveles).toBeNull();
    expect(tp.niveles).toBeNull();

    // PnL y duración: los que quedaron guardados en cierres_lote
    const { rows } = await pool.query(
      "SELECT l.precio_entrada::float AS p, c.pnl_neto_usd::text AS usd, c.pnl_neto_pct::text AS pct, c.duracion_s FROM lotes l JOIN cierres_lote c ON c.lote_id = l.id",
    );
    for (const f of [tp, sl]) {
      const g = rows.find((x) => x.p === num(f.entrada.precio));
      expect(f.salida).toMatchObject({ pnlNetoUsd: g.usd, pnlNetoPct: g.pct, duracionS: g.duracion_s });
    }

    expect(ab.salida).toBeNull();
  });

  it("AC-10: el lote abierto trae sus dos niveles y el número #1", async () => {
    const [, , ab] = (await operacionesPrecio("BTC/USD", "24h", AHORA)).filas;
    expect(ab.numero).toBe(1);
    expect(ab.salida).toBeNull();
    expect({ stopLoss: num(ab.niveles?.stopLoss), takeProfit: num(ab.niveles?.takeProfit) }).toEqual(K.abierta.niveles);
  });

  it("el propuestaId es el de la propuesta del lote", async () => {
    const r = await operacionesPrecio("BTC/USD", "24h", AHORA);
    const { rows } = await pool.query("SELECT propuesta_id, precio_entrada::float AS p FROM lotes");
    for (const f of r.filas) expect(rows.find((x) => x.p === num(f.entrada.precio)).propuesta_id).toBe(f.propuestaId);
  });

  it("SOL/USD no tiene operaciones", async () => {
    expect((await operacionesPrecio("SOL/USD", "24h", AHORA)).filas).toEqual([]);
  });
});

describe("precio-operaciones-cerrada", () => {
  it("AC-10: el lote ya cerrado no trae niveles ni número, y sí su salida", async () => {
    await con("precio-operaciones-cerrada");
    const r = await operacionesPrecio("BTC/USD", "24h", AHORA);
    const ab = r.filas.find((f) => num(f.entrada.precio) === K.abierta.precio);
    expect(ab?.niveles).toBeNull();
    expect(ab?.numero).toBeNull();
    expect(ab?.salida).toMatchObject({ motivo: "stop_loss" });
    expect(num(ab?.salida?.precio)).toBe(K.abierta.cierre.salida);
    expect(r.abiertasPorActivo["BTC/USD"]).toBe(0);
  });
});

describe("precio-fuera-de-rango", () => {
  beforeAll(() => con("precio-fuera-de-rango"));

  it("AC-8: en 24 h la entrada queda fuera de rango y la salida dentro", async () => {
    const [op] = (await operacionesPrecio("BTC/USD", "24h", AHORA)).filas;
    expect(op.entrada.enRango).toBe(false);
    expect(op.salida?.enRango).toBe(true);
    expect(num(op.salida?.precio)).toBe(K.fueraDeRango.salida);
  });

  it("AC-8: en 7 días ambas están dentro", async () => {
    const [op] = (await operacionesPrecio("BTC/USD", "7d", AHORA)).filas;
    expect(op.entrada.enRango).toBe(true);
    expect(op.salida?.enRango).toBe(true);
  });

  it("un lote cerrado antes del rango no aparece", async () => {
    const mas = new Date(AHORA.getTime() + 3 * 24 * 60 * MIN);
    expect((await operacionesPrecio("BTC/USD", "24h", mas)).filas).toEqual([]);
    expect((await operacionesPrecio("BTC/USD", "todo", mas)).filas).toHaveLength(1);
  });
});

describe("precio-abiertas-3", () => {
  it("AC-11: numero 1, 2 y 3 por abierto_en (la más antigua es #1)", async () => {
    await con("precio-abiertas-3");
    const r = await operacionesPrecio("SOL/USD", "24h", AHORA);
    expect(r.filas.map((f) => f.numero)).toEqual([1, 2, 3]);
    expect(r.filas.map((f) => num(f.entrada.precio))).toEqual([0, 1, 2].map(K.abiertas.precio));
    expect(r.filas.every((f) => f.niveles !== null)).toBe(true);
    expect(r.abiertasPorActivo).toEqual({ "BTC/USD": 0, "SOL/USD": 3 });
  });
});

describe("precio-abiertas-10", () => {
  it("AC-11: 10 posiciones numeradas del 1 al 10", async () => {
    await con("precio-abiertas-10");
    const r = await operacionesPrecio("SOL/USD", "24h", AHORA);
    expect(r.filas.map((f) => f.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
