import type { ReactNode } from "react";

/** Tarjeta de DESIGN.md: `surface`, borde de 1 px, radio 8, padding 16. Sin sombras. */
export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-md border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function TituloBloque({ children, id, className = "" }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={`mb-3 text-xl leading-[1.3] font-semibold ${className}`}>
      {children}
    </h2>
  );
}

/** Texto de estado vacío dentro de un bloque. */
export const Vacio = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted">{children}</p>;
