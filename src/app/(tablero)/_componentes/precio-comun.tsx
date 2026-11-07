import type { TipoMarca } from "../_lib/precio";

// Formas de los tres marcadores (T-2): la forma carga el significado, el color solo la refuerza.
// Entrada = triángulo hacia arriba (`ink`), Stop loss = cuadrado (`neg`), Take profit = rombo (`pos`).
export const COLOR_MARCA: Record<TipoMarca, string> = {
  entrada: "var(--color-ink)",
  stop_loss: "var(--color-neg)",
  take_profit: "var(--color-pos)",
};

/** Forma de una marca centrada en (0, 0), para dibujarla dentro de un `<svg>`. */
export function FormaSvg({ tipo, borde = "var(--color-surface)" }: { tipo: TipoMarca; borde?: string }) {
  const comun = { fill: COLOR_MARCA[tipo], stroke: borde, strokeWidth: 1.5, strokeLinejoin: "round" } as const;
  if (tipo === "entrada") return <path d="M0 -7.5 L8 7.5 L-8 7.5 Z" {...comun} />;
  if (tipo === "stop_loss") return <rect x={-6.5} y={-6.5} width={13} height={13} {...comun} />;
  return <path d="M0 -9 L9 0 L0 9 L-9 0 Z" {...comun} />;
}

/** La misma forma como icono en línea (leyenda, consulta y listas). */
export function FormaMarca({ tipo }: { tipo: TipoMarca }) {
  return (
    <svg aria-hidden="true" focusable="false" width={18} height={18} viewBox="-10 -10 20 20" className="shrink-0">
      <FormaSvg tipo={tipo} />
    </svg>
  );
}
