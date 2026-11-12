import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ejecutarSeguimiento } from "@/procesos/seguimiento";
import { ejecutarVigilante } from "@/procesos/vigilante";
import { DatosSimulados } from "@/server/broker/simulado";
import { abrirPool, reiniciarBase } from "./arnes";
import { AHORA } from "./ayudas";
import { contexto, crearEntornoDecisor, decisionValida, enviarDecision, pedirContexto, sembrarLoteAbierto, type EntornoDecisor } from "./ayudas-decisor";
import { sembrarMuestras, sembrarSenal } from "./ayudas-seguimiento";

// AC-26 (RNF-7): las peticiones del decisor y el cálculo de resultados hipotéticos no retrasan ni bloquean al vigilante.
let e: EntornoDecisor;
// El vigilante y el seguimiento tienen cada uno su pool, como procesos aparte en producción.
let pool: Pool;
let poolSeguimiento: Pool;
const MIN = 60_000;

beforeAll(async () => {
  await reiniciarBase();
  e = crearEntornoDecisor({ MODO_CICLO: "solo_registra", MODO_DECISOR: "ejecuta", MAX_ENTRADAS_ABIERTAS_POR_ACTIVO: "5" });
  pool = abrirPool(3);
  poolSeguimiento = abrirPool(3);
});
afterAll(async () => {
  await e?.pool.end();
  await pool?.end();
  await poolSeguimiento?.end();
});

describe("AC-26: el vigilante cierra a tiempo con el decisor y el seguimiento trabajando", () => {
  it("50 peticiones del decisor en paralelo y un seguimiento con trabajo pendiente mientras un lote toca su stop", async () => {
    // Un lote de BTC/USD abierto con stop en 98 000 y el mercado en 97 900.
    const { loteId } = await sembrarLoteAbierto(e.pool, { abiertoEn: new Date(AHORA.getTime() - 60 * MIN) });
    const datos = new DatosSimulados();
    const quote = (bid: number) => ({ bid, ask: bid + 1, ultimo: bid, tsQuote: AHORA, tsTrade: AHORA });
    datos.instantaneas = { "BTC/USD": quote(97_900), "SOL/USD": quote(200) };
    e.broker.precios = { "BTC/USD": 97_900, "SOL/USD": 200 };

    // Trabajo para el seguimiento: 150 señales registradas de BTC/USD que el último minuto de muestras manda al stop.
    for (let i = 0; i < 150; i++) await sembrarSenal(pool, { t0: new Date(AHORA.getTime() - (200 + i) * MIN), ask: 100_000 });
    await sembrarMuestras(pool, "BTC/USD", new Date(AHORA.getTime() - 6 * 60 * MIN), [...Array(359).fill(100_000), 97_000]);

    const ctx = await contexto(e);
    const peticiones = Array.from({ length: 50 }, (_, i) =>
      i % 5 === 0
        ? pedirContexto(e)
        : enviarDecision(e, decisionValida(ctx.id, { activo: i % 2 ? "SOL/USD" : "BTC/USD", decision: i % 3 ? "no_comprar" : "comprar" })),
    );
    const inicio = Date.now();
    const [vigilante, seguimiento, respuestas] = await Promise.all([
      ejecutarVigilante({
        pool, broker: e.broker, datos, ahora: () => AHORA, env: { APCA_API_BASE_URL: "https://paper-api.alpaca.markets" }, log: () => {},
      }),
      ejecutarSeguimiento({ pool: poolSeguimiento, ahora: () => AHORA, log: () => {}, fuente: { MODO_DECISOR: "ejecuta", MODO_CICLO: "solo_registra" } }),
      Promise.all(peticiones),
    ]);
    const duracion = Date.now() - inicio;

    // El vigilante terminó dentro de su plazo de 45 s, sin error, y cerró el lote en su stop.
    expect(vigilante).toMatchObject({ estado: "completada", cierres: 1 });
    expect(duracion).toBeLessThan(45_000);
    expect((await e.pool.query("SELECT motivo_cierre FROM cierres_lote WHERE lote_id = $1", [loteId])).rows).toEqual([{ motivo_cierre: "stop_loss" }]);
    expect(seguimiento.estado).toBe("completada");
    expect(seguimiento.hipoteticos).toBe(150);

    // RNF-5 es exacto bajo carrera: con el contexto previo, se guardan justo 30 en total y las otras 21 de las 50 reciben 429; la siguiente, también.
    const estados = await Promise.all(respuestas.map((r) => r.status));
    expect(estados.every((s) => [200, 201, 409, 422, 429].includes(s))).toBe(true);
    expect(estados.filter((s) => s === 429)).toHaveLength(21);
    const guardadas = (await e.pool.query("SELECT (SELECT count(*) FROM decisiones)::int + (SELECT count(*) FROM contextos_decisor)::int AS n")).rows[0].n;
    expect(guardadas).toBe(30);
    expect((await pedirContexto(e)).status).toBe(429);
  }, 60_000);
});
