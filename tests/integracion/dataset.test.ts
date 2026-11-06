import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leerActivo } from "@/procesos/dataset";
import { filasDataset, type FilaDataset } from "@/server/dataset";
import { sembrar } from "../../scripts/sembrar";
import { abrirPool, vaciarBase } from "./arnes";

// AC-20 y AC-29: la extracción da una fila por evaluación, sin llamadas externas ni cambios en los registros,
// y filtrada por activo solo trae ese activo.

const TABLAS = ["ejecuciones", "evaluaciones", "propuestas", "ordenes", "eventos_orden", "lotes", "cierres_lote", "investigaciones", "eventos"];

let pool: Pool;
async function conteos() {
  const r: Record<string, number> = {};
  for (const t of TABLAS) r[t] = (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  return r;
}
async function todo(f: { activo?: "BTC/USD" | "SOL/USD" } = {}) {
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
      expect((f.foto as { version: string }).version).toBe("foto-v1");
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
});
