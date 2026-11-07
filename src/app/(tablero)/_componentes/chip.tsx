import type { ReactNode } from "react";
import { IconoCheck, IconoCirculo, IconoExclamacion, IconoPunto, IconoTriangulo } from "./iconos";

// DESIGN.md > Chips de estado. Texto siempre visible; color e icono solo refuerzan ("Tinte nunca solo": los
// de severidad neg/warn llevan tinte, barra izquierda de 3 px, icono y texto).
export type Tono = "neutro" | "solido" | "info" | "pos" | "neg" | "warn";

const ESTILO: Record<Tono, string> = {
  neutro: "border-strong text-ink",
  solido: "border-ink bg-ink text-bg",
  info: "border-info text-info",
  pos: "border-pos text-pos",
  neg: "border-neg border-l-[3px] bg-neg-bg text-neg",
  warn: "border-warn border-l-[3px] bg-warn-bg text-warn",
};

const ICONO: Partial<Record<Tono, () => ReactNode>> = {
  info: IconoCirculo,
  pos: IconoCheck,
  neg: IconoExclamacion,
  warn: IconoTriangulo,
};

export function Chip({
  tono = "neutro",
  punto = false,
  children,
}: {
  tono?: Tono;
  /** Punto lleno en lugar del icono por tono (chip "Operando"). */
  punto?: boolean;
  children: ReactNode;
}) {
  const Icono = punto ? IconoPunto : ICONO[tono];
  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1 rounded-sm border px-2 py-0.5 text-[13px] leading-[1.3] font-semibold ${ESTILO[tono]}`}
    >
      {Icono ? <Icono /> : null}
      <span>{children}</span>
    </span>
  );
}
