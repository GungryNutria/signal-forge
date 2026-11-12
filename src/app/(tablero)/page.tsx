import type { Metadata } from "next";
import { Suspense } from "react";
import { BloqueConError } from "./_componentes/bloque";
import { Investigacion, InvestigacionEsqueleto, RotuloInvestigacion } from "./_componentes/investigacion";
import { Kpis, KpisEsqueleto } from "./_componentes/kpis";
import { PosicionesAbiertas, PosicionesEsqueleto } from "./_componentes/posiciones";
import { Tarjeta, TituloBloque } from "./_componentes/tarjeta";
import { UltimasPropuestas, UltimasPropuestasEsqueleto } from "./_componentes/ultimas-propuestas";

export const metadata: Metadata = { title: "Resumen" };

// S1 Resumen. Cada bloque lee su propia fuente dentro de su `<Suspense>` y su propio error: uno que falla o tarda
// no oculta a los demás. En móvil el orden es KPI → Posiciones → Investigación → Últimas propuestas.
export default function Resumen() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Resumen</h1>

      <BloqueConError nombre="los indicadores (saldo, valor de cartera y PnL)" cubre>
        <Suspense fallback={<KpisEsqueleto />}>
          <Kpis />
        </Suspense>
      </BloqueConError>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:items-start">
        <Tarjeta className="min-w-0 lg:col-span-7 lg:row-start-1">
          <TituloBloque>Posiciones abiertas</TituloBloque>
          <BloqueConError nombre="las posiciones abiertas">
            <Suspense fallback={<PosicionesEsqueleto />}>
              <PosicionesAbiertas />
            </Suspense>
          </BloqueConError>
        </Tarjeta>

        <section
          aria-labelledby="titulo-investigacion"
          className="min-w-0 rounded-md border border-dashed border-strong p-4 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1"
        >
          <TituloBloque id="titulo-investigacion" className="text-info">
            Investigación
          </TituloBloque>
          <Suspense fallback={null}>
            <RotuloInvestigacion />
          </Suspense>
          <BloqueConError nombre="la investigación">
            <Suspense fallback={<InvestigacionEsqueleto />}>
              <Investigacion />
            </Suspense>
          </BloqueConError>
        </section>

        <Tarjeta className="min-w-0 lg:col-span-7 lg:row-start-2">
          <TituloBloque>Últimas 5 propuestas</TituloBloque>
          <BloqueConError nombre="las últimas propuestas">
            <Suspense fallback={<UltimasPropuestasEsqueleto />}>
              <UltimasPropuestas />
            </Suspense>
          </BloqueConError>
        </Tarjeta>
      </div>
    </div>
  );
}
