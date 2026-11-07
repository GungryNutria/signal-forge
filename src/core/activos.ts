export const ACTIVOS = ["BTC/USD", "SOL/USD"] as const;
export type Activo = (typeof ACTIVOS)[number];

export function esActivo(valor: unknown): valor is Activo {
  return typeof valor === "string" && (ACTIVOS as readonly string[]).includes(valor);
}
