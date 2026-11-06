import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { debePausar, pnlDia, type EstadoCartera } from "@/core/riesgo";
import { diaUtc, inicioDiaUtc } from "@/core/tiempo";

/** Conexión o transacción de Drizzle: lo que se pueda consultar con `execute`. */
export type Consultable = Pick<NodePgDatabase, "execute">;

export const SALDO_INICIAL_C = 1_000_000; // 10 000.00 USD
const ULTIMO_EVENTO = sql`(SELECT ev.estado FROM eventos_orden ev WHERE ev.orden_id = o.id ORDER BY ev.id DESC LIMIT 1)`;

async function filas<T>(db: Consultable, consulta: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(consulta)).rows as T[];
}

/**
 * `EstadoCartera` de plan.md §Riesgo, calculado desde la base. Si el PnL del día cruza -3 % y aún no hay evento
 * de hoy, inserta `pausa_automatica` (REQ-31). Debe correr dentro de la transacción que tiene el candado de decisión.
 */
export async function calcularCartera(
  db: Consultable,
  ahora: Date,
  pausaManual: boolean,
): Promise<EstadoCartera> {
  const inicio = inicioDiaUtc(ahora).toISOString();
  const hoy = diaUtc(ahora);

  const [cierres] = await filas<{ total: string; hoy: string }>(
    db,
    sql`SELECT COALESCE(SUM(round(pnl_neto_usd * 100)), 0)::text AS total,
        COALESCE(SUM(round(pnl_neto_usd * 100)) FILTER (WHERE cerrado_en >= ${inicio}::timestamptz), 0)::text AS hoy
        FROM cierres_lote`,
  );
  const realizadoC = Number(cierres.total);
  const realizadoHoyC = Number(cierres.hoy);

  const abiertos = await filas<{ activo: string; nc: string; cn: string }>(
    db,
    sql`SELECT l.activo, round(l.nocional_entrada_usd * 100)::text AS nc, l.cantidad_neta::text AS cn
        FROM lotes l WHERE NOT EXISTS (SELECT 1 FROM cierres_lote c WHERE c.lote_id = l.id)`,
  );
  const lotes = abiertos.map((l) => ({ activo: l.activo, nocionalEntradaC: Number(l.nc), cantidadNeta: Number(l.cn) }));

  const [pendientes] = await filas<{ c: string }>(
    db,
    sql`SELECT COALESCE(SUM(round(o.nocional_usd * 100)), 0)::text AS c FROM ordenes o
        WHERE o.tramo = 'entrada'
          AND NOT EXISTS (SELECT 1 FROM lotes l WHERE l.orden_entrada_id = o.id)
          AND ${ULTIMO_EVENTO} IN ('pendiente_envio','enviada','aceptada','parcial','desconocido')`,
  );
  const exposicionCostoC = lotes.reduce((s, l) => s + l.nocionalEntradaC, 0) + Number(pendientes.c);

  const cantidadPorActivo: Record<string, number> = {};
  for (const l of lotes) cantidadPorActivo[l.activo] = (cantidadPorActivo[l.activo] ?? 0) + l.cantidadNeta;

  const [{ n: entradas }] = await filas<{ n: string }>(
    db,
    sql`SELECT count(*)::text AS n FROM propuestas
        WHERE decision = 'ejecutada' AND lado = 'buy'
          AND recibida_en >= ${inicio}::timestamptz AND recibida_en < ${inicio}::timestamptz + interval '1 day'`,
  );

  const desconocidas: Record<string, number> = {};
  for (const d of await filas<{ activo: string; n: string }>(
    db,
    sql`SELECT o.activo, count(*)::text AS n FROM ordenes o WHERE ${ULTIMO_EVENTO} = 'desconocido' GROUP BY o.activo`,
  ))
    desconocidas[d.activo] = Number(d.n);

  const bid: Record<string, number | null> = {};
  for (const r of await filas<{ activo: string; bid: string | null }>(db, sql`SELECT activo, bid::text AS bid FROM lecturas_mercado`))
    bid[r.activo] = r.bid === null ? null : Number(r.bid);

  const saldoVirtualC = SALDO_INICIAL_C + realizadoC;
  const saldoInicioDiaC = SALDO_INICIAL_C + realizadoC - realizadoHoyC;

  const [{ n: eventosHoy }] = await filas<{ n: string }>(
    db,
    sql`SELECT count(*)::text AS n FROM eventos WHERE tipo = 'pausa_automatica' AND dia_utc = ${hoy}::date`,
  );
  let pausaAutomatica = Number(eventosHoy) > 0;
  if (!pausaAutomatica && debePausar(pnlDia(realizadoHoyC, lotes, bid).pnlC, saldoInicioDiaC)) {
    await db.execute(
      sql`INSERT INTO eventos (momento, tipo, dia_utc, detalle)
          VALUES (${ahora.toISOString()}::timestamptz, 'pausa_automatica', ${hoy}::date, '{}'::jsonb)
          ON CONFLICT DO NOTHING`,
    );
    pausaAutomatica = true;
  }

  return {
    saldoVirtualC,
    exposicionCostoC,
    saldoLibreC: saldoVirtualC - exposicionCostoC,
    cantidadPorActivo,
    entradasHoy: Number(entradas),
    pausaAutomatica,
    pausaManual,
    ordenesDesconocidas: desconocidas,
  };
}
