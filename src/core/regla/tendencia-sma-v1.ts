// Parámetros congelados de la versión: cambiarlos = nueva versión (REQ-34).
export const TENDENCIA_SMA_V1 = {
  version: "tendencia-sma-v1",
  timeframe: "30Min",
  periodoSma: 20,
  nocionalUsd: 500,
  tipoOrden: "mercado",
} as const;

export type ResultadoTendenciaSma = {
  senal: boolean;
  closeUltimo: number;
  closePrevio: number;
  sma20: number;
};

/**
 * Entrada: closes de las barras cerradas de 30 min en orden cronológico (se usan las últimas 21).
 * Señal = close[-1] > SMA20(close[-20..-1]) y close[-1] > close[-2]. No recibe la investigación (S-7).
 */
export function evaluarTendenciaSmaV1(closes: readonly number[]): ResultadoTendenciaSma {
  const n = TENDENCIA_SMA_V1.periodoSma + 1;
  if (closes.length < n) throw new Error(`tendencia-sma-v1 necesita ${n} closes, recibió ${closes.length}`);
  const ventana = closes.slice(-n);
  const closeUltimo = ventana[n - 1];
  const closePrevio = ventana[n - 2];
  const sma20 = ventana.slice(1).reduce((a, c) => a + c, 0) / TENDENCIA_SMA_V1.periodoSma;
  return { senal: closeUltimo > sma20 && closeUltimo > closePrevio, closeUltimo, closePrevio, sma20 };
}
