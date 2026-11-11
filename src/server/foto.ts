import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ACTIVOS, type Activo } from "@/core/activos";
import { inicioDiaUtc } from "@/core/tiempo";
import type { EntradaFoto, InvestigacionAdjunta } from "@/core/foto";
import { seleccionarVigente, VIGENCIA_MIN } from "@/core/investigacion";
import { pnlDia } from "@/core/riesgo";
import { entradasAbiertasPorActivo } from "@/server/cartera";
import { investigaciones } from "@/server/db/esquema";

const SALDO_INICIAL_C = 1_000_000;

/**
 * Lo que la foto-v2 necesita de la cartera, solo lectura (a diferencia de `calcularCartera`, no inserta la
 * pausa automática). El no realizado usa el bid de este ciclo; si falta para un activo con lotes, va `null`.
 */
export async function carteraParaFoto(
  db: NodePgDatabase,
  t: Date,
  bid: Readonly<Record<Activo, number | null>>,
): Promise<EntradaFoto["cartera"]> {
  const inicio = inicioDiaUtc(t).toISOString();
  const filas = async <T>(consulta: ReturnType<typeof sql>) => (await db.execute(consulta)).rows as T[];

  const [cierres] = await filas<{ total: string; hoy: string }>(
    sql`SELECT COALESCE(SUM(round(pnl_neto_usd * 100)), 0)::text AS total,
        COALESCE(SUM(round(pnl_neto_usd * 100)) FILTER (WHERE cerrado_en >= ${inicio}::timestamptz), 0)::text AS hoy
        FROM cierres_lote`,
  );
  const abiertos = (
    await filas<{ activo: string; nc: string; cn: string }>(
      sql`SELECT l.activo, round(l.nocional_entrada_usd * 100)::text AS nc, l.cantidad_neta::text AS cn
          FROM lotes l WHERE NOT EXISTS (SELECT 1 FROM cierres_lote c WHERE c.lote_id = l.id)`,
    )
  ).map((l) => ({ activo: l.activo, nocionalEntradaC: Number(l.nc), cantidadNeta: Number(l.cn) }));
  const [{ n }] = await filas<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM propuestas
        WHERE decision = 'ejecutada' AND lado = 'buy'
          AND recibida_en >= ${inicio}::timestamptz AND recibida_en < ${inicio}::timestamptz + interval '1 day'`,
  );

  const exposicionPorActivoC = Object.fromEntries(ACTIVOS.map((a) => [a, 0])) as Record<Activo, number>;
  for (const l of abiertos) exposicionPorActivoC[l.activo as Activo] += l.nocionalEntradaC;

  const abiertasPorActivo = await entradasAbiertasPorActivo(db);
  const entradasAbiertas = Object.fromEntries(ACTIVOS.map((a) => [a, abiertasPorActivo[a] ?? 0])) as Record<Activo, number>;

  const realizadoHoyC = Number(cierres.hoy);
  const saldoVirtualC = SALDO_INICIAL_C + Number(cierres.total);
  const { pnlC, noRealizadoFaltante } = pnlDia(realizadoHoyC, abiertos, bid);
  return {
    saldoVirtualC,
    valorCarteraC: noRealizadoFaltante ? null : saldoVirtualC + (pnlC - realizadoHoyC),
    exposicionTotalC: abiertos.reduce((s, l) => s + l.nocionalEntradaC, 0),
    exposicionPorActivoC,
    lotesAbiertos: abiertos.length,
    entradasAbiertasPorActivo: entradasAbiertas,
    entradasHoy: Number(n),
    pnlDiaC: noRealizadoFaltante ? null : pnlC,
  };
}

/** REQ-40: la investigación aceptada vigente del activo a `t`, o `null`. Consulta mínima de solo lectura. */
export async function investigacionVigente(
  db: NodePgDatabase,
  activo: Activo,
  t: Date,
): Promise<InvestigacionAdjunta | null> {
  const desde = new Date(t.getTime() - VIGENCIA_MIN * 60_000);
  const filas = await db
    .select()
    .from(investigaciones)
    .where(
      and(
        eq(investigaciones.estado, "aceptada"),
        eq(investigaciones.activo, activo),
        lte(investigaciones.recibidaEn, t),
        gt(investigaciones.recibidaEn, desde),
      ),
    );
  const candidatas: InvestigacionAdjunta[] = filas.map((f) => ({
    id: f.id,
    activo: f.activo as string,
    estado: "aceptada",
    recibidaEn: f.recibidaEn,
    sentimiento: Number(f.sentimiento),
    noticiaFuerte: f.noticiaFuerte as boolean,
    confianza: Number(f.confianza),
    resumen: f.resumen as string,
    fuentes: f.fuentes as string[],
    versionInstrucciones: f.versionInstrucciones as string,
  }));
  return seleccionarVigente(candidatas, activo, t);
}

