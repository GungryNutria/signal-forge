import type { Metadata } from "next";
import { Suspense } from "react";
import { ContenidoPropuestas, PropuestasEsqueleto } from "../_componentes/lista-propuestas";

export const metadata: Metadata = { title: "Propuestas" };

// S2 Propuestas. Filtros y cursor viajan en `searchParams` (formularios GET): leerlos exige esperar a la petición,
// por eso el contenido va dentro de `<Suspense>`. Si la lista falla, los filtros siguen visibles.
export default function Propuestas({ searchParams }: PageProps<"/propuestas">) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl leading-[1.25] font-semibold">Propuestas</h1>
      <p className="mb-4 text-sm text-muted">
        Todo lo que propuso el ciclo y qué pasó. Las evaluaciones sin señal están en Ejecuciones.
      </p>
      <Suspense fallback={<PropuestasEsqueleto />}>
        <ContenidoPropuestas searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
