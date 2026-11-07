import type { Activo } from "@/core/activos";
import { NOMBRE_RANGO, type Rango } from "../_lib/precio";
import { Barra } from "./esqueleto";
import { Tarjeta } from "./tarjeta";

/** Esqueleto `sunken` con la forma de la gráfica y de la alternativa en texto: sin cifras ni ejes (RNF-4). */
export function EsqueletoZona({ activo, rango }: { activo: Activo; rango: Rango }) {
  return (
    <Tarjeta>
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <p className="text-xl leading-[1.3] font-semibold">
          Cargando {activo} · {NOMBRE_RANGO[rango]}
        </p>
        <Barra alto="h-[260px]" />
        <Barra ancho="w-2/5" />
        <Barra ancho="w-1/3" />
        <Barra ancho="w-1/5" />
      </div>
    </Tarjeta>
  );
}

export function PrecioCargando() {
  return (
    <Tarjeta>
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <p className="text-xl leading-[1.3] font-semibold">Cargando precio</p>
        <Barra alto="h-[260px]" />
        <Barra ancho="w-2/5" />
      </div>
    </Tarjeta>
  );
}
