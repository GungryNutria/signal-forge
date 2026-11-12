import { aCentavos, deCentavos } from "./dinero";
import { COMISION_BPS, nivelesLote } from "./pnl";

export const VERSION_HIPOTETICO = "hipotetico-v1";
/** Más de 180 s sin muestras es un hueco: 120 s de frescura del vigilante más margen. */
export const HUECO_MAX_MS = 180_000;

const FACTOR_COMISION = 1 - COMISION_BPS / 10_000;

/** Una muestra es un intervalo de un punto (min = max = bid). */
export type Intervalo = { desde: Date; hasta: Date; min: number; max: number };
export type Hueco = { desde: Date; hasta: Date };
export type Hipotetico = {
  resultado: "take_profit" | "stop_loss" | "pendiente";
  tocadoEn: Date | null;
  precioToque: number | null;
  huecos: Hueco[];
};

/**
 * REQ-20: el primer nivel que toque el precio de mercado posterior a la entrada. Con los dos niveles en el mismo intervalo
 * gana `stop_loss` (criterio conservador). Un hueco no impide resolver; solo queda listado, sin inventar precios.
 * `datos` va ordenado y con `desde` posterior a `t0`.
 */
export function resolverHipotetico(
  e: { t0: Date; precioEntrada: number },
  datos: readonly Intervalo[],
  ahora: Date,
): Hipotetico {
  const { stopLoss, takeProfit } = nivelesLote(e.precioEntrada);
  const huecos: Hueco[] = [];
  let cursor = e.t0;
  for (const d of datos) {
    if (d.desde.getTime() - cursor.getTime() > HUECO_MAX_MS) huecos.push({ desde: cursor, hasta: d.desde });
    if (d.min <= stopLoss) return { resultado: "stop_loss", tocadoEn: d.hasta, precioToque: d.min, huecos };
    if (d.max >= takeProfit) return { resultado: "take_profit", tocadoEn: d.hasta, precioToque: d.max, huecos };
    cursor = d.hasta;
  }
  if (ahora.getTime() - cursor.getTime() > HUECO_MAX_MS) huecos.push({ desde: cursor, hasta: ahora });
  return { resultado: "pendiente", tocadoEn: null, precioToque: null, huecos };
}

/**
 * REQ-21: PnL de entrar a `precioEntrada` y salir exactamente en `nivel`, con la comisión modelada a ambos lados.
 * Es el cálculo del PnL neto de un lote con el precio del nivel en lugar del llenado. Con el nivel exacto da
 * -2.49 % en el stop y +3.48 % en el take profit.
 */
export function pnlANivel(precioEntrada: number, nivel: number, nocionalUsd: number): { usd: string; pct: string } {
  const cantidadNeta = (nocionalUsd / precioEntrada) * FACTOR_COMISION;
  const nocionalC = aCentavos(nocionalUsd);
  const pnlC = aCentavos(cantidadNeta * nivel * FACTOR_COMISION) - nocionalC;
  return { usd: deCentavos(pnlC), pct: (pnlC / nocionalC).toFixed(6) };
}

/**
 * REQ-22: con N fijo, ¿cuenta cada señal en las métricas de la regla? No cuenta si en su `t0` ya había N señales que sí
 * contaron abiertas en el mismo activo (abierta desde su `t0` hasta su `tocadoEn`, o siempre si sigue pendiente).
 * Devuelve las señales en el mismo orden en que llegaron.
 */
export function aplicarTope<T extends { activo: string; t0: Date; tocadoEn: Date | null }>(
  senales: readonly T[],
  n: number,
): (T & { cuenta: boolean })[] {
  const orden = senales.map((s, i) => ({ s, i })).sort((a, b) => a.s.t0.getTime() - b.s.t0.getTime() || a.i - b.i);
  const contadas: T[] = [];
  const cuenta = new Set<number>();
  for (const { s, i } of orden) {
    const abiertas = contadas.filter(
      (c) => c.activo === s.activo && (c.tocadoEn === null || c.tocadoEn.getTime() > s.t0.getTime()),
    ).length;
    if (abiertas < n) {
      contadas.push(s);
      cuenta.add(i);
    }
  }
  return senales.map((s, i) => ({ ...s, cuenta: cuenta.has(i) }));
}
