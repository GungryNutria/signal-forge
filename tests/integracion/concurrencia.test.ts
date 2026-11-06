import { afterAll, describe, expect, it } from "vitest";
import { procesarPropuesta } from "@/server/propuestas/procesar";
import { compra, crearEntorno } from "./ayudas";

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
