import type { ReactNode } from "react";

// Marcador de carga con la forma del contenido: barras `sunken`, nunca cifras (AC-UX-8).
export function Barra({ ancho = "w-full", alto = "h-[14px]" }: { ancho?: string; alto?: string }) {
  return <div data-cargando aria-hidden="true" className={`${alto} ${ancho} rounded-[3px] bg-sunken`} />;
}

export function Cargando({ children, etiqueta }: { children: ReactNode; etiqueta: string }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Cargando {etiqueta}</span>
      {children}
    </div>
  );
}
