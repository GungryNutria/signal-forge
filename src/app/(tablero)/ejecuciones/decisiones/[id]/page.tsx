import type { Metadata } from "next";
import { Suspense } from "react";
import { BloqueConError } from "../../../_componentes/bloque";
import { DetalleDecisionVista } from "../../../_componentes/detalle-decision";
import { DetalleEsqueleto } from "../../../_componentes/detalle-propuesta";

export const metadata: Metadata = { title: "Decisión" };

// S5, detalle de una decisión del decisor sin propuesta (AC-UX-12). Con propuesta, la vista redirige a su S3.
// El segmento estático `decisiones` gana a `[id]` de `/ejecuciones/[id]/[activo]`: los ids son uuid y no chocan.
export default function Decision({ params, searchParams }: PageProps<"/ejecuciones/decisiones/[id]">) {
  return (
    <BloqueConError nombre="la decisión" cubre>
      <Suspense fallback={<DetalleEsqueleto etiqueta="la decisión" />}>
        <DetalleDecisionVista params={params} searchParams={searchParams} />
      </Suspense>
    </BloqueConError>
  );
}
