import { afterAll, describe, expect, it } from "vitest";
import { ejecutarCiclo } from "@/procesos/ciclo";
import { DatosSimulados } from "@/server/broker/simulado";
import { procesarPropuesta } from "@/server/propuestas/procesar";
import { reiniciarBase } from "./arnes";
import { AHORA, compra, crearEntorno } from "./ayudas";

// AC-13: la misma clave en paralelo produce una sola orden. Además, el candado global hace consistente R4
// entre decisiones simultáneas.
const e = crearEntorno();
afterAll(() => e.pool.end());

describe("concurrencia de procesarPropuesta", () => {
  it("10 propuestas simultáneas con la misma clave: 1 orden, 1 original, 9 repetidas (AC-13)", async () => {
    const p = compra();
    const rs = await Promise.all(Array.from({ length: 10 }, () => procesarPropuesta(p, e.ctx)));
    expect(e.broker.llamadas.filter((l) => l.metodo === "enviarOrden")).toHaveLength(1);
    expect(e.broker.registradas).toHaveLength(1);
    expect(new Set(rs.map((r) => r.propuestaId)).size).toBe(1);
    expect(rs.filter((r) => !r.repetida)).toHaveLength(1);
    const { rows } = await e.pool.query("SELECT count(*)::int AS n FROM propuestas WHERE clave_idempotencia = $1", [
      p.clave_idempotencia,
    ]);
    expect(rows[0].n).toBe(1);
    const ords = await e.pool.query("SELECT count(*)::int AS n FROM ordenes");
    expect(ords.rows[0].n).toBe(1);
  });

  it("10 compras distintas de 1000 USD a la vez: R4 deja pasar exactamente 5 (4 de ellas sobre el saldo ya usado)", async () => {
    const { rows: previas } = await e.pool.query("SELECT count(*)::int AS n FROM lotes");
    const lotesPrevios = previas[0].n; // la prueba anterior dejó un lote de 500 USD
    expect(lotesPrevios).toBe(1);
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => procesarPropuesta(compra({ nocional_usd: 1000 }), e.ctx)),
    );
    // Exposición previa: 500. Caben 4 de 1000 (4500 <= 5000); la quinta daría 5500.
    expect(rs.filter((r) => r.decision === "ejecutada")).toHaveLength(4);
    expect(rs.filter((r) => r.decision === "rechazada")).toHaveLength(6);
    const { rows } = await e.pool.query("SELECT COALESCE(SUM(nocional_entrada_usd),0)::text AS t FROM lotes");
    expect(Number(rows[0].t)).toBe(4500);
  });
});

describe("concurrencia de R11 (AC-12)", () => {
  it("10 compras de BTC a la vez con claves y ejecuciones distintas, N = 1 y sin abiertas: una ejecutada y una orden", async () => {
    await reiniciarBase();
    const c = crearEntorno({}, 1);
    try {
      const rs = await Promise.all(Array.from({ length: 10 }, () => procesarPropuesta(compra(), c.ctx)));
      expect(rs.filter((r) => r.decision === "ejecutada")).toHaveLength(1);
      const rechazadas = rs.filter((r) => r.decision === "rechazada");
      expect(rechazadas).toHaveLength(9);
      for (const r of rechazadas) expect(r.reglas?.filter((x) => !x.cumple).map((x) => x.regla)).toEqual(["R11"]);
      expect((await c.pool.query("SELECT 1 FROM ordenes")).rowCount).toBe(1);
      expect(c.broker.registradas).toHaveLength(1);
    } finally {
      await c.pool.end();
    }
  });
});

describe("concurrencia del ciclo", () => {
  it("dos ejecutarCiclo simultáneos: uno evalúa y el otro queda omitida_solapamiento, sin propuestas duplicadas (AC-30)", async () => {
    await reiniciarBase();
    const c = crearEntorno();
    try {
      const datos = new DatosSimulados();
      const barras = Array.from({ length: 52 }, (_, i) => {
        const cl = 100 + i;
        return { t: new Date(AHORA.getTime() - (52 - i) * 30 * 60_000).toISOString(), o: cl, h: cl, l: cl, c: cl, v: 1 };
      });
      datos.barras = { "BTC/USD": barras, "SOL/USD": barras };
      const quote = { bid: 150, ask: 152, ultimo: 151, tsQuote: new Date(AHORA.getTime() - 5000), tsTrade: new Date(AHORA.getTime() - 5000) };
      datos.instantaneas = { "BTC/USD": quote, "SOL/USD": quote };
      c.broker.precios = { "BTC/USD": 151, "SOL/USD": 151 };
      const lento = datos.barras30m.bind(datos);
      datos.barras30m = async (...a) => {
        await new Promise((r) => setTimeout(r, 400)); // el ciclo que gana el candado lo conserva mientras lee
        return lento(...a);
      };
      const deps = { pool: c.pool, broker: c.broker, datos, ahora: c.ctx.ahora, env: c.ctx.env, esperar: async () => {}, log: () => {} };
      const rs = await Promise.all([ejecutarCiclo(deps), ejecutarCiclo(deps)]);
      expect(rs.map((r) => r.estado).sort()).toEqual(["completada", "omitida_solapamiento"]);
      const cierres = await c.pool.query("SELECT estado FROM ejecuciones_cierre ORDER BY estado");
      expect(cierres.rows.map((r) => r.estado)).toEqual(["completada", "omitida_solapamiento"]);
      const omitida = rs.find((r) => r.estado === "omitida_solapamiento")!;
      expect((await c.pool.query("SELECT 1 FROM evaluaciones WHERE ejecucion_id = $1", [omitida.ejecucionId])).rowCount).toBe(0);
      expect((await c.pool.query("SELECT 1 FROM propuestas WHERE es_original")).rowCount).toBe(2);
      expect(c.broker.registradas).toHaveLength(2);
    } finally {
      await c.pool.end();
    }
  });
});
