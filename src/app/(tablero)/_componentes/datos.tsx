import type { ReactNode } from "react";

// Campos de detalle (S3, detalle de decisión): etiqueta `label` y valor `body-sm`; en móvil, dos columnas.
export function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-semibold text-muted">{etiqueta}</dt>
      <dd className="text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
export const Datos = ({ children }: { children: ReactNode }) => (
  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:flex-wrap md:gap-x-10">{children}</dl>
);
export const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-[13px]">{children}</span>;
