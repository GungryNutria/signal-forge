// Importes en centavos enteros: las comparaciones de riesgo son exactas (RNF-2, D-10).

export function aCentavos(usd: number): number {
  return Math.round(usd * 100);
}

/** `10000.00`. */
export function deCentavos(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** `valor > pct % de base`, en enteros: valor×100 > base×pct. */
export function excedePorcentaje(valorC: number, baseC: number, pct: number): boolean {
  return valorC * 100 > baseC * pct;
}
