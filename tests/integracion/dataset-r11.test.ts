import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { procesarPropuesta } from "@/server/propuestas/procesar";
import { reiniciarBase } from "./arnes";
import { compra, crearEntorno, reglasCumplen, sembrarCierre } from "./ayudas";

// AC-10, AC-11 y AC-14 sobre v_dataset (REQ-10, REQ-12, REQ-16): R11 y el deslizamiento salen al final de la fila.
let e: ReturnType<typeof crearEntorno>;
const q = async (texto: string, valores: unknown[] = []) => (await e.pool.query(texto, valores)).rows;
const fila = async (propuestaId: string) => (await q("SELECT * FROM v_dataset WHERE propuesta_id = $1", [propuestaId]))[0];

const COLUMNAS_VIEJAS = [
  "evaluacion_id", "ejecucion_id", "ranura", "evaluada_en", "activo", "version_regla", "resultado", "foto", "propuesta_id",
  "decision", "motivo", "lote_id", "etiqueta_estado", "motivo_cierre", "etiqueta_exito", "pnl_neto_usd", "pnl_neto_pct", "duracion_min",
];
const COLUMNAS_NUEVAS = ["reglas_aplicadas", "r11", "nivel_cierre", "precio_disparo", "deslizamiento_usd", "deslizamiento_pct", "comision_usd"];
// Spec 004 (T-3): van después de las de la 003.
const COLUMNAS_004 = [
  "proponente", "modo", "motivo_modo", "pnl_a_nivel_usd", "pnl_a_nivel_pct", "hip_resultado", "hip_tocado_en",
  "hip_pnl_a_nivel_usd", "hip_pnl_a_nivel_pct", "hip_etiqueta_exito", "hip_huecos",
];

beforeAll(async () => {
  await reiniciarBase();
  e = crearEntorno({}, 1);
});
afterAll(() => (e?.pool as Pool | undefined)?.end());

async function evaluacion(): Promise<string> {
  const [ej] = await q("INSERT INTO ejecuciones (ranura, version_regla) VALUES (now(), 'tendencia-sma-v1') RETURNING id");
  const [ev] = await q(
    `INSERT INTO evaluaciones (ejecucion_id, activo, resultado, version_regla, foto)
     VALUES ($1, 'BTC/USD', 'propuesta', 'tendencia-sma-v1', '{"version":"foto-v2","cartera":{"entradas_abiertas_por_activo":{"BTC/USD":1,"SOL/USD":0}}}') RETURNING id`,
    [ej.id],
  );
  return ev.id;
}

describe("v_dataset con R11 (AC-10)", () => {
  it("una evaluación rechazada por R11 sale con su foto, decision 'rechazada', r11 'incumple' y etiqueta no_aplica", async () => {
    await procesarPropuesta(compra(), { ...e.ctx, evaluacionId: await evaluacion() }); // abre la entrada
    const r = await procesarPropuesta(compra(), { ...e.ctx, evaluacionId: await evaluacion() });
    const f = await fila(r.propuestaId);
    expect(f).toMatchObject({ decision: "rechazada", motivo: "reglas_incumplidas", reglas_aplicadas: "R1-R11", r11: "incumple", etiqueta_estado: "no_aplica" });
    expect(f.foto.cartera.entradas_abiertas_por_activo).toEqual({ "BTC/USD": 1, "SOL/USD": 0 });
    expect(f.lote_id).toBeNull();
    expect(f.deslizamiento_usd).toBeNull();
  });

  it("una compra aprobada lleva r11 'cumple'", async () => {
    await reiniciarBase();
    await e.pool.end();
    e = crearEntorno({}, 1);
    const r = await procesarPropuesta(compra(), { ...e.ctx, evaluacionId: await evaluacion() });
    expect(await fila(r.propuestaId)).toMatchObject({ decision: "ejecutada", reglas_aplicadas: "R1-R11", r11: "cumple" });
  });

  it("la fila mantiene las columnas anteriores, en su orden, y agrega las nuevas al final", async () => {
    const { rows, fields } = await e.pool.query("SELECT * FROM v_dataset LIMIT 1");
    expect(rows).toHaveLength(1);
    expect(fields.map((c) => c.name)).toEqual([...COLUMNAS_VIEJAS, ...COLUMNAS_NUEVAS, ...COLUMNAS_004]);
  });
});

describe("conjunto de reglas aplicado (AC-11, D-4)", () => {
  it("una propuesta con 10 reglas sale como 'R1-R10' y r11 'no_evaluada'", async () => {
    const { propuestaId } = await sembrarCierre(e.pool, { n: 1, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93, evaluacion: true, reglas: reglasCumplen(10) });
    expect(await fila(propuestaId)).toMatchObject({ reglas_aplicadas: "R1-R10", r11: "no_evaluada" });
  });

  it("una venta lleva r11 'no_aplica'", async () => {
    const reglas = reglasCumplen(11).map((r) => (r.regla === "R11" ? { ...r, aplica: false } : r));
    const { propuestaId } = await sembrarCierre(e.pool, { n: 2, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93, evaluacion: true, reglas });
    expect(await fila(propuestaId)).toMatchObject({ reglas_aplicadas: "R1-R11", r11: "no_aplica" });
  });

  it("una propuesta que no llegó al riesgo no tiene conjunto ni r11 (NULL)", async () => {
    const { propuestaId } = await sembrarCierre(e.pool, { n: 3, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93, evaluacion: true, reglas: null });
    expect(await fila(propuestaId)).toMatchObject({ reglas_aplicadas: null, r11: null });
  });

  it("una evaluación sin propuesta tiene ambos en NULL", async () => {
    const id = await evaluacion();
    const [f] = await q("SELECT reglas_aplicadas, r11, nivel_cierre FROM v_dataset WHERE evaluacion_id = $1", [id]);
    expect(f).toEqual({ reglas_aplicadas: null, r11: null, nivel_cierre: null });
  });
});

describe("deslizamiento en el dataset (AC-14, REQ-16)", () => {
  it("las filas cerradas traen nivel, disparo, deslizamiento y comisión; las anteriores, con el disparo en NULL", async () => {
    const t = new Date("2026-11-06T12:00:00Z");
    const nuevo = await sembrarCierre(e.pool, { n: 4, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93, evaluacion: true, disparo: { precio: 97_990, ts: t } });
    const viejo = await sembrarCierre(e.pool, { n: 5, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93, evaluacion: true });
    expect(await fila(nuevo.propuestaId)).toMatchObject({ nivel_cierre: "stop_loss", deslizamiento_usd: "-2.49", deslizamiento_pct: "-0.005102", comision_usd: "-2.46" });
    expect(Number((await fila(nuevo.propuestaId)).precio_disparo)).toBe(97_990);
    expect(await fila(viejo.propuestaId)).toMatchObject({ nivel_cierre: "stop_loss", precio_disparo: null, deslizamiento_usd: "-2.49", comision_usd: "-2.46" });
  });
});
