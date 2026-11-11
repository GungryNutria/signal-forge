import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirPool } from "./arnes";
import { reglasCumplen, sembrarCierre } from "./ayudas";

// AC-11 y AC-14 (RNF-3): migrar a la spec 003 no cambia ningún registro anterior ni las columnas viejas de v_dataset.
let pool: Pool;
const TABLAS = ["ejecuciones", "ejecuciones_cierre", "evaluaciones", "propuestas", "ordenes", "eventos_orden", "lotes", "cierres_lote", "eventos"];

async function aplicar(archivo: string) {
  for (const s of readFileSync(`drizzle/${archivo}`, "utf8").split("--> statement-breakpoint")) await pool.query(s);
}
const registros = async (ignorar: string[] = []) =>
  Object.fromEntries(
    await Promise.all(
      TABLAS.map(async (t) => {
        const { rows } = await pool.query(`SELECT to_jsonb(x) AS f FROM ${t} x ORDER BY to_jsonb(x)::text`);
        return [t, rows.map((r) => Object.fromEntries(Object.entries(r.f as object).filter(([k]) => !ignorar.includes(k))))];
      }),
    ),
  );

beforeAll(async () => {
  pool = abrirPool(2);
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("CREATE SCHEMA public");
});
afterAll(() => pool.end());

describe("migraciones 0002 y 0003 sobre datos anteriores", () => {
  it("conservan todos los registros, agregan columnas nulas y dejan igual las columnas viejas de v_dataset", async () => {
    await aplicar("0000_exotic_leader.sql");
    await aplicar("0001_append_only_y_vistas.sql");
    // Esquema anterior: un cierre ya existente y una propuesta rechazada con las diez reglas de entonces.
    await sembrarCierre(pool, { n: 1, motivo: "stop_loss", precioSalida: 97_500, pnlNetoUsd: -14.93, evaluacion: true, reglas: reglasCumplen(10) });
    const antes = await registros();
    const datasetAntes = (await pool.query("SELECT * FROM v_dataset")).rows;
    expect(datasetAntes).toHaveLength(1);

    await aplicar("0002_large_captain_flint.sql");
    await aplicar("0003_v_cierres_y_dataset_003.sql");

    expect(await registros(["precio_disparo", "precio_disparo_ts"])).toEqual(antes);
    for (const o of (await pool.query("SELECT precio_disparo, precio_disparo_ts FROM ordenes")).rows)
      expect(o).toEqual({ precio_disparo: null, precio_disparo_ts: null });

    const [despues] = (await pool.query("SELECT * FROM v_dataset")).rows;
    const { reglas_aplicadas, r11, nivel_cierre, precio_disparo, deslizamiento_usd, deslizamiento_pct, comision_usd, ...viejas } = despues;
    expect(viejas).toEqual(datasetAntes[0]);
    expect({ reglas_aplicadas, r11, nivel_cierre, precio_disparo, deslizamiento_usd, deslizamiento_pct, comision_usd }).toEqual({
      reglas_aplicadas: "R1-R10", r11: "no_evaluada", nivel_cierre: "stop_loss", precio_disparo: null,
      deslizamiento_usd: "-2.49", deslizamiento_pct: "-0.005102", comision_usd: "-2.46",
    });
  });

  it("las columnas nuevas de ordenes siguen siendo de solo inserción", async () => {
    await expect(pool.query("UPDATE ordenes SET precio_disparo = 1")).rejects.toThrow(/sf_prohibir_cambios/);
  });
});
