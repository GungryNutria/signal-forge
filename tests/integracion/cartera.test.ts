import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entradasAbiertasPorActivo } from "@/server/cartera";
import { procesarPropuesta } from "@/server/propuestas/procesar";
import { reiniciarBase } from "./arnes";
import { compra, crearEntorno } from "./ayudas";

// AC-4 (REQ-2): qué cuenta como entrada abierta, caso por caso, con la cartera armada por el camino común.
let e: ReturnType<typeof crearEntorno>;
const q = async (texto: string, valores: unknown[] = []) => (await e.pool.query(texto, valores)).rows;

beforeAll(async () => {
  await reiniciarBase();
  e = crearEntorno();
});
afterAll(() => (e?.pool as Pool | undefined)?.end());

describe("entradasAbiertasPorActivo (AC-4)", () => {
  it("cuenta lotes abiertos y entradas vivas sin lote; no cuenta rechazos, canceladas ni cerradas", async () => {
    expect(await entradasAbiertasPorActivo(drizzle(e.pool))).toEqual({});

    // Cuentan: lote abierto, enviada sin llenar y parcial.
    await procesarPropuesta(compra(), e.ctx); // lote abierto
    e.broker.llenado = "ninguno";
    await procesarPropuesta(compra(), e.ctx); // enviada
    e.broker.llenado = "parcial";
    await procesarPropuesta(compra(), e.ctx); // parcial

    // No cuentan: rechazada por el riesgo (sin orden), rechazada por el broker, no_enviada y cancelada.
    e.broker.llenado = "total";
    const rechazada = await procesarPropuesta(compra({ tipo_orden: "limite" }), e.ctx);
    expect(rechazada.ordenId).toBeNull();
    e.broker.programarEnvio({ tipo: "rechazada", status: 403 });
    await procesarPropuesta(compra(), e.ctx);
    e.broker.llenado = "ninguno";
    const paraNoEnviada = await procesarPropuesta(compra(), e.ctx);
    const paraCancelada = await procesarPropuesta(compra(), e.ctx);
    expect(await entradasAbiertasPorActivo(drizzle(e.pool))).toEqual({ "BTC/USD": 5 });
    await q("INSERT INTO eventos_orden (orden_id, estado) VALUES ($1, 'no_enviada'), ($2, 'cancelada')", [
      paraNoEnviada.ordenId,
      paraCancelada.ordenId,
    ]);
    expect(await entradasAbiertasPorActivo(drizzle(e.pool))).toEqual({ "BTC/USD": 3 });

    // La cuarta que cuenta: una desconocida (va al final porque R9 bloquea al activo).
    e.broker.llenado = "total";
    e.broker.programarEnvio({ tipo: "5xx", llega: false });
    await procesarPropuesta(compra(), e.ctx);
    expect(await entradasAbiertasPorActivo(drizzle(e.pool))).toEqual({ "BTC/USD": 4 });

    // Un lote cerrado deja de contar.
    const [lote] = await q("SELECT id, activo FROM lotes");
    const [salida] = await q(
      `INSERT INTO ordenes (lote_id, tramo, client_order_id, activo, lado, cantidad)
       VALUES ($1, 'salida', 'sf-x-test-1', 'BTC/USD', 'sell', 0.0049875) RETURNING id`,
      [lote.id],
    );
    await q(
      `INSERT INTO cierres_lote (lote_id, orden_salida_id, precio_salida, motivo_cierre, pnl_neto_usd, pnl_neto_pct, duracion_s, etiqueta_exito)
       VALUES ($1, $2, 98000, 'stop_loss', -12.45, -0.0249, 0, 0)`,
      [lote.id, salida.id],
    );
    expect(await entradasAbiertasPorActivo(drizzle(e.pool))).toEqual({ "BTC/USD": 3 });
  });

  it("es por activo y no mira quién propuso (REQ-21)", async () => {
    await reiniciarBase();
    await e.pool.end();
    e = crearEntorno();
    await procesarPropuesta(compra({ activo: "SOL/USD", nocional_usd: 100 }), e.ctx);
    await procesarPropuesta(compra({ proponente: "decisor-simulado" }), e.ctx);
    await procesarPropuesta(compra({ proponente: "ciclo" }), e.ctx);
    expect(await entradasAbiertasPorActivo(drizzle(e.pool))).toEqual({ "BTC/USD": 2, "SOL/USD": 1 });
  });
});
