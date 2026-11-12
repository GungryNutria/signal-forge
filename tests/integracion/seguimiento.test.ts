import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ejecutarSeguimiento } from "@/procesos/seguimiento";
import { abrirPool, reiniciarBase, vaciarBase } from "./arnes";
import {
  FUENTE_DECISOR,
  sembrarContexto,
  sembrarDecision,
  sembrarModo,
  sembrarMuestras,
  sembrarSenal,
} from "./ayudas-seguimiento";

// AC-16 (integración), AC-21 y AC-30 (cierre de ranuras) y RNF-7 (candado propio): el proceso `seguimiento`.
let pool: Pool;
const q = async (texto: string, valores: unknown[] = []) => (await pool.query(texto, valores)).rows;
const T = (hhmm: string, dia = "2026-11-12") => new Date(`${dia}T${hhmm}:00Z`);

const correr = (ahora: Date, decisor: "ejecuta" | "solo_registra" | "apagado" = "solo_registra") =>
  ejecutarSeguimiento({ pool, ahora: () => ahora, log: () => {}, fuente: FUENTE_DECISOR(decisor) });

beforeAll(async () => {
  await reiniciarBase();
  pool = abrirPool(4);
});
beforeEach(vaciarBase);
afterAll(() => pool.end());

/** Huella de lo que `seguimiento` nunca debe tocar (RNF-6). */
const registros = async () =>
  (
    await q(`SELECT 'e' AS t, md5(string_agg(row_to_json(x)::text, ',' ORDER BY x.id)) AS h FROM evaluaciones x
             UNION ALL SELECT 'd', md5(string_agg(row_to_json(x)::text, ',' ORDER BY x.id)) FROM decisiones x
             UNION ALL SELECT 'c', md5(string_agg(row_to_json(x)::text, ',' ORDER BY x.id)) FROM contextos_decisor x
             UNION ALL SELECT 'm', md5(string_agg(row_to_json(x)::text, ',' ORDER BY x.id)) FROM muestras_precio x`)
  ).map((r) => `${r.t}:${r.h}`);

describe("resultados hipotéticos (AC-16)", () => {
  it("con más pendientes que un lote, los más nuevos también se resuelven en la misma corrida", async () => {
    // 210 señales viejas de SOL sin muestras (siguen pendientes) y 30 más nuevas de BTC que sí tocan el take profit.
    for (let i = 0; i < 210; i++) await sembrarSenal(pool, { activo: "SOL/USD", t0: new Date(T("08:00").getTime() + i * 10_000), ask: 200 });
    for (let i = 0; i < 30; i++) await sembrarSenal(pool, { activo: "BTC/USD", t0: new Date(T("12:00").getTime() + i * 10_000), ask: 100_000 });
    await sembrarMuestras(pool, "BTC/USD", T("12:10"), [100_000, 104_000]);

    expect(await correr(T("14:00"))).toMatchObject({ estado: "completada", hipoteticos: 30 });
    expect(await q("SELECT resultado, count(*)::int AS n FROM resultados_hipoteticos GROUP BY resultado")).toEqual([{ resultado: "take_profit", n: 30 }]);
    expect(await correr(T("14:10"))).toMatchObject({ hipoteticos: 0 }); // nada se resuelve dos veces
  });

  it("resuelve señales registradas y entradas evitadas con muestras sembradas, deja pendiente lo que no toca un nivel y no cambia ningún registro", async () => {
    const a = await sembrarSenal(pool, { activo: "BTC/USD", t0: T("12:00"), ask: 100_000 });
    const b = await sembrarSenal(pool, { activo: "SOL/USD", t0: T("12:00"), ask: 200 });
    const c = await sembrarSenal(pool, { activo: "BTC/USD", t0: T("12:30"), ask: 100_000 });
    await sembrarSenal(pool, { activo: "BTC/USD", t0: T("12:00"), ask: 100_000, resultado: "sin_senal" });
    const ctx = await sembrarContexto(pool, T("12:00"));
    const d = await sembrarDecision(pool, { ranura: T("11:45"), activo: "SOL/USD", decision: "no_comprar", contextoId: ctx });
    const ctxSin = await sembrarContexto(pool, T("12:00"), { "BTC/USD": { ask: null, datos: "no_disponibles" } });
    const e = await sembrarDecision(pool, { ranura: T("11:45"), activo: "BTC/USD", decision: "no_comprar", contextoId: ctxSin });
    await sembrarDecision(pool, { ranura: T("12:45"), activo: "BTC/USD", decision: "comprar" }); // no es entrada evitada
    // BTC: sube al take profit (104 000) a los 6 min. SOL: dos muestras, un hueco de 8 min y toca el stop (196).
    await sembrarMuestras(pool, "BTC/USD", T("12:01"), [100_000, 100_500, 101_000, 102_000, 103_000, 104_000]);
    await sembrarMuestras(pool, "SOL/USD", T("12:01"), [199, 199]);
    await sembrarMuestras(pool, "SOL/USD", T("12:10"), [195]);

    const antes = await registros();
    const r = await correr(T("14:00"));
    expect(r).toMatchObject({ estado: "completada", hipoteticos: 4 });
    expect(await registros()).toEqual(antes);

    const hip = async (col: string, id: string) => (await q(`SELECT * FROM resultados_hipoteticos WHERE ${col} = $1`, [id]))[0];
    expect(await hip("evaluacion_id", a)).toMatchObject({
      origen: "senal_registrada", resultado: "take_profit", pnl_a_nivel_usd: "17.40", pnl_a_nivel_pct: "0.034800",
      etiqueta_exito: 1, comision_bps: 25, version: "hipotetico-v1", huecos: [],
    });
    expect(Number((await hip("evaluacion_id", a)).precio_entrada)).toBe(100_000);
    expect((await hip("evaluacion_id", a)).tocado_en).toEqual(T("12:06"));
    expect(await hip("evaluacion_id", b)).toMatchObject({
      resultado: "stop_loss", pnl_a_nivel_usd: "-12.45", pnl_a_nivel_pct: "-0.024900", etiqueta_exito: 0,
      huecos: [{ desde: T("12:02").toISOString(), hasta: T("12:10").toISOString() }],
    });
    expect(await hip("decision_id", d)).toMatchObject({ origen: "entrada_evitada", resultado: "stop_loss", pnl_a_nivel_usd: "-12.45" });
    expect(await hip("decision_id", e)).toMatchObject({
      origen: "entrada_evitada", resultado: "sin_precio_entrada", precio_entrada: null, pnl_a_nivel_usd: null, etiqueta_exito: null,
    });
    expect(await hip("evaluacion_id", c)).toBeUndefined(); // pendiente: sin fila

    // Otra vuelta no repite nada; cuando llegan muestras que tocan el stop, se resuelve la pendiente y las demás no cambian.
    expect(await correr(T("14:05"))).toMatchObject({ hipoteticos: 0 });
    await sembrarMuestras(pool, "BTC/USD", T("12:31"), [99_000, 97_900]);
    expect(await correr(T("14:10"))).toMatchObject({ hipoteticos: 1 });
    expect(await hip("evaluacion_id", c)).toMatchObject({ resultado: "stop_loss", etiqueta_exito: 0 });
    expect((await q("SELECT count(*)::int AS n FROM resultados_hipoteticos"))[0].n).toBe(5);
  });

  it("no usa muestras posteriores a su reloj ni anteriores a la entrada", async () => {
    const a = await sembrarSenal(pool, { t0: T("12:00"), ask: 100_000 });
    await sembrarMuestras(pool, "BTC/USD", T("11:50"), [90_000]); // antes de t0: no cuenta
    await sembrarMuestras(pool, "BTC/USD", T("12:01"), [100_100]);
    await sembrarMuestras(pool, "BTC/USD", T("13:00"), [97_000]); // después de `ahora`
    expect(await correr(T("12:30"))).toMatchObject({ hipoteticos: 0 });
    expect(await q("SELECT 1 FROM resultados_hipoteticos WHERE evaluacion_id = $1", [a])).toHaveLength(0);
    expect(await correr(T("13:30"))).toMatchObject({ hipoteticos: 1 });
  });

  it("el candado propio: con otra instancia en curso omite la vuelta sin tocar nada", async () => {
    await sembrarSenal(pool, { t0: T("12:00"), ask: 100_000 });
    await sembrarMuestras(pool, "BTC/USD", T("12:01"), [97_000]);
    const otra = await pool.connect();
    try {
      await otra.query("SELECT pg_advisory_lock(hashtext('sf:seguimiento'))");
      expect(await correr(T("14:00"))).toEqual({ estado: "omitida_solapamiento", ranuras: 0, hipoteticos: 0 });
      expect(await q("SELECT 1 FROM resultados_hipoteticos")).toHaveLength(0);
    } finally {
      await otra.query("SELECT pg_advisory_unlock_all()");
      otra.release();
    }
    expect(await correr(T("14:00"))).toMatchObject({ estado: "completada", hipoteticos: 1 });
  });
});

describe("cierre de ranuras (AC-21, AC-30)", () => {
  /**
   * Ranuras de [HH:45, HH+1:45). Activación a las 08:00. El decisor se apaga a las 10:50 y vuelve a las 11:50.
   *   07:45 completa (BTC comprar rechazada por datos no disponibles + SOL no_comprar, las dos válidas, AC-30)
   *   08:45 parcial | 09:45 inválida (dos contexto vencido) | 10:45 apagado | 11:45 sin llegar | 12:45 en curso a las 13:10
   */
  async function sembrarCaso() {
    await sembrarModo(pool, T("08:00"), "solo_registra");
    await sembrarDecision(pool, { ranura: T("07:45"), activo: "BTC/USD", decision: "comprar", valida: true, motivo: "datos_no_disponibles", recibidaEn: T("08:05") });
    await sembrarDecision(pool, { ranura: T("07:45"), activo: "SOL/USD", decision: "no_comprar", recibidaEn: T("08:06") });
    await sembrarDecision(pool, { ranura: T("08:45"), activo: "BTC/USD", decision: "comprar", recibidaEn: T("08:50") });
    await sembrarDecision(pool, { ranura: T("09:45"), activo: "BTC/USD", valida: false, motivo: "contexto_vencido", recibidaEn: T("09:50") });
    await sembrarDecision(pool, { ranura: T("09:45"), activo: "SOL/USD", valida: false, motivo: "contexto_vencido", recibidaEn: T("09:51") });
    await sembrarModo(pool, T("10:50"), "apagado");
    await sembrarModo(pool, T("11:50"), "solo_registra");
    await sembrarDecision(pool, { ranura: T("12:45"), activo: "BTC/USD", decision: "no_comprar", recibidaEn: T("12:50") });
  }
  const ranuras = async () => q("SELECT ranura, estado, detalle FROM ranuras_decisor ORDER BY ranura");

  it("cierra los cuatro casos más el apagado, y no la ranura en curso", async () => {
    await sembrarCaso();
    const r = await correr(T("13:10"));
    expect(r).toMatchObject({ estado: "completada", ranuras: 5 });
    expect((await ranuras()).map((x) => [x.ranura.toISOString(), x.estado])).toEqual([
      [T("07:45").toISOString(), "completa"],
      [T("08:45").toISOString(), "parcial"],
      [T("09:45").toISOString(), "invalida"],
      [T("10:45").toISOString(), "apagado"],
      [T("11:45").toISOString(), "sin_llegar"],
    ]);
    const [completa, parcial, invalida] = await ranuras();
    expect(Object.values(completa.detalle).every((v) => typeof v === "string")).toBe(true);
    expect(parcial.detalle).toMatchObject({ "BTC/USD": expect.any(String), "SOL/USD": null });
    expect(invalida.detalle).toEqual({ "BTC/USD": null, "SOL/USD": null });
  });

  it("una ranura terminada se cierra una sola vez y la en curso se cierra al terminar", async () => {
    await sembrarCaso();
    await correr(T("13:10"));
    expect(await correr(T("13:20"))).toMatchObject({ ranuras: 0 });
    // A las 13:50 ya terminó la 12:45: tiene una válida de BTC, así que queda parcial.
    expect(await correr(T("13:50"))).toMatchObject({ ranuras: 1 });
    const ultima = (await ranuras()).at(-1);
    expect([ultima.ranura.toISOString(), ultima.estado]).toEqual([T("12:45").toISOString(), "parcial"]);
    expect((await q("SELECT count(*)::int AS n FROM ranuras_decisor"))[0].n).toBe(6);
  });

  it("recupera las ranuras que no se cerraron mientras el proceso estuvo detenido", async () => {
    await sembrarModo(pool, T("08:00"), "solo_registra");
    expect(await correr(T("11:00"))).toMatchObject({ ranuras: 3 }); // 07:45, 08:45 y 09:45; la de las 10:45 sigue en curso
    expect((await ranuras()).map((x) => x.estado)).toEqual(["sin_llegar", "sin_llegar", "sin_llegar"]);
  });

  it("sin activación del decisor (siempre apagado) no cierra ninguna", async () => {
    expect(await correr(T("13:10"), "apagado")).toMatchObject({ ranuras: 0 });
    expect(await ranuras()).toHaveLength(0);
  });

  it("ejecutar el proceso registra los modos (REQ-33) y con una variable inválida sigue con ranuras e hipotéticos", async () => {
    await sembrarModo(pool, T("08:00"), "solo_registra");
    await sembrarSenal(pool, { t0: T("12:00"), ask: 100_000 });
    await sembrarMuestras(pool, "BTC/USD", T("12:01"), [97_000]);
    const r = await ejecutarSeguimiento({ pool, ahora: () => T("13:10"), log: () => {}, fuente: { MODO_DECISOR: "invalido" } });
    expect(r).toMatchObject({ estado: "completada", ranuras: 5, hipoteticos: 1 });
    expect(await q("SELECT 1 FROM eventos WHERE tipo = 'modo_proponentes'")).toHaveLength(1); // solo el sembrado
    await correr(T("13:15"), "apagado");
    expect(await q("SELECT 1 FROM eventos WHERE tipo = 'modo_proponentes'")).toHaveLength(2);
  });
});
