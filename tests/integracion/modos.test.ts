import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolverModos, type Modo } from "@/core/modos";
import { activacionDecisor, registrarModos } from "@/server/modos";
import { abrirPool, reiniciarBase } from "./arnes";

// AC-29 (REQ-33): el registro de modos con reloj simulado.
let pool: Pool;
const db = () => drizzle(pool);
const q = async (texto: string, valores: unknown[] = []) => (await pool.query(texto, valores)).rows;
const t = (min: number) => new Date(Date.UTC(2026, 10, 10, 12, min));
const modos = (ciclo: Modo, decisor: Modo, r11 = true) => resolverModos({ ciclo, decisor }, r11);

beforeAll(async () => {
  await reiniciarBase();
  pool = abrirPool(5);
});
afterAll(() => pool?.end());

describe("registrarModos y activacionDecisor (AC-29)", () => {
  it("registra solo los cambios, no una fila por llamada; la activación es el primer decisor distinto de apagado", async () => {
    expect(await activacionDecisor(db())).toBeNull();
    await registrarModos(db(), modos("ejecuta", "apagado"), t(0));
    await registrarModos(db(), modos("ejecuta", "apagado"), t(1)); // igual: no inserta
    expect(await q("SELECT 1 FROM eventos WHERE tipo = 'modo_proponentes'")).toHaveLength(1);
    expect(await activacionDecisor(db())).toBeNull();

    await registrarModos(db(), modos("solo_registra", "ejecuta"), t(10));
    await registrarModos(db(), modos("solo_registra", "ejecuta"), t(11));
    expect((await activacionDecisor(db()))?.toISOString()).toBe(t(10).toISOString());

    await registrarModos(db(), modos("solo_registra", "apagado"), t(20));
    await registrarModos(db(), modos("solo_registra", "ejecuta"), t(30));
    const evs = await q("SELECT momento, detalle FROM eventos WHERE tipo = 'modo_proponentes' ORDER BY id");
    expect(evs).toHaveLength(4);
    expect(evs[1].detalle.decisor).toEqual({ configurado: "ejecuta", efectivo: "ejecuta", motivo: null });
    expect(evs[2].detalle.decisor.efectivo).toBe("apagado");
    // La activación sigue siendo la primera, aunque el decisor se apague y vuelva a encender.
    expect((await activacionDecisor(db()))?.toISOString()).toBe(t(10).toISOString());
  });

  it("con los dos en ejecuta el evento dice el motivo, y R11 sin vigor se registra", async () => {
    await registrarModos(db(), modos("ejecuta", "ejecuta"), t(40));
    await registrarModos(db(), modos("solo_registra", "ejecuta", false), t(50));
    const evs = await q("SELECT detalle FROM eventos WHERE tipo = 'modo_proponentes' ORDER BY id DESC LIMIT 2");
    expect(evs[0].detalle.decisor).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "r11_no_vigente" });
    expect(evs[1].detalle.ciclo).toEqual({ configurado: "ejecuta", efectivo: "solo_registra", motivo: "dos_proponentes_en_ejecuta" });
  });

  it("peticiones simultáneas con el mismo modo nuevo registran un solo evento", async () => {
    const antes = (await q("SELECT 1 FROM eventos WHERE tipo = 'modo_proponentes'")).length;
    await Promise.all(Array.from({ length: 8 }, () => registrarModos(db(), modos("apagado", "apagado"), t(55))));
    expect((await q("SELECT 1 FROM eventos WHERE tipo = 'modo_proponentes'")).length).toBe(antes + 1);
  });

  it("los eventos de modos no se pueden modificar ni borrar (append-only)", async () => {
    await expect(pool.query("UPDATE eventos SET detalle = '{}' WHERE tipo = 'modo_proponentes'")).rejects.toThrow();
    await expect(pool.query("DELETE FROM eventos WHERE tipo = 'modo_proponentes'")).rejects.toThrow();
  });

  it("la activación es el mínimo con la primera decisión recibida; una recibida con el decisor apagado no cuenta", async () => {
    const decision = (min: number, modo: string) =>
      pool.query(
        "INSERT INTO decisiones (recibida_en, ranura, estado, motivo, valida, es_original, modo_efectivo) VALUES ($1, $1, 'rechazada', 'x', false, false, $2)",
        [t(min), modo],
      );
    await decision(2, "apagado");
    expect((await activacionDecisor(db()))?.toISOString()).toBe(t(10).toISOString());
    await decision(5, "solo_registra");
    expect((await activacionDecisor(db()))?.toISOString()).toBe(t(5).toISOString());
  });
});
