import type { Metadata } from "next";
import { Suspense } from "react";
import { BloqueConError } from "../../../_componentes/bloque";
import { DetalleEsqueleto } from "../../../_componentes/detalle-propuesta";
import { DetalleEvaluacionVista } from "../../../_componentes/detalle-evaluacion";

export const metadata: Metadata = { title: "Evaluación" };

// S5, evaluación de un activo en una ejecución: la regla de entrada y la investigación adjunta, en ese orden.
export default function Evaluacion({ params, searchParams }: PageProps<"/ejecuciones/[id]/[activo]">) {
  return (
    <BloqueConError nombre="la evaluación" cubre>
      <Suspense fallback={<DetalleEsqueleto etiqueta="la evaluación" />}>
        <DetalleEvaluacionVista params={params} searchParams={searchParams} />
      </Suspense>
    </BloqueConError>
  );
}
