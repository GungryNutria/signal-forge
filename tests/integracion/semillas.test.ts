import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESCENARIOS, sembrar } from "../../scripts/sembrar";
import { abrirPool, vaciarBase } from "./arnes";

// T-10: cada escenario carga sin error sobre una base vacía, y la siembra se niega en producción.

const ESPERADOS = [
  "vacio",
  "solo-ejecuciones-sin-senal",
  "ejecutada-y-rechazada",
  "casos-ac9",
  "ejecuciones-por-caso",
  "pausa-auto",
  "pausa-manual",
  "ciclo-detenido-46",
  "ciclo-44",
  "orden-desconocida",
  "broker-caido",
  "investigacion-59-61",
  "investigacion-sol-121-btc-30",
  "investigacion-119",
  "metricas-conocidas",
  "valores-extremos",
  "inyeccion",
];

let pool: Pool;
beforeAll(() => {
  pool = abrirPool(3);
  process.env.APP_ENV = "test";
});
afterAll(() => pool.end());

describe("escenarios de siembra", () => {
  it("están todos los que pide la tarea", () => {
    for (const e of ESPERADOS) expect(Object.keys(ESCENARIOS)).toContain(e);
  });

  it.each(Object.keys(ESCENARIOS))("%s carga sobre una base vacía", async (nombre) => {
    await vaciarBase();
    await sembrar(pool, nombre);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM ejecuciones");
    if (nombre === "vacio") expect(rows[0].n).toBe(0);
    else expect(rows[0].n).toBeGreaterThan(0);
  });

  it("se niega con APP_ENV=produccion o sin APP_ENV y no escribe nada", async () => {
    await vaciarBase();
    for (const entorno of ["produccion", undefined]) {
      if (entorno === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = entorno;
      await expect(sembrar(pool, "metricas-conocidas")).rejects.toThrow(/se niega/);
    }
    process.env.APP_ENV = "test";
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM ejecuciones");
    expect(rows[0].n).toBe(0);
  });

  it("rechaza un escenario desconocido", async () => {
    await expect(sembrar(pool, "no-existe")).rejects.toThrow(/desconocido/);
  });
});
