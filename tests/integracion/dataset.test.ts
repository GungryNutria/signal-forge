import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leerActivo, leerArgumentos } from "@/procesos/dataset";
import { ejecutarSeguimiento } from "@/procesos/seguimiento";
import { filasDataset, type FilaDataset } from "@/server/dataset";
import { sembrar } from "../../scripts/sembrar";
import { abrirPool, vaciarBase } from "./arnes";
import { sembrarCierre } from "./ayudas";
import { FUENTE_DECISOR, sembrarDecision, sembrarMuestras, sembrarSenal } from "./ayudas-seguimiento";

// AC-20 y AC-29: la extracción da una fila por evaluación, sin llamadas externas ni cambios en los registros,
// y filtrada por activo solo trae ese activo.

const TABLAS = ["ejecuciones", "evaluaciones", "propuestas", "ordenes", "eventos_orden", "lotes", "cierres_lote", "investigaciones", "eventos"];

let pool: Pool;
async function conteos() {
  const r: Record<string, number> = {};
  for (const t of TABLAS) r[t] = (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  return r;
}
async function todo(f: Parameters<typeof filasDataset>[1] = {}) {
  const filas: FilaDataset[] = [];
  for await (const fila of filasDataset(pool, f)) filas.push(fila);
  return filas;
}

beforeAll(async () => {
  pool = abrirPool(3);
  process.env.APP_ENV = "test";
  await vaciarBase();
  // Evaluaciones de todos los resultados, propuestas ejecutadas (abierta y cerradas) y rechazada, con investigación por activo.
  await sembrar(pool, "ejecutada-y-rechazada");
  await sembrar(pool, "ejecuciones-por-caso");
});
afterAll(() => pool.end());

describe("dataset (AC-20)", () => {
  it("da una fila por evaluación, con foto, decisión y etiqueta, sin tocar los registros", async () => {
    const antes = await conteos();
    const filas = await todo();
    expect(await conteos()).toEqual(antes);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM evaluaciones");
    expect(filas).toHaveLength(rows[0].n);
    expect(new Set(filas.map((f) => f.evaluacion_id)).size).toBe(filas.length);
    for (const f of filas) {
      for (const c of ["evaluacion_id", "ejecucion_id", "ranura", "evaluada_en", "activo", "version_regla", "resultado", "foto", "propuesta_id", "decision", "motivo", "lote_id", "etiqueta_estado", "motivo_cierre", "etiqueta_exito", "pnl_neto_usd", "pnl_neto_pct", "duracion_min"])
        expect(f).toHaveProperty(c);
      expect((f.foto as { version: string }).version).toBe("foto-v2");
    }
  });

  it("sale en orden cronológico", async () => {
    const t = (await todo()).map((f) => (f.evaluada_en as Date).getTime());
    expect(t).toEqual([...t].sort((a, b) => a - b));
  });

  it("etiqueta: pendiente con el lote abierto, cerrada con su PnL, no aplica sin operación", async () => {
    const filas = await todo();
    const por = (e: string) => filas.filter((f) => f.etiqueta_estado === e);
    const cerradas = por("cerrada");
    expect(cerradas.map((f) => [f.motivo_cierre, f.etiqueta_exito, f.pnl_neto_usd]).sort()).toEqual([
      ["stop_loss", 0, "-12.45"],
      ["take_profit", 1, "17.40"],
    ]);
    expect(por("pendiente").length).toBeGreaterThanOrEqual(1);
    for (const f of por("no_aplica")) expect(f.etiqueta_exito).toBeNull();
  });

  it("pagina por lotes sin perder ni repetir filas", async () => {
    await pool.query(
      `INSERT INTO ejecuciones (id, ranura, inicio, version_regla)
       SELECT gen_random_uuid(), now(), now() - (g || ' seconds')::interval, 'tendencia-sma-v1' FROM generate_series(1, 600) g`,
    );
    await pool.query(
      `INSERT INTO evaluaciones (ejecucion_id, activo, evaluada_en, resultado, version_regla, foto)
       SELECT id, 'BTC/USD', inicio, 'sin_senal', 'tendencia-sma-v1', '{"version":"foto-v1"}' FROM ejecuciones
       WHERE id NOT IN (SELECT ejecucion_id FROM evaluaciones)`,
    );
    const filas = await todo();
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM evaluaciones");
    expect(filas).toHaveLength(rows[0].n);
    expect(new Set(filas.map((f) => f.evaluacion_id)).size).toBe(rows[0].n);
  });
});

describe("dataset por activo (AC-29)", () => {
  it("--activo SOL/USD solo trae SOL, y SOL + BTC = total", async () => {
    const todas = await todo();
    const sol = await todo({ activo: "SOL/USD" });
    const btc = await todo({ activo: "BTC/USD" });
    expect(sol.length).toBeGreaterThan(0);
    expect(sol.every((f) => f.activo === "SOL/USD")).toBe(true);
    expect(btc.every((f) => f.activo === "BTC/USD")).toBe(true);
    expect(sol.length + btc.length).toBe(todas.length);
  });

  it("en la foto, el precio y la investigación son del activo evaluado", async () => {
    const filas = (await todo()).filter((f) => (f.foto as { investigacion?: { estado: string } }).investigacion?.estado === "adjunta");
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) {
      const foto = f.foto as { mercado: { activo: string; ultimo_precio: { valor: string } | null }; investigacion: { id: string } };
      expect(foto.mercado.activo).toBe(f.activo);
      const { rows } = await pool.query("SELECT activo FROM investigaciones WHERE id = $1", [foto.investigacion.id]);
      expect(rows[0].activo).toBe(f.activo);
      const precio = Number(foto.mercado.ultimo_precio?.valor);
      if (f.activo === "SOL/USD") expect(precio).toBeLessThan(1000);
      else expect(precio).toBeGreaterThan(10_000);
    }
  });

  it("rechaza un activo que no existe", async () => {
    await expect(todo({ activo: "DOGE/USD" as "BTC/USD" })).rejects.toThrow(/activo inválido/);
  });
});

describe("argumentos de dist/dataset.mjs", () => {
  it("--activo y --activo=", () => {
    expect(leerActivo([])).toBeUndefined();
    expect(leerActivo(["--activo", "SOL/USD"])).toBe("SOL/USD");
    expect(leerActivo(["--activo=BTC/USD"])).toBe("BTC/USD");
    expect(() => leerActivo(["--activo", "DOGE/USD"])).toThrow();
    expect(() => leerActivo(["--otro"])).toThrow(/desconocido/);
  });

  it("--proponente, --modo y las dos formas de cada argumento", () => {
    expect(leerArgumentos(["--proponente", "decisor", "--modo=solo_registra", "--activo", "SOL/USD"])).toEqual({
      proponente: "decisor", modo: "solo_registra", activo: "SOL/USD",
    });
    expect(() => leerArgumentos(["--proponente", "otro"])).toThrow(/ciclo o decisor/);
    expect(() => leerArgumentos(["--modo", "otro"])).toThrow(/--modo/);
  });
});

// AC-25 (REQ-31, REQ-22, REQ-25): proponente y modo explícitos y filtrables; etiquetas reales e hipotéticas en campos distintos.
describe("dataset con proponente y modo (AC-25)", () => {
  const T = (hhmm: string) => new Date(`2026-11-12T${hhmm}:00Z`);
  let s1: string, s2: string, s3: string;
  let idEvitada: string, idInvalida: string, idComprarSolo: string, idEjecutada: string;

  beforeAll(async () => {
    await vaciarBase();
    // Tres señales registradas de BTC: la primera toca el take profit a las 12:06; la segunda sigue pendiente y bloquea a la tercera (N = 1).
    s1 = await sembrarSenal(pool, { t0: T("12:00"), ask: 100_000 });
    s2 = await sembrarSenal(pool, { t0: T("12:30"), ask: 100_000 });
    s3 = await sembrarSenal(pool, { t0: T("12:40"), ask: 100_000 });
    await sembrarSenal(pool, { t0: T("12:00"), ask: 100_000, resultado: "sin_senal", modo: "ejecuta" });
    await sembrarMuestras(pool, "BTC/USD", T("12:01"), [100_000, 100_500, 101_000, 102_000, 103_000, 104_000]);
    await sembrarMuestras(pool, "SOL/USD", T("12:01"), [199, 195]);
    // Decisor: una entrada evitada (SOL, toca el stop), una inválida, un "comprar" en solo registro y un "comprar" ejecutado y cerrado.
    // Los contextos traen el ask de BTC y SOL a 100 000 y 200 (valores por omisión).
    idEvitada = await sembrarDecision(pool, { ranura: T("11:45"), activo: "SOL/USD", decision: "no_comprar", recibidaEn: T("11:50") });
    idInvalida = await sembrarDecision(pool, { ranura: T("11:45"), activo: "BTC/USD", valida: false, recibidaEn: T("11:51") });
    idComprarSolo = await sembrarDecision(pool, { ranura: T("12:45"), activo: "SOL/USD", decision: "comprar", recibidaEn: T("12:50") });
    idEjecutada = await sembrarDecision(pool, { ranura: T("12:45"), activo: "BTC/USD", decision: "comprar", recibidaEn: T("12:51"), modo: "ejecuta" });
    await sembrarCierre(pool, { n: 900, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93, decisionId: idEjecutada });
    await ejecutarSeguimiento({ pool, ahora: () => T("14:00"), log: () => {}, fuente: FUENTE_DECISOR("solo_registra") });
  });

  it("--proponente decisor: una fila por decisión recibida, con todos sus campos", async () => {
    const filas = await todo({ proponente: "decisor" });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM decisiones");
    expect(filas).toHaveLength(rows[0].n);
    expect(filas).toHaveLength(4);
    for (const f of filas) {
      for (const c of ["decision_id", "recibida_en", "ranura", "activo", "proponente", "modo", "motivo_modo", "valida", "estado", "motivo",
        "decision", "confianza", "razonamiento", "version_instrucciones", "ejecucion_decisor", "contexto_id", "contexto", "propuesta_id",
        "propuesta_decision", "propuesta_motivo", "reglas_incumplidas", "lote_id", "etiqueta_estado", "motivo_cierre", "etiqueta_exito",
        "pnl_neto_usd", "pnl_neto_pct", "pnl_a_nivel_usd", "pnl_a_nivel_pct", "hip_resultado", "hip_tocado_en", "hip_pnl_a_nivel_usd",
        "hip_pnl_a_nivel_pct", "hip_etiqueta_exito", "hip_huecos"])
        expect(f).toHaveProperty(c);
      expect(f.proponente).toBe("decisor");
      expect((f.contexto as { version: string }).version).toBe("contexto-v1");
    }
    const por = (id: string) => filas.find((f) => f.decision_id === id)!;
    expect(por(idEvitada)).toMatchObject({ decision: "no_comprar", modo: "solo_registra", hip_resultado: "stop_loss", hip_pnl_a_nivel_usd: "-12.45", hip_etiqueta_exito: 0, etiqueta_exito: null });
    expect(por(idInvalida)).toMatchObject({ valida: false, decision: null, hip_resultado: null });
    expect(por(idComprarSolo)).toMatchObject({ decision: "comprar", propuesta_id: null, etiqueta_estado: "no_aplica", hip_resultado: null });
    // Etiqueta real en sus campos y nada hipotético; el PnL a nivel se conserva aparte del neto.
    expect(por(idEjecutada)).toMatchObject({
      modo: "ejecuta", etiqueta_estado: "cerrada", motivo_cierre: "stop_loss", etiqueta_exito: 0, pnl_neto_usd: "-14.93",
      pnl_a_nivel_usd: "-12.45", hip_resultado: null, hip_etiqueta_exito: null,
    });
  });

  it("--proponente ciclo trae el resultado hipotético de sus señales y si cuentan para la regla con N = 1", async () => {
    const filas = await todo({ proponente: "ciclo", modo: "solo_registra", topeN: 1 });
    expect(filas.map((f) => f.evaluacion_id).sort()).toEqual([s1, s2, s3].sort());
    const por = (id: string) => filas.find((f) => f.evaluacion_id === id)!;
    expect(por(s1)).toMatchObject({ proponente: "ciclo", modo: "solo_registra", hip_resultado: "take_profit", hip_pnl_a_nivel_usd: "17.40", hip_etiqueta_exito: 1, hip_cuenta_para_regla: true, etiqueta_exito: null });
    expect(por(s2)).toMatchObject({ hip_resultado: "pendiente", hip_pnl_a_nivel_usd: null, hip_cuenta_para_regla: true });
    expect(por(s3)).toMatchObject({ hip_resultado: "pendiente", hip_cuenta_para_regla: false });
  });

  it("con N = 2 la tercera sí cuenta, y sin N la columna sale null; las filas que no son señal no la llevan", async () => {
    const con2 = await todo({ proponente: "ciclo", topeN: 2 });
    expect(con2.find((f) => f.evaluacion_id === s3)).toMatchObject({ hip_cuenta_para_regla: true });
    const sinN = await todo({ proponente: "ciclo" });
    expect(sinN.find((f) => f.evaluacion_id === s1)).toMatchObject({ hip_cuenta_para_regla: null });
    const noSenal = sinN.find((f) => f.resultado === "sin_senal")!;
    expect(noSenal).not.toHaveProperty("hip_cuenta_para_regla");
    expect(noSenal).toMatchObject({ proponente: "ciclo", modo: "ejecuta", hip_resultado: null });
  });

  it("sin --proponente salen primero las del ciclo y después las del decisor, y --modo filtra las dos", async () => {
    const todas = await todo({ topeN: 1 });
    expect(todas.map((f) => f.proponente)).toEqual([...Array(4).fill("ciclo"), ...Array(4).fill("decisor")]);
    // Las evaluaciones de ciclo con modo "ejecuta": la sin_senal sembrada; del decisor, la compra ejecutada.
    const ejecuta = await todo({ modo: "ejecuta", topeN: 1 });
    expect(ejecuta.map((f) => [f.proponente, f.modo])).toEqual([["ciclo", "ejecuta"], ["decisor", "ejecuta"]]);
    await expect(todo({ proponente: "otro" as "ciclo" })).rejects.toThrow(/proponente inválido/);
    await expect(todo({ modo: "otro" as "ejecuta" })).rejects.toThrow(/modo inválido/);
  });

  it("extraer no modifica ningún registro", async () => {
    const n = async () =>
      (await pool.query("SELECT (SELECT count(*) FROM decisiones) + (SELECT count(*) FROM resultados_hipoteticos) + (SELECT count(*) FROM evaluaciones) AS n")).rows[0].n;
    const antes = await n();
    await todo({ topeN: 1 });
    expect(await n()).toBe(antes);
  });
});
