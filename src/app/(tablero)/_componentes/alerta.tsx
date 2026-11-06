import type { ReactNode } from "react";
import { IconoExclamacion, IconoTriangulo } from "./iconos";

// DESIGN.md > Banda de estado > Alertas: tinte + barra izquierda de 3 px + icono + texto. Sin botones.
export function Alerta({ tono, children }: { tono: "neg" | "warn"; children: ReactNode }) {
  const estilo = tono === "neg" ? "border-neg bg-neg-bg text-neg" : "border-warn bg-warn-bg text-warn";
  const Icono = tono === "neg" ? IconoExclamacion : IconoTriangulo;
  return (
    <li className={`flex items-start gap-2 rounded-sm border-l-[3px] px-3 py-2 text-sm ${estilo}`}>
      <span className="mt-[3px]">
        <Icono />
      </span>
      <span className="min-w-0 flex-1 text-ink">{children}</span>
    </li>
  );
}
