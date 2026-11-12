import type { ReactNode } from "react";

/**
 * Todo texto escrito por el decisor (AC-UX-8): contenedor rotulado y hundido, el único con mono. El texto va literal: sin
 * marcado, sin enlaces automáticos y con sus saltos de línea. React lo escapa; `pre-wrap` conserva los saltos y
 * `overflow-wrap: anywhere` parte solo lo que no cabe, así a 360 px no hay scroll horizontal.
 */
export function RazonamientoLiteral({
  id,
  texto,
  rotulo = "Razonamiento del decisor (texto del agente, literal)",
  nota,
}: {
  id: string;
  texto: string | null;
  rotulo?: string;
  /** Aclara qué bloque del sistema tiene la decisión real. */
  nota?: ReactNode;
}) {
  return (
    <div>
      <div role="group" aria-labelledby={id} className="border-l-[3px] border-strong bg-sunken px-3 py-2">
        <p id={id} className="mb-1 text-[13px] leading-[1.3] font-semibold text-muted">
          {rotulo}
        </p>
        <p data-literal className="font-mono text-[13px] leading-[18px] [overflow-wrap:anywhere] whitespace-pre-wrap">
          {texto ?? "No disponible"}
        </p>
      </div>
      {nota ? <p className="mt-2 text-xs text-muted">{nota}</p> : null}
    </div>
  );
}
