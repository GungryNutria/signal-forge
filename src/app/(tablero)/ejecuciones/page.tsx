import type { Metadata } from "next";
import { Suspense } from "react";
import { ContenidoEjecuciones, EjecucionesEsqueleto } from "../_componentes/lista-ejecuciones";

export const metadata: Metadata = { title: "Ejecuciones" };

// S5 Ejecuciones: historial del ciclo, incluidas las evaluaciones sin señal. Filtros y cursor en `searchParams`.
export default function Ejecuciones({ searchParams }: PageProps<"/ejecuciones">) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="mb-2 text-2xl leading-[1.25] font-semibold">Ejecuciones</h1>
      <Suspense fallback={<EjecucionesEsqueleto />}>
        <ContenidoEjecuciones searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
