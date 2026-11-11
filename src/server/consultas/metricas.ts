import "server-only";
import { sql } from "drizzle-orm";
import { deCentavos } from "@/core/dinero";
import { SALDO_INICIAL_C } from "@/server/cartera";
import type { Activo, Metricas } from "./tipos";
import { fallaInyectada, filas, iso, type Marca } from "./util";

const INICIAL = sql.raw(String(SALDO_INICIAL_C)); // constante numérica propia, no entrada del usuario

// Curva y drawdown parten del saldo inicial y de los cierres; ambos son de toda la cartera (AC-UX-18).
const CURVA = sql`SELECT lote_id, cerrado_en AS t,
  ${INICIAL} + SUM(round(pnl_neto_usd * 100)) OVER (ORDER BY cerrado_en, lote_id) AS saldo
  FROM cierres_lote`;

/** S4 (REQ-27): todo calculado en SQL desde `cierres_lote` y `propuestas`. El filtro de activo no toca la curva ni el drawdown. */
export async function metricas(f: { activo?: Activo } = {}): Promise<Metricas> {
  fallaInyectada("metricas");
  const deLote = f.activo ? sql`AND l.activo = ${f.activo}` : sql``;
  const dePropuesta = f.activo ? sql`AND p.activo = ${f.activo}` : sql``;

  const [curva, drawdown, diario, tasa, decisiones, [{ n: r11 }]] = await Promise.all([
    filas<{ t: Marca; saldo: string }>(sql`WITH c AS (${CURVA}) SELECT t, saldo::text AS saldo FROM c ORDER BY t, lote_id`),
    filas<{ desde: Marca | null; hasta: Marca; pct: string }>(
      sql`WITH c AS (${CURVA}),
          p AS (SELECT lote_id, t, saldo, GREATEST(${INICIAL}, MAX(saldo) OVER (ORDER BY t, lote_id)) AS pico FROM c),
          d AS (SELECT lote_id, t, pico, (saldo - pico)::numeric / pico AS dd FROM p)
          SELECT d.t AS hasta, round(d.dd * 100, 2)::text AS pct,
            COALESCE((SELECT max(c.t) FROM c WHERE c.t <= d.t AND c.saldo = d.pico), (SELECT min(t) FROM c)) AS desde
          FROM d ORDER BY d.dd ASC, d.t ASC LIMIT 1`,
    ),
    filas<{ dia: string; pnl: string }>(
      sql`SELECT (c.cerrado_en AT TIME ZONE 'UTC')::date::text AS dia, SUM(c.pnl_neto_usd)::text AS pnl
          FROM cierres_lote c JOIN lotes l ON l.id = c.lote_id
          WHERE TRUE ${deLote}
          GROUP BY 1 ORDER BY 1`,
    ),
    filas<{ cerradas: string; aciertos: string; pnl: string }>(
      sql`SELECT count(*)::text AS cerradas, count(*) FILTER (WHERE c.etiqueta_exito = 1)::text AS aciertos,
          COALESCE(SUM(c.pnl_neto_usd), 0)::numeric(18,2)::text AS pnl
          FROM cierres_lote c JOIN lotes l ON l.id = c.lote_id
          WHERE TRUE ${deLote}`,
    ),
    filas<{ decision: string; motivo: string; n: string }>(
      sql`SELECT p.decision, COALESCE(p.reglas_incumplidas[1], p.motivo) AS motivo, count(*)::text AS n
          FROM propuestas p
          WHERE p.decision IN ('ejecutada', 'rechazada') ${dePropuesta}
          GROUP BY 1, 2 ORDER BY count(*) DESC, 2`,
    ),
    filas<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM propuestas p WHERE p.reglas @> '[{"regla":"R11","aplica":true}]'::jsonb ${dePropuesta}`,
    ),
  ]);

  const dd = drawdown[0];
  const cerradas = Number(tasa[0].cerradas);
  const aciertos = Number(tasa[0].aciertos);
  const rechazos = decisiones.filter((d) => d.decision === "rechazada");
  const porMotivo = new Map<string, number>();
  for (const d of rechazos) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + Number(d.n));

  return {
    curvaSaldo: curva.map((c) => ({ t: iso(c.t), saldoUsd: deCentavos(Number(c.saldo)) })),
    drawdownMax: !dd
      ? null
      : Number(dd.pct) === 0
        ? { pct: "0.00", desde: null, hasta: null }
        : { pct: dd.pct, desde: dd.desde ? iso(dd.desde) : null, hasta: iso(dd.hasta) },
    pnlDiario: diario.map((d) => ({ diaUtc: d.dia, pnlUsd: d.pnl })),
    pnlAcumuladoUsd: tasa[0].pnl,
    tasaAciertos: cerradas === 0 ? null : { pct: ((aciertos * 100) / cerradas).toFixed(1), aciertos, cerradas },
    porMotivo: [...porMotivo].map(([motivo, n]) => ({ motivo, n })),
    aprobadas: decisiones.filter((d) => d.decision === "ejecutada").reduce((s, d) => s + Number(d.n), 0),
    rechazadas: rechazos.reduce((s, d) => s + Number(d.n), 0),
    r11Evaluadas: Number(r11),
  };
}
