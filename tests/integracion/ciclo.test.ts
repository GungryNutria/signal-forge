import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { tsPosteriores } from "@/core/foto";
import { ejecutarCiclo, type DepsCiclo } from "@/procesos/ciclo";
import { BrokerSimulado, DatosSimulados } from "@/server/broker/simulado";
import type { Barra } from "@/server/broker/tipos";
import { abrirPool, reiniciarBase } from "./arnes";
import { AHORA } from "./ayudas";

// AC-6, AC-7, AC-12 (por ciclo), AC-18, AC-24 (ciclo), AC-29 (foto), AC-31 y REQ-6, 24, 35, 40 sobre ejecutarCiclo.
const MIN = 60_000;
const SECRETO = `sf-senuelo-${randomUUID()}`;

type Entorno = { pool: Pool; broker: BrokerSimulado; datos: DatosSimulados; deps: DepsCiclo; log: string[] };
let e: Entorno;
const q = async (texto: string, valores: unknown[] = []) => (await e.pool.query(texto, valores)).rows;

/** 52 barras de 30 min; la última cerrada termina en `fin`. Creciente = hay señal. */
function barras(fin: Date, tendencia: "sube" | "baja", base: number): Barra[] {
  return Array.from({ length: 52 }, (_, i) => {
    const k = tendencia === "sube" ? i : 51 - i;
    const c = base + k;
    return { t: new Date(fin.getTime() - (52 - i) * 30 * MIN).toISOString(), o: c, h: c, l: c, c, v: 2 };
  });
}

function crear(opciones: { btc?: "sube" | "baja"; sol?: "sube" | "baja"; env?: Partial<DepsCiclo["env"]> } = {}): Entorno {
  const pool = abrirPool(12);
  const broker = new BrokerSimulado();
  broker.precios = { "BTC/USD": 100_000, "SOL/USD": 200 };
  const datos = new DatosSimulados();
  datos.barras = {
    "BTC/USD": barras(AHORA, opciones.btc ?? "sube", 100_000),
    "SOL/USD": barras(AHORA, opciones.sol ?? "sube", 200),
  };
  const quote = (p: number) => ({
    bid: p - 1,
    ask: p + 1,
    ultimo: p,
    tsQuote: new Date(AHORA.getTime() - 10_000),
    tsTrade: new Date(AHORA.getTime() - 20_000),
  });
  datos.instantaneas = { "BTC/USD": quote(100_000), "SOL/USD": quote(200) };
  const log: string[] = [];
  const deps: DepsCiclo = {
    pool,
    broker,
    datos,
    ahora: () => AHORA,
    env: { APCA_API_BASE_URL: "https://paper-api.alpaca.markets", TRADING_PAUSADO: "false", ...opciones.env },
    secretos: [SECRETO],
    esperar: async () => {},
    log: (l) => log.push(JSON.stringify(l)),
  };
  return { pool, broker, datos, deps, log };
}

async function reiniciar(opciones: Parameters<typeof crear>[0] = {}) {
  await e?.pool.end();
  await reiniciarBase();
  e = crear(opciones);
}

beforeEach(() => reiniciar());
afterAll(() => e?.pool.end());

describe("ciclo con señal y sin señal (AC-7, AC-31)", () => {
  it("señal en los dos activos: 2 propuestas ejecutadas, ligadas a su evaluación, con clave por ranura", async () => {
    const r = await ejecutarCiclo(e.deps);
    expect(r.estado).toBe("completada");
    expect(r.evaluaciones.map((x) => [x.activo, x.resultado])).toEqual([
      ["BTC/USD", "propuesta"],
      ["SOL/USD", "propuesta"],
    ]);
    const ps = await q(
      `SELECT p.activo, p.decision, p.clave_idempotencia, p.ejecucion_id, p.version_regla, p.justificacion, ev.activo AS ev_activo
       FROM propuestas p JOIN evaluaciones ev ON ev.id = p.evaluacion_id ORDER BY p.activo`,
    );
    expect(ps).toHaveLength(2);
    for (const p of ps) {
      expect(p.decision).toBe("ejecutada");
      expect(p.ev_activo).toBe(p.activo);
      expect(p.ejecucion_id).toBe(r.ejecucionId);
      expect(p.version_regla).toBe("tendencia-sma-v1");
      expect(p.justificacion.entradas.closes).toHaveLength(21);
      expect(p.clave_idempotencia).toBe(`ciclo:tendencia-sma-v1:2026-11-06T12:00:00Z:${p.activo}`);
    }
    expect(e.broker.registradas).toHaveLength(2);
    expect(await q("SELECT 1 FROM lotes")).toHaveLength(2);
  });

  it("sin señal: 0 propuestas, 0 órdenes y dos evaluaciones sin_senal; la ejecución queda completa (AC-31)", async () => {
    await reiniciar({ btc: "baja", sol: "baja" });
    const r = await ejecutarCiclo(e.deps);
    expect(r.evaluaciones.map((x) => x.resultado)).toEqual(["sin_senal", "sin_senal"]);
    expect(await q("SELECT 1 FROM propuestas")).toHaveLength(0);
    expect(e.broker.llamadas).toHaveLength(0);
    const [ej] = await q("SELECT * FROM v_ejecuciones");
    expect(ej).toMatchObject({ estado: "completada", version_regla: "tendencia-sma-v1" });
    expect(ej.inicio).toBeInstanceOf(Date);
    expect(ej.fin).toBeInstanceOf(Date);
    expect(new Date(ej.ranura).toISOString()).toBe(AHORA.toISOString());
    const evs = await q("SELECT activo, resultado, version_regla FROM evaluaciones ORDER BY activo");
    expect(evs).toEqual([
      { activo: "BTC/USD", resultado: "sin_senal", version_regla: "tendencia-sma-v1" },
      { activo: "SOL/USD", resultado: "sin_senal", version_regla: "tendencia-sma-v1" },
    ]);
  });

  it("señal solo en SOL: BTC sin_senal y una sola propuesta", async () => {
    await reiniciar({ btc: "baja" });
    await ejecutarCiclo(e.deps);
    expect(await q("SELECT activo FROM propuestas")).toEqual([{ activo: "SOL/USD" }]);
  });

  it("mismo ciclo dos veces en la misma ranura: 1 orden por activo y 1 propuesta original (AC-12)", async () => {
    await ejecutarCiclo(e.deps);
    await ejecutarCiclo(e.deps);
    expect(e.broker.registradas).toHaveLength(2);
    expect(await q("SELECT 1 FROM propuestas WHERE es_original")).toHaveLength(2);
    expect(await q("SELECT 1 FROM ejecuciones")).toHaveLength(2);
    expect(await q("SELECT 1 FROM evaluaciones")).toHaveLength(4);
  });

  it("TRADING_PAUSADO=true: el ciclo corre y registra, y las propuestas quedan rechazadas por R8 (AC-24)", async () => {
    await reiniciar({ env: { TRADING_PAUSADO: "true" } });
    const r = await ejecutarCiclo(e.deps);
    expect(r.estado).toBe("completada");
    const ps = await q("SELECT decision, reglas_incumplidas FROM propuestas");
    expect(ps).toHaveLength(2);
    for (const p of ps) expect(p).toEqual({ decision: "rechazada", reglas_incumplidas: ["R8"] });
    expect(e.broker.llamadas).toHaveLength(0);
  });
});

describe("datos no disponibles (AC-6, REQ-6)", () => {
  it("datos caídos: datos_no_disponibles, 0 propuestas, 0 llamadas al broker y error en lecturas_mercado", async () => {
    e.datos.caido = true;
    const r = await ejecutarCiclo(e.deps);
    expect(r.estado).toBe("completada");
    expect(r.evaluaciones.map((x) => x.resultado)).toEqual(["datos_no_disponibles", "datos_no_disponibles"]);
    expect(await q("SELECT 1 FROM propuestas")).toHaveLength(0);
    expect(e.broker.llamadas).toHaveLength(0);
    const l = await q("SELECT activo, ultimo_error_en, bid FROM lecturas_mercado ORDER BY activo");
    expect(l).toHaveLength(2);
    for (const x of l) {
      expect(x.ultimo_error_en).toBeInstanceOf(Date);
      expect(x.bid).toBeNull();
    }
  });

  it.each([
    ["menos de 21 barras cerradas", (x: Entorno) => (x.datos.barras["BTC/USD"] = barras(AHORA, "sube", 1).slice(-20))],
    [
      "última barra cerrada de hace más de 60 min",
      (x: Entorno) => (x.datos.barras["BTC/USD"] = barras(new Date(AHORA.getTime() - 61 * MIN), "sube", 1)),
    ],
    [
      "quote de hace 301 s",
      (x: Entorno) =>
        (x.datos.instantaneas["BTC/USD"] = {
          ...x.datos.instantaneas["BTC/USD"]!,
          tsQuote: new Date(AHORA.getTime() - 301_000),
        }),
    ],
    ["sin quote", (x: Entorno) => delete x.datos.instantaneas["BTC/USD"]],
  ])("%s: solo BTC queda sin datos y SOL se evalúa", async (_n, ajustar) => {
    ajustar(e);
    const r = await ejecutarCiclo(e.deps);
    expect(r.evaluaciones.map((x) => x.resultado)).toEqual(["datos_no_disponibles", "propuesta"]);
    expect((await q("SELECT error_detalle FROM evaluaciones WHERE activo = 'BTC/USD'"))[0].error_detalle).toBeTruthy();
  });

  it("una última barra cerrada de hace 60 min exactos todavía sirve", async () => {
    e.datos.barras["BTC/USD"] = barras(new Date(AHORA.getTime() - 60 * MIN), "sube", 1);
    const r = await ejecutarCiclo(e.deps);
    expect(r.evaluaciones[0].resultado).toBe("propuesta");
  });
});

describe("foto (AC-18, AC-29, REQ-23, REQ-24, REQ-40)", () => {
  it("la foto tiene todos los campos y ningún ts posterior a evaluada_en; lo posterior va a faltantes", async () => {
    e.datos.instantaneas["BTC/USD"] = { ...e.datos.instantaneas["BTC/USD"]!, tsTrade: new Date(AHORA.getTime() + 5_000) };
    await ejecutarCiclo(e.deps);
    for (const f of await q("SELECT activo, evaluada_en, foto FROM evaluaciones ORDER BY activo")) {
      expect(f.foto.version).toBe("foto-v1");
      expect(Object.keys(f.foto).sort()).toEqual(["cartera", "investigacion", "mercado", "momento", "regla", "version"]);
      expect(f.foto.regla.resultado.senal).toBe(true);
      expect(f.foto.regla.entradas.closes).toHaveLength(21);
      expect(tsPosteriores(f.foto, new Date(f.evaluada_en))).toEqual([]);
    }
    const btc = (await q("SELECT foto FROM evaluaciones WHERE activo = 'BTC/USD'"))[0].foto;
    expect(btc.mercado.ultimo_precio).toBeNull();
    expect(btc.mercado.faltantes).toContain("ultimo_precio");
    expect(btc.mercado.bid.valor).toBe("99999");
    expect(btc.cartera).toMatchObject({ saldo_virtual_usd: "10000.00", lotes_abiertos: 0, entradas_hoy: 0, pnl_dia_usd: "0.00" });
  });

  it("la foto de cada activo lleva su precio y su investigación, nunca los del otro (AC-29)", async () => {
    const inv = (activo: string, minutos: number, resumen: string, sentimiento: number) =>
      e.pool.query(
        `INSERT INTO investigaciones (recibida_en, estado, clave_idempotencia, huella_contenido, ejecucion_investigador,
           version_instrucciones, activo, sentimiento, noticia_fuerte, confianza, resumen, fuentes)
         VALUES ($1, 'aceptada', $2, repeat('a', 64), 'x', 'investigacion-v1', $3, $4, false, 0.8, $5, ARRAY['https://ejemplo.com'])`,
        [new Date(AHORA.getTime() - minutos * MIN), `inv:${activo}:${minutos}`, activo, sentimiento, resumen],
      );
    await inv("BTC/USD", 59, "resumen btc", 0.1);
    await inv("SOL/USD", 61, "sol vencida", 0.9); // fuera de vigencia
    await inv("SOL/USD", 10, "resumen sol", 0.5);
    await inv("BTC/USD", -5, "del futuro", 0.9); // posterior a T
    await ejecutarCiclo(e.deps);
    const fotos = Object.fromEntries(
      (await q("SELECT activo, foto, investigacion_id FROM evaluaciones")).map((f) => [f.activo, f]),
    );
    expect(fotos["BTC/USD"].foto.mercado.ultimo_precio.valor).toBe("100000");
    expect(fotos["SOL/USD"].foto.mercado.ultimo_precio.valor).toBe("200");
    expect(fotos["BTC/USD"].foto.investigacion).toMatchObject({ estado: "adjunta", resumen: "resumen btc", antiguedad_min: 59, sentimiento: "0.1" });
    expect(fotos["SOL/USD"].foto.investigacion).toMatchObject({ estado: "adjunta", resumen: "resumen sol", antiguedad_min: 10 });
    expect(fotos["BTC/USD"].investigacion_id).not.toBe(fotos["SOL/USD"].investigacion_id);
  });

  it("sin investigación vigente la foto dice sin_investigacion", async () => {
    await ejecutarCiclo(e.deps);
    const [f] = await q("SELECT foto FROM evaluaciones WHERE activo = 'SOL/USD'");
    expect(f.foto.investigacion).toEqual({ estado: "sin_investigacion" });
  });
});

describe("secretos y plazo (AC-4, RNF-11)", () => {
  it("un error con la llave dentro no llega al log ni a la base", async () => {
    e.datos.barras30m = async () => {
      throw new Error(`fallo de red con ${SECRETO}`);
    };
    await ejecutarCiclo(e.deps);
    expect(e.log.join("\n")).not.toContain(SECRETO);
    const filas = await q("SELECT error_detalle FROM evaluaciones UNION ALL SELECT ultimo_error FROM lecturas_mercado");
    expect(JSON.stringify(filas)).not.toContain(SECRETO);
    expect(JSON.stringify(filas)).toContain("[oculto]");
  });

  it("si el plazo interno se agota, los activos pendientes quedan en error y la ejecución cierra en error", async () => {
    e.datos.barras30m = () => new Promise(() => {});
    const r = await ejecutarCiclo({ ...e.deps, plazoMs: 150 });
    expect(r.estado).toBe("error");
    expect(r.evaluaciones.map((x) => x.resultado)).toEqual(["error", "error"]);
    const [c] = await q("SELECT estado, error FROM ejecuciones_cierre");
    expect(c).toMatchObject({ estado: "error", error: "plazo interno agotado" });
    expect(await q("SELECT 1 FROM eventos WHERE tipo = 'error_ciclo'")).toHaveLength(1);
  });
});
