import "server-only";
import { sql } from "drizzle-orm";
import { aCentavos, deCentavos } from "@/core/dinero";
import { pnlNetoCentavos } from "@/core/pnl";
import { pnlDia } from "@/core/riesgo";
import { inicioDiaUtc } from "@/core/tiempo";
import { entradasAbiertasPorActivo, SALDO_INICIAL_C } from "@/server/cartera";
import { obtenerDb } from "@/server/db/cliente";
import { leerMaxEntradasAbiertas } from "@/server/env";
import { ACTIVOS } from "@/core/activos";
import type { LoteAbierto, ResumenCartera } from "./tipos";
import { fallaInyectada, fecha, filas, iso, type Marca } from "./util";

/** REQ-6: un precio con más de 180 s o con un error posterior a su lectura no se muestra como actual. */
export const PRECIO_FRESCO_MS = 180_000;

type FilaLectura = { activo: string; bid: string | null; leido_en: Marca | null; ultimo_error_en: Marca | null };
type FilaLote = {
  id: string;
  propuesta_id: string;
  activo: string;
  abierto_en: Marca;
  nocional_c: string;
  nocional_usd: string;
  cantidad_neta: string;
  precio_entrada: string;
  stop_loss: string;
  take_profit: string;
};

export type BaseCartera = {
  realizadoTotalC: number;
  realizadoHoyC: number;
  saldoInicioDiaC: number;
  lotes: FilaLote[];
  lecturas: FilaLectura[];
};

/** Un bid solo vale si la lectura es reciente y no hay un error posterior (REQ-6). */
export function bidFresco(l: FilaLectura | undefined, ahora: Date): number | null {
  if (!l || l.bid === null || l.leido_en === null) return null;
  if (ahora.getTime() - fecha(l.leido_en).getTime() > PRECIO_FRESCO_MS) return null;
  if (l.ultimo_error_en && fecha(l.ultimo_error_en).getTime() > fecha(l.leido_en).getTime()) return null;
  return Number(l.bid);
}

export async function leerBase(ahora: Date): Promise<BaseCartera> {
  const inicio = inicioDiaUtc(ahora).toISOString();
  const [cierres] = await filas<{ total: string; hoy: string }>(
    sql`SELECT COALESCE(SUM(round(pnl_neto_usd * 100)), 0)::text AS total,
        COALESCE(SUM(round(pnl_neto_usd * 100)) FILTER (WHERE cerrado_en >= ${inicio}::timestamptz), 0)::text AS hoy
        FROM cierres_lote`,
  );
  const lotes = await filas<FilaLote>(
    sql`SELECT l.id, l.propuesta_id, l.activo, l.abierto_en, round(l.nocional_entrada_usd * 100)::text AS nocional_c,
        l.nocional_entrada_usd::text AS nocional_usd, l.cantidad_neta::text AS cantidad_neta,
        l.precio_entrada::text AS precio_entrada, l.stop_loss::text AS stop_loss, l.take_profit::text AS take_profit
        FROM lotes l
        WHERE NOT EXISTS (SELECT 1 FROM cierres_lote c WHERE c.lote_id = l.id)
        ORDER BY l.abierto_en DESC, l.id DESC`,
  );
  const lecturas = await filas<FilaLectura>(
    sql`SELECT activo, bid::text AS bid, leido_en, ultimo_error_en FROM lecturas_mercado`,
  );
  const realizadoTotalC = Number(cierres.total);
  const realizadoHoyC = Number(cierres.hoy);
  return { realizadoTotalC, realizadoHoyC, saldoInicioDiaC: SALDO_INICIAL_C + realizadoTotalC - realizadoHoyC, lotes, lecturas };
}

export async function resumenCartera(ahora: Date): Promise<ResumenCartera> {
  fallaInyectada("resumenCartera");
  const base = await leerBase(ahora);
  const porActivo = new Map(base.lecturas.map((l) => [l.activo, l]));

  let noRealizadoC = 0;
  let completo = true;
  const lotesAbiertos: LoteAbierto[] = base.lotes.map((l) => {
    const bid = bidFresco(porActivo.get(l.activo), ahora);
    const pnlC = bid === null ? null : pnlNetoCentavos(Number(l.nocional_c), Number(l.cantidad_neta), bid);
    if (pnlC === null) completo = false;
    else noRealizadoC += pnlC;
    return {
      loteId: l.id,
      propuestaId: l.propuesta_id,
      activo: l.activo,
      abiertoEn: iso(l.abierto_en),
      nocionalEntradaUsd: l.nocional_usd,
      cantidad: l.cantidad_neta,
      precioEntrada: l.precio_entrada,
      stopLoss: l.stop_loss,
      takeProfit: l.take_profit,
      precioActual: bid === null ? null : String(bid),
      pnlNoRealizadoUsd: pnlC === null ? null : deCentavos(pnlC),
    };
  });

  const saldoC = SALDO_INICIAL_C + base.realizadoTotalC;
  const [{ hay }] = await filas<{ hay: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM ejecuciones) AS hay`);
  const abiertas = await entradasAbiertasPorActivo(obtenerDb());
  const topeEntradasPorActivo = leerMaxEntradasAbiertas(); // lanza si es inválida: el bloque muestra su error normal
  return {
    saldoVirtualUsd: deCentavos(saldoC),
    valorCarteraUsd: completo ? deCentavos(saldoC + noRealizadoC) : null,
    pnlDiaUsd: completo ? deCentavos(base.realizadoHoyC + noRealizadoC) : null,
    pnlNoRealizadoUsd: completo ? deCentavos(noRealizadoC) : null,
    pnlAcumuladoUsd: deCentavos(base.realizadoTotalC),
    lotesAbiertos,
    vacio: !hay,
    entradasAbiertas: ACTIVOS.filter((a) => (abiertas[a] ?? 0) > 0).map((a) => ({ activo: a, n: abiertas[a] })),
    topeEntradasPorActivo,
  };
}

/** PnL del día de REQ-31 con el último bid conocido, aunque no sea fresco (lo usa la banda de pausa automática). */
export function pnlDiaConUltimoBid(base: BaseCartera): number {
  const bid: Record<string, number | null> = {};
  for (const l of base.lecturas) bid[l.activo] = l.bid === null ? null : Number(l.bid);
  const lotes = base.lotes.map((l) => ({
    activo: l.activo,
    nocionalEntradaC: aCentavos(Number(l.nocional_usd)),
    cantidadNeta: Number(l.cantidad_neta),
  }));
  return pnlDia(base.realizadoHoyC, lotes, bid).pnlC;
}
