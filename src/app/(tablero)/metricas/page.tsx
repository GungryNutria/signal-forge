import type { Metadata } from "next";
import { Suspense } from "react";
import { ContenidoMetricas, MetricasEsqueleto } from "../_componentes/metricas-vista";

export const metadata: Metadata = { title: "Métricas" };

// S4 Métricas. El filtro de activo viaja en `searchParams` (formulario GET); leerlo exige esperar a la petición,
// por eso el contenido va dentro de `<Suspense>`.
export default function Metricas({ searchParams }: PageProps<"/metricas">) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl leading-[1.25] font-semibold">Métricas</h1>
      <Suspense fallback={<MetricasEsqueleto />}>
        <ContenidoMetricas searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
