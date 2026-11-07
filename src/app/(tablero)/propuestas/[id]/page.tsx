import type { Metadata } from "next";
import { Suspense } from "react";
import { BloqueConError } from "../../_componentes/bloque";
import { DetalleEsqueleto, DetallePropuestaVista } from "../../_componentes/detalle-propuesta";

export const metadata: Metadata = { title: "Propuesta" };

// S3 Detalle de una propuesta: cada propuesta tiene su propia dirección. Un id que no existe da 404.
export default function Detalle({ params, searchParams }: PageProps<"/propuestas/[id]">) {
  return (
    <BloqueConError nombre="la propuesta" cubre>
      <Suspense fallback={<DetalleEsqueleto etiqueta="la propuesta" />}>
        <DetallePropuestaVista params={params} searchParams={searchParams} />
      </Suspense>
    </BloqueConError>
  );
}
