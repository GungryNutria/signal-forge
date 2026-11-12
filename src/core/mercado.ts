const MIN = 60_000;

export type EntradaSinDatos = {
  /** Mensaje del fallo al leer las barras; `null` si se leyeron. */
  errorBarras: string | null;
  /** Mensaje del fallo al leer los snapshots; `null` si se leyeron. */
  errorSnapshots: string | null;
  /** Inicio (ISO) de las barras de 30 min ya cerradas a `T`, en orden cronológico. */
  barrasCerradas: readonly { t: string }[];
  /** Mínimo de barras cerradas que pide quien llama (la regla pide 21; el contexto, 1). */
  minimoBarras: number;
  /** Hora del quote del activo; `null` si el activo no tiene quote. */
  tsQuote: Date | null;
  T: Date;
};

/**
 * REQ-6 de 001: por qué un activo no tiene datos de mercado, o `null` si los tiene. Los criterios, en este orden,
 * son los que usó el ciclo desde 001 (D-9 de 004): el ciclo y el contexto del decisor comparten esta definición.
 */
export function motivoSinDatos(e: EntradaSinDatos): string | null {
  const { barrasCerradas: c, T } = e;
  if (e.errorBarras !== null) return `barras: ${e.errorBarras}`;
  if (e.errorSnapshots !== null) return `snapshots: ${e.errorSnapshots}`;
  if (c.length < e.minimoBarras) return `solo ${c.length} barras cerradas (se necesitan ${e.minimoBarras})`;
  if (T.getTime() - (Date.parse(c[c.length - 1].t) + 30 * MIN) > 60 * MIN)
    return "la última barra cerrada terminó hace más de 60 min";
  if (!e.tsQuote) return "sin quote para el activo";
  if (e.tsQuote.getTime() > T.getTime() || T.getTime() - e.tsQuote.getTime() > 300_000)
    return "quote ausente o con más de 300 s";
  return null;
}
