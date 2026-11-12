import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { aCentavos, deCentavos } from "@/core/dinero";
import { comparacion, listarEvitadasYRechazadas } from "@/server/consultas/comparacion";
import type { Comparacion, FiltroComparacion } from "@/server/consultas/tipos";
import { type FilaDataset, filasDataset } from "@/server/dataset";
import { COMPARACION_CONOCIDA, sembrar } from "../../scripts/sembrar";
import { abrirPool, urlDePrueba, vaciarBase } from "./arnes";

// T-4 (spec 004): la comparación decisor frente a regla (REQ-23, REQ-25) contra la semilla `decisor-comparacion`, cuyas
// cifras se calcularon a mano (COMPARACION_CONOCIDA), y contra un resumen armado solo con las filas de la extracción.

const AHORA = new Date("2026-11-12T14:20:00Z");
const MIN = 60_000;

let pool: Pool;
beforeAll(async () => {
  process.env.DATABASE_URL = urlDePrueba();
  process.env.APP_ENV = "test";
  pool = abrirPool(3);
  await vaciarBase();
  await sembrar(pool, "decisor-comparacion", AHORA);
});
afterEach(() => {
  delete process.env.SF_FALLA_INYECTADA;
  delete process.env.MAX_ENTRADAS_ABIERTAS_POR_ACTIVO;
});
afterAll(() => pool.end());

const SIN_ID = ({ decisor, regla, coincidencia }: Comparacion) => ({ decisor, regla, coincidencia });

/** Resumen calculado solo con las filas de `dist/dataset.mjs` (`filasDataset`), sin tocar el read model. */
function resumenDesdeDataset(filas: FilaDataset[], desde: Date, activo?: string) {
  const dentro = (t: unknown) => (t as Date).getTime() >= desde.getTime() && (t as Date).getTime() <= AHORA.getTime();
  const deActivo = (r: FilaDataset) => !activo || r.activo === activo;
  const decisor = filas.filter((r) => r.proponente === "decisor" && r.valida === true && dentro(r.recibida_en) && deActivo(r));
  const ciclo = filas.filter((r) => r.proponente === "ciclo");
  const senales = ciclo.filter((r) => r.resultado === "senal_registrada" && dentro(r.evaluada_en) && deActivo(r));
  const cuentan = senales.filter((r) => r.hip_cuenta_para_regla === true);
  const cerradasRegla = cuentan.filter((r) => r.hip_resultado === "take_profit" || r.hip_resultado === "stop_loss");
  const entradas = decisor.filter((r) => r.propuesta_decision === "ejecutada");
  const cerradas = entradas.filter((r) => r.etiqueta_estado === "cerrada");
  const suma = (xs: FilaDataset[], campo: string) => deCentavos(xs.reduce((s, r) => s + aCentavos(Number(r[campo])), 0));
  const tasa = (a: number, c: number) => (c === 0 ? null : { pct: ((a * 100) / c).toFixed(1), aciertos: a, cerradas: c });
  const evitadas = decisor.filter((r) => r.decision === "no_comprar");
  const hip = (x: string) => evitadas.filter((r) => r.hip_resultado === x).length;
  const senalAntes = (r: FilaDataset) => {
    const previas = ciclo
      .filter((c) => c.activo === r.activo && (c.evaluada_en as Date).getTime() < (r.recibida_en as Date).getTime())
      .sort((a, b) => (b.evaluada_en as Date).getTime() - (a.evaluada_en as Date).getTime());
    return previas[0] !== undefined && (previas[0].resultado === "senal_registrada" || previas[0].resultado === "propuesta");
  };
  const n = (senal: boolean, compro: boolean) => decisor.filter((r) => senalAntes(r) === senal && (r.decision === "comprar") === compro).length;
  return {
    decisor: {
      entradas: entradas.length,
      cerradas: cerradas.length,
      tasa: tasa(cerradas.filter((r) => r.etiqueta_exito === 1).length, cerradas.length),
      pnlANivelUsd: suma(cerradas, "pnl_a_nivel_usd"),
      pnlNetoRealUsd: suma(cerradas, "pnl_neto_usd"),
      evitadas: { total: evitadas.length, stopLoss: hip("stop_loss"), takeProfit: hip("take_profit"), pendientes: hip("pendiente"), sinPrecio: hip("sin_precio_entrada") },
      rechazadasPorRegla: [{ regla: "R11", n: decisor.filter((r) => r.propuesta_decision === "rechazada" && (r.reglas_incumplidas as string[])[0] === "R11").length }],
    },
    regla: {
      senales: senales.length,
      cuentan: cuentan.length,
      bloqueadasPorTope: senales.length - cuentan.length,
      cerradas: cerradasRegla.length,
      tasa: tasa(cerradasRegla.filter((r) => r.hip_etiqueta_exito === 1).length, cerradasRegla.length),
      pnlANivelUsd: suma(cerradasRegla, "hip_pnl_a_nivel_usd"),
      pendientes: cuentan.filter((r) => r.hip_resultado === "pendiente").length,
    },
    coincidencia: { senalCompro: n(true, true), senalNoCompro: n(true, false), sinSenalCompro: n(false, true), sinSenalNoCompro: n(false, false) },
  };
}

async function dataset(): Promise<FilaDataset[]> {
  const filas: FilaDataset[] = [];
  for await (const f of filasDataset(pool, { topeN: 1 })) filas.push(f);
  return filas;
}

const CASOS: { nombre: string; filtro: FiltroComparacion; esperado: unknown; desdeMin: number; activo?: string }[] = [
  { nombre: "desde la activación (10 días)", filtro: { periodo: "activacion" }, esperado: COMPARACION_CONOCIDA.activacion, desdeMin: COMPARACION_CONOCIDA.activacionHaceMin },
  { nombre: "7 días: sin la señal y la decisión de hace 9 días", filtro: { periodo: "7d" }, esperado: COMPARACION_CONOCIDA.d7, desdeMin: 7 * 24 * 60 },
  { nombre: "solo BTC/USD, desde la activación", filtro: { activo: "BTC/USD" }, esperado: COMPARACION_CONOCIDA.btc, desdeMin: COMPARACION_CONOCIDA.activacionHaceMin, activo: "BTC/USD" },
];

describe("comparación decisor frente a regla (AC-19, AC-25)", () => {
  it.each(CASOS)("$nombre: las cifras coinciden con el cálculo a mano", async ({ filtro, esperado, desdeMin }) => {
    const c = await comparacion(filtro, AHORA);
    expect(SIN_ID(c)).toEqual(esperado);
    expect(c).toMatchObject({
      activacion: new Date(AHORA.getTime() - COMPARACION_CONOCIDA.activacionHaceMin * MIN).toISOString(),
      desde: new Date(AHORA.getTime() - desdeMin * MIN).toISOString(),
      hasta: AHORA.toISOString(),
      topeN: 1,
      cicloApagadoDesde: null,
    });
  });

  it.each(CASOS)("$nombre: la extracción del dataset da las mismas cifras", async ({ filtro, desdeMin, activo }) => {
    const desde = new Date(AHORA.getTime() - desdeMin * MIN);
    const c = await comparacion(filtro, AHORA);
    expect(SIN_ID(c)).toEqual(resumenDesdeDataset(await dataset(), desde, activo));
  });

  it("las coincidencias suman las decisiones válidas del periodo (AC-UX-16)", async () => {
    const c = (await comparacion({}, AHORA)).coincidencia;
    expect(c.senalCompro + c.senalNoCompro + c.sinSenalCompro + c.sinSenalNoCompro).toBe(10);
  });

  it("el tope sale de MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: con N = 2 la señal de 1450 min ya no se bloquea", async () => {
    process.env.MAX_ENTRADAS_ABIERTAS_POR_ACTIVO = "2";
    const c = await comparacion({}, AHORA);
    expect(c.topeN).toBe(2);
    expect(c.regla).toMatchObject({ senales: 7, cuentan: 7, bloqueadasPorTope: 0 });
  });

  it("sin activación: periodo vacío y ninguna cifra inventada", async () => {
    await vaciarBase();
    const c = await comparacion({}, AHORA);
    expect(c).toMatchObject({ activacion: null, desde: null });
    expect(c.decisor).toMatchObject({ entradas: 0, tasa: null, pnlANivelUsd: "0.00", evitadas: { total: 0 }, rechazadasPorRegla: [] });
    expect(c.regla).toMatchObject({ senales: 0, tasa: null });
    expect(await listarEvitadasYRechazadas({}, AHORA)).toEqual({ filas: [], total: 0, siguiente: null, anterior: null });
    await sembrar(pool, "decisor-comparacion", AHORA);
  });

  it("ciclo apagado: lleva la hora desde la que no hay serie de la regla", async () => {
    const desde = new Date(AHORA.getTime() - 100 * MIN);
    await pool.query(
      `INSERT INTO eventos (momento, tipo, detalle) VALUES ($1, 'modo_proponentes', $2)`,
      [desde, JSON.stringify({ ciclo: { configurado: "apagado", efectivo: "apagado", motivo: null }, decisor: { configurado: "ejecuta", efectivo: "ejecuta", motivo: null } })],
    );
    expect((await comparacion({}, AHORA)).cicloApagadoDesde).toBe(desde.toISOString());
    await vaciarBase();
    await sembrar(pool, "decisor-comparacion", AHORA);
  });

  it("falla inyectada en la comparación (AC-UX-18)", async () => {
    process.env.SF_FALLA_INYECTADA = "comparacion";
    await expect(comparacion({}, AHORA)).rejects.toThrow(/Falla inyectada en comparacion/);
    await expect(listarEvitadasYRechazadas({}, AHORA)).rejects.toThrow(/Falla inyectada en comparacion/);
  });
});

describe("entradas evitadas y propuestas rechazadas (REQ-24, AC-UX-17)", () => {
  it("las 5 evitadas y la rechazada por R11, la más reciente primero", async () => {
    const p = await listarEvitadasYRechazadas({}, AHORA);
    expect(p.total).toBe(6);
    const tiempos = p.filas.map((f) => Date.parse(f.recibidaEn));
    expect(tiempos).toEqual([...tiempos].sort((a, b) => b - a));
    const hace = (f: (typeof p.filas)[number]) => Math.round((AHORA.getTime() - Date.parse(f.recibidaEn)) / MIN);
    expect(p.filas.map((f) => [hace(f), f.tipo, f.activo, f.hipotetico, f.reglaPrincipal])).toEqual([
      [200, "evitada", "SOL/USD", "sin_precio_entrada", undefined],
      [290, "evitada", "SOL/USD", "pendiente", undefined],
      [590, "rechazada", "BTC/USD", undefined, "R11"],
      [790, "evitada", "SOL/USD", "take_profit", undefined],
      [990, "evitada", "BTC/USD", "stop_loss", undefined],
      [12_000, "evitada", "BTC/USD", "take_profit", undefined],
    ]);
    const rechazada = p.filas.find((f) => f.tipo === "rechazada")!;
    expect(rechazada.propuestaId).not.toBeNull();
    expect(p.filas.filter((f) => f.tipo === "evitada").every((f) => f.propuestaId === null)).toBe(true);
    expect(p.filas[0]).toMatchObject({ confianza: "0.720", primeraLinea: expect.stringContaining("Tendencia al alza") });
  });

  it("filtros: tipo, resultado hipotético, activo y periodo", async () => {
    expect((await listarEvitadasYRechazadas({ tipo: "rechazada" }, AHORA)).total).toBe(1);
    expect((await listarEvitadasYRechazadas({ tipo: "evitada" }, AHORA)).total).toBe(5);
    expect((await listarEvitadasYRechazadas({ hipotetico: "take_profit" }, AHORA)).total).toBe(2);
    expect((await listarEvitadasYRechazadas({ hipotetico: "pendiente" }, AHORA)).total).toBe(1);
    expect((await listarEvitadasYRechazadas({ activo: "SOL/USD" }, AHORA)).total).toBe(3);
    expect((await listarEvitadasYRechazadas({ periodo: "7d" }, AHORA)).total).toBe(5);
  });
});
