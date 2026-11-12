import "server-only";
import { sql } from "drizzle-orm";
import { ACTIVOS } from "@/core/activos";
import { type Activo, type OperacionesPrecio, type PuntoPrecio, RANGO_MS, type Rango, type SeriePrecio } from "./tipos";
import { fallaInyectada, fecha, filas, iso, type Marca } from "./util";

// S6 (spec 002): solo SELECT. Nunca se selecciona la foto completa, `entrada_cruda`, `respuesta` ni `client_order_id`.

const MEDIA_HORA_MS = 30 * 60_000;

function desdeDe(rango: Rango, ahora: Date): Date | null {
  const ms = RANGO_MS[rango];
  return ms === null ? null : new Date(ahora.getTime() - ms);
}

/** Evaluaciones del activo que traen datos de la regla (REQ-1). La foto solo se lee por rutas explícitas. */
const conDatos = (activo: Activo) => sql`ev.activo = ${activo}
  AND ev.resultado IN ('sin_senal', 'propuesta')
  AND ev.foto->'regla'->>'version' IS NOT NULL`;
const VELA = sql`(ev.foto->'mercado'->>'ts_ultima_barra')::timestamptz`;

type FilaPunto = {
  id: string;
  vela: Marca;
  t: Marca;
  resultado: PuntoPrecio["resultado"];
  cierre: string;
  sma20: string;
  cierre_previo: string;
};

/** REQ-1 a REQ-5: un punto por vela cerrada (la primera evaluación registrada gana), en orden ascendente. */
export async function seriePrecio(activo: Activo, rango: Rango, ahora: Date): Promise<SeriePrecio> {
  fallaInyectada("seriePrecio");
  const desde = desdeDe(rango, ahora);
  const marca = desde ? desde.toISOString() : null;
  // t <= evaluada_en, así que el filtro por evaluada_en no descarta puntos del rango y permite usar el índice.
  const enEvaluacion = marca ? sql`AND ev.evaluada_en >= ${marca}::timestamptz` : sql``;
  const enVela = marca ? sql`WHERE vela + interval '30 minutes' >= ${marca}::timestamptz` : sql``;

  const [puntos, [extremos]] = await Promise.all([
    filas<FilaPunto>(
      sql`SELECT DISTINCT ON (vela) id, vela, vela + interval '30 minutes' AS t, resultado, cierre, sma20, cierre_previo
          FROM (
            SELECT ev.id, ev.evaluada_en, ev.resultado, ${VELA} AS vela,
              ev.foto->'regla'->'resultado'->>'close_ultimo' AS cierre,
              ev.foto->'regla'->'resultado'->>'sma20' AS sma20,
              ev.foto->'regla'->'resultado'->>'close_previo' AS cierre_previo
            FROM evaluaciones ev
            WHERE ${conDatos(activo)} ${enEvaluacion}
          ) x
          ${enVela}
          ORDER BY vela, evaluada_en, id`,
    ),
    filas<{ primero: Marca | null; ultimo: Marca | null }>(
      sql`SELECT
            (SELECT ${VELA} + interval '30 minutes' FROM evaluaciones ev WHERE ${conDatos(activo)} ORDER BY ${VELA} ASC LIMIT 1) AS primero,
            (SELECT ${VELA} + interval '30 minutes' FROM evaluaciones ev WHERE ${conDatos(activo)} ORDER BY ${VELA} DESC LIMIT 1) AS ultimo`,
    ),
  ]);

  let anterior: number | null = null;
  return {
    activo,
    rango,
    desde: marca,
    hasta: ahora.toISOString(),
    primerPunto: extremos.primero ? iso(extremos.primero) : null,
    ultimoPunto: extremos.ultimo ? iso(extremos.ultimo) : null,
    puntos: puntos.map((p) => {
      const t = fecha(p.t).getTime();
      const hueco = anterior !== null && t - anterior !== MEDIA_HORA_MS;
      anterior = t;
      return {
        evaluacionId: p.id,
        t: new Date(t).toISOString(),
        inicioVela: iso(p.vela),
        cierre: p.cierre,
        sma20: p.sma20,
        cierrePrevio: p.cierre_previo,
        resultado: p.resultado,
        hueco,
      };
    }),
  };
}

type FilaLote = {
  propuesta_id: string;
  proponente: "ciclo" | "decisor";
  confianza_decision: string | null;
  numero: string | null;
  abierto_en: Marca;
  precio_entrada: string;
  nocional: string;
  cantidad: string;
  cierre: string | null;
  cierre_previo: string | null;
  sma20: string | null;
  stop_loss: string;
  take_profit: string;
  cerrado_en: Marca | null;
  precio_salida: string | null;
  motivo: "take_profit" | "stop_loss" | null;
  pnl_usd: string | null;
  pnl_pct: string | null;
  duracion_s: number | null;
};

/** REQ-6 a REQ-15: lotes del activo con entrada llenada (`v_lotes`) que tocan el rango, más todos los abiertos. */
export async function operacionesPrecio(activo: Activo, rango: Rango, ahora: Date): Promise<OperacionesPrecio> {
  fallaInyectada("operacionesPrecio");
  const desde = desdeDe(rango, ahora);
  const marca = desde ? desde.toISOString() : null;
  const tocaRango = marca
    ? sql`AND (l.abierto_en >= ${marca}::timestamptz OR l.cerrado_en >= ${marca}::timestamptz OR l.estado = 'abierto')`
    : sql``;

  const [lotes, abiertas] = await Promise.all([
    filas<FilaLote>(
      sql`SELECT l.propuesta_id, CASE WHEN p.proponente = 'decisor' THEN 'decisor' ELSE 'ciclo' END AS proponente,
            dc.confianza::text AS confianza_decision, n.numero::text AS numero, l.abierto_en, l.precio_entrada::text AS precio_entrada,
            l.nocional_entrada_usd::text AS nocional, l.cantidad_llenada::text AS cantidad,
            p.justificacion->'resultado'->>'close_ultimo' AS cierre,
            p.justificacion->'resultado'->>'close_previo' AS cierre_previo,
            p.justificacion->'resultado'->>'sma20' AS sma20,
            l.stop_loss::text AS stop_loss, l.take_profit::text AS take_profit,
            l.cerrado_en, l.precio_salida::text AS precio_salida, l.motivo_cierre AS motivo,
            l.pnl_neto_usd::text AS pnl_usd, l.pnl_neto_pct::text AS pnl_pct, l.duracion_s
          FROM v_lotes l
          JOIN propuestas p ON p.id = l.propuesta_id
          LEFT JOIN decisiones dc ON dc.id = p.decision_id
          LEFT JOIN (
            SELECT id, row_number() OVER (ORDER BY abierto_en, id) AS numero
            FROM v_lotes WHERE activo = ${activo} AND estado = 'abierto'
          ) n ON n.id = l.id
          WHERE l.activo = ${activo} ${tocaRango}
          ORDER BY l.abierto_en, l.id`,
    ),
    filas<{ activo: Activo; n: string }>(
      sql`SELECT activo, count(*)::text AS n FROM v_lotes WHERE estado = 'abierto' GROUP BY activo`,
    ),
  ]);

  const dentro = (t: Marca) => desde === null || fecha(t).getTime() >= desde.getTime();
  const abiertasPorActivo = Object.fromEntries(ACTIVOS.map((a) => [a, 0])) as Record<Activo, number>;
  for (const a of abiertas) if (a.activo in abiertasPorActivo) abiertasPorActivo[a.activo] = Number(a.n);

  return {
    filas: lotes.map((l) => ({
      propuestaId: l.propuesta_id,
      numero: l.numero === null ? null : Number(l.numero),
      entrada: {
        proponente: l.proponente,
        confianza: l.confianza_decision,
        t: iso(l.abierto_en),
        precio: l.precio_entrada,
        nocionalUsd: l.nocional,
        cantidad: l.cantidad,
        cierre: l.cierre,
        cierrePrevio: l.cierre_previo,
        sma20: l.sma20,
        enRango: dentro(l.abierto_en),
      },
      salida:
        l.cerrado_en === null || l.motivo === null
          ? null
          : {
              t: iso(l.cerrado_en),
              precio: l.precio_salida as string,
              motivo: l.motivo,
              nivel: l.motivo === "stop_loss" ? l.stop_loss : l.take_profit,
              pnlNetoUsd: l.pnl_usd as string,
              pnlNetoPct: l.pnl_pct as string,
              duracionS: Number(l.duracion_s),
              enRango: dentro(l.cerrado_en),
            },
      niveles: l.cerrado_en === null ? { stopLoss: l.stop_loss, takeProfit: l.take_profit } : null,
    })),
    abiertasPorActivo,
  };
}
