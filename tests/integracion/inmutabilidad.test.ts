import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abrirPool } from "./arnes";

// AC-17 y AC-24 (parte): UPDATE, DELETE y TRUNCATE fallan en las 15 tablas de registro;
// lecturas_mercado (caché) admite upsert.

// Tabla -> una columna cualquiera para el UPDATE.
const TABLAS_DE_REGISTRO: Record<string, string> = {
  ejecuciones: "version_regla",
  ejecuciones_cierre: "estado",
  evaluaciones: "resultado",
  propuestas: "motivo",
  ordenes: "tramo",
  eventos_orden: "estado",
  lotes: "activo",
  cierres_lote: "motivo_cierre",
  investigaciones: "estado",
  eventos: "tipo",
  contextos_decisor: "version",
  decisiones: "estado",
  muestras_precio: "activo",
  resultados_hipoteticos: "resultado",
  ranuras_decisor: "estado",
};

const ID = {
  ejecucion: "00000000-0000-4000-8000-000000000001",
  investigacion: "00000000-0000-4000-8000-000000000002",
  evaluacion: "00000000-0000-4000-8000-000000000003",
  propuesta: "00000000-0000-4000-8000-000000000004",
  ordenEntrada: "00000000-0000-4000-8000-000000000005",
  lote: "00000000-0000-4000-8000-000000000006",
  ordenSalida: "00000000-0000-4000-8000-000000000007",
  contexto: "00000000-0000-4000-8000-000000000008",
};

async function sembrarUnaFilaPorTabla(pool: Pool) {
  const q = (texto: string, valores: unknown[] = []) => pool.query(texto, valores);
  await q(
    "INSERT INTO ejecuciones (id, ranura, version_regla) VALUES ($1, now(), 'tendencia-sma-v1')",
    [ID.ejecucion],
  );
  await q("INSERT INTO ejecuciones_cierre (ejecucion_id, estado) VALUES ($1, 'completada')", [
    ID.ejecucion,
  ]);
  await q(
    `INSERT INTO investigaciones (id, estado, clave_idempotencia, huella_contenido, ejecucion_investigador,
       version_instrucciones, activo, sentimiento, noticia_fuerte, confianza, resumen, fuentes)
     VALUES ($1, 'aceptada', 'inv:2026-11-06T18:BTC/USD', repeat('a', 64), '2026-11-06T18',
       'investigacion-v1', 'BTC/USD', 0.42, false, 0.8, 'Texto', ARRAY['https://example.com'])`,
    [ID.investigacion],
  );
  await q(
    `INSERT INTO evaluaciones (id, ejecucion_id, activo, resultado, version_regla, foto, investigacion_id)
     VALUES ($1, $2, 'BTC/USD', 'propuesta', 'tendencia-sma-v1', '{}', $3)`,
    [ID.evaluacion, ID.ejecucion, ID.investigacion],
  );
  await q(
    `INSERT INTO propuestas (id, clave_idempotencia, es_original, evaluacion_id, activo, entrada_cruda, decision, motivo)
     VALUES ($1, 'clave-1', true, $2, 'BTC/USD', '{}', 'ejecutada', 'aprobada')`,
    [ID.propuesta, ID.evaluacion],
  );
  await q(
    `INSERT INTO ordenes (id, propuesta_id, tramo, client_order_id, activo, lado, nocional_usd)
     VALUES ($1, $2, 'entrada', 'sf-e-1', 'BTC/USD', 'buy', 500)`,
    [ID.ordenEntrada, ID.propuesta],
  );
  await q("INSERT INTO eventos_orden (orden_id, estado) VALUES ($1, 'pendiente_envio')", [
    ID.ordenEntrada,
  ]);
  await q(
    `INSERT INTO lotes (id, propuesta_id, orden_entrada_id, activo, precio_entrada, cantidad_llenada,
       cantidad_neta, nocional_entrada_usd, comision_bps, stop_loss, take_profit)
     VALUES ($1, $2, $3, 'BTC/USD', 100, 5, 4.9875, 500, 25, 98, 104)`,
    [ID.lote, ID.propuesta, ID.ordenEntrada],
  );
  await q(
    `INSERT INTO ordenes (id, lote_id, tramo, client_order_id, activo, lado, cantidad)
     VALUES ($1, $2, 'salida', 'sf-x-1-1', 'BTC/USD', 'sell', 4.9875)`,
    [ID.ordenSalida, ID.lote],
  );
  await q(
    `INSERT INTO cierres_lote (lote_id, orden_salida_id, precio_salida, motivo_cierre, pnl_neto_usd,
       pnl_neto_pct, duracion_s, etiqueta_exito)
     VALUES ($1, $2, 104, 'take_profit', 17.4, 0.0348, 600, 1)`,
    [ID.lote, ID.ordenSalida],
  );
  await q("INSERT INTO eventos (tipo, detalle) VALUES ('error_ciclo', '{}')");
  await q(
    "INSERT INTO contextos_decisor (id, token_huella, version, contenido) VALUES ($1, repeat('a', 16), 'contexto-v1', '{}')",
    [ID.contexto],
  );
  await q(
    "INSERT INTO decisiones (ranura, estado, motivo, valida, es_original) VALUES (now(), 'rechazada', 'json_invalido', false, false)",
  );
  await q("INSERT INTO muestras_precio (activo, fuente_ts, bid, ask, leido_en) VALUES ('BTC/USD', now(), 100, 101, now())");
  await q(
    `INSERT INTO resultados_hipoteticos (origen, evaluacion_id, activo, t0, precio_entrada, nocional_usd, comision_bps, resultado, version)
     VALUES ('senal_registrada', $1, 'BTC/USD', now(), 100, 500, 25, 'sin_precio_entrada', 'hipotetico-v1')`,
    [ID.evaluacion],
  );
  await q("INSERT INTO ranuras_decisor (ranura, estado, detalle) VALUES (now(), 'sin_llegar', '{}')");
}

describe("inmutabilidad del registro (AC-17)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = abrirPool(1);
    await sembrarUnaFilaPorTabla(pool);
  });
  afterAll(() => pool.end());

  const contar = async (tabla: string) =>
    Number((await pool.query(`SELECT count(*) AS n FROM ${tabla}`)).rows[0].n);

  for (const [tabla, columna] of Object.entries(TABLAS_DE_REGISTRO)) {
    describe(tabla, () => {
      it("rechaza UPDATE", async () => {
        await expect(pool.query(`UPDATE ${tabla} SET ${columna} = ${columna}`)).rejects.toThrow(
          /sf_prohibir_cambios/,
        );
      });
      it("rechaza DELETE", async () => {
        await expect(pool.query(`DELETE FROM ${tabla}`)).rejects.toThrow(/sf_prohibir_cambios/);
      });
      it("rechaza TRUNCATE (también en cascada)", async () => {
        await expect(pool.query(`TRUNCATE ${tabla} CASCADE`)).rejects.toThrow(/sf_prohibir_cambios/);
      });
      it("conserva su fila", async () => {
        expect(await contar(tabla)).toBeGreaterThan(0);
      });
    });
  }

  it("lecturas_mercado admite upsert (caché que se reescribe)", async () => {
    const upsert = (ultimo: number) =>
      pool.query(
        `INSERT INTO lecturas_mercado (activo, bid, ask, ultimo, fuente_ts, leido_en)
         VALUES ('BTC/USD', $1, $1, $1, now(), now())
         ON CONFLICT (activo) DO UPDATE SET bid = EXCLUDED.bid, ask = EXCLUDED.ask,
           ultimo = EXCLUDED.ultimo, fuente_ts = EXCLUDED.fuente_ts, leido_en = EXCLUDED.leido_en`,
        [ultimo],
      );
    await upsert(100);
    await upsert(101);
    const r = await pool.query("SELECT ultimo FROM lecturas_mercado WHERE activo = 'BTC/USD'");
    expect(r.rowCount).toBe(1);
    expect(Number(r.rows[0].ultimo)).toBe(101);
  });

  it("lecturas_mercado registra un error aunque nunca haya leído un precio", async () => {
    await pool.query(
      "INSERT INTO lecturas_mercado (activo, ultimo_error_en, ultimo_error) VALUES ('SOL/USD', now(), 'timeout')",
    );
    const r = await pool.query("SELECT bid, ultimo_error FROM lecturas_mercado WHERE activo = 'SOL/USD'");
    expect(r.rows[0]).toEqual({ bid: null, ultimo_error: "timeout" });
  });

  it("las 4 vistas consultan sobre los datos sembrados", async () => {
    const v = async (vista: string) => (await pool.query(`SELECT * FROM ${vista}`)).rows;
    expect(await v("v_ejecuciones")).toMatchObject([{ estado: "completada" }]);
    expect((await v("v_ordenes")).map((o) => o.estado)).toContain("pendiente_envio");
    expect(await v("v_lotes")).toMatchObject([{ estado: "cerrado", etiqueta_exito: 1 }]);
    expect(await v("v_dataset")).toMatchObject([
      { activo: "BTC/USD", etiqueta_estado: "cerrada", etiqueta_exito: 1 },
    ]);
  });
});
