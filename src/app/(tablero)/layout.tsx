import Link from "next/link";
import { Suspense } from "react";
import { BandaConResumen, BandaEsqueleto } from "./_componentes/banda";
import { BloqueConError } from "./_componentes/bloque";
import { BarraInferior, Pestanas } from "./_componentes/navegacion";

// Cabecera de 56 px (marca, "Paper", navegación), banda de estado y, en móvil, barra inferior de 5 destinos.
// Cabecera fija siempre; la banda fija solo en escritorio (DESIGN.md > Layout). La banda va en su propio
// `<Suspense>` con su propio error: el resto de la página no depende de ella.
export default function TableroLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center px-4 md:px-8">
          <Link href="/" className="text-xl leading-none font-semibold">
            SignalForge
          </Link>
          <span className="ml-auto rounded-sm border border-strong px-2 py-0.5 text-[13px] leading-[1.3] font-semibold md:ml-3">
            Paper
          </span>
          <Suspense fallback={<div className="ml-8 hidden h-full md:block" aria-hidden="true" />}>
            <Pestanas />
          </Suspense>
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] px-4 pb-24 md:px-8 md:pb-10">
        <div className="sticky top-14 z-20 bg-bg py-4 max-lg:static">
          <BloqueConError nombre="la banda de estado">
            <Suspense fallback={<BandaEsqueleto />}>
              <BandaConResumen />
            </Suspense>
          </BloqueConError>
        </div>
        <main id="contenido" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>

      <Suspense fallback={null}>
        <BarraInferior />
      </Suspense>
    </>
  );
}
