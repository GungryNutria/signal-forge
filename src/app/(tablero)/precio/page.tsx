import type { Metadata } from "next";
import { Suspense } from "react";
import { BloqueConError } from "../_componentes/bloque";
import { Volver } from "../_componentes/detalle-propuesta";
import { EsperaProvider, ZonaEnEspera } from "../_componentes/precio-espera";
import { EsqueletoZona, PrecioCargando } from "../_componentes/precio-esqueleto";
import { Selectores, SelectoresConConteo, ZonaPrecio } from "../_componentes/precio-vista";
import { leerPrecio } from "../_lib/precio";

export const metadata: Metadata = { title: "Precio" };

// S6 Precio. Activo, rango y operación viajan en `searchParams` (enlaces, sin formularios): leerlos exige esperar a la
// petición, por eso todo va dentro de `<Suspense>`. Cada selección tiene su propio `key`: al cambiarla se ve el esqueleto
// "Cargando <activo> · <rango>" y nunca la gráfica anterior como si fuera la nueva (AC-UX-2).
export default function Precio({ searchParams }: PageProps<"/precio">) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense
        fallback={
          <>
            <h1 className="text-2xl leading-[1.25] font-semibold">Precio</h1>
            <PrecioCargando />
          </>
        }
      >
        <Contenido searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Contenido({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = leerPrecio(await searchParams);
  const clave = `${v.activo}|${v.rango}`;
  return (
    <EsperaProvider>
      {v.de === "propuesta" && v.op ? <Volver href={`/propuestas/${v.op}`} texto="Propuesta" /> : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-8">
        <h1 className="text-2xl leading-[1.25] font-semibold">Precio</h1>
        <BloqueConError nombre="las opciones de activo y rango">
          <Suspense key={clave} fallback={<Selectores v={v} conteo={null} />}>
            <SelectoresConConteo v={v} />
          </Suspense>
        </BloqueConError>
      </div>
      <ZonaEnEspera>
        <BloqueConError nombre={`la gráfica de precio de ${v.activo}`} cubre>
          <Suspense key={clave} fallback={<EsqueletoZona activo={v.activo} rango={v.rango} />}>
            <ZonaPrecio v={v} />
          </Suspense>
        </BloqueConError>
      </ZonaEnEspera>
    </EsperaProvider>
  );
}
