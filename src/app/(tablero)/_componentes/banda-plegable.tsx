"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { IconoChevron } from "./iconos";

// D-5 (spec 002): solo en S6 y en móvil (< 640 px), la banda completa se reemplaza por una línea que es un
// disclosure y la despliega en su lugar; no navega. En cualquier otra superficie la banda va completa, como en 001.
export function BandaPlegable({ children, linea, avisos }: { children: ReactNode; linea: ReactNode; avisos: ReactNode }) {
  const ruta = usePathname();
  const [abierta, setAbierta] = useState(false);
  if (ruta !== "/precio") return <>{children}</>;
  return (
    <>
      <div className="sm:hidden">
        <button
          type="button"
          aria-expanded={abierta}
          aria-controls="banda-completa"
          onClick={() => setAbierta((a) => !a)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-2 text-left"
        >
          {linea}
          <span className={abierta ? "-rotate-90" : "rotate-90"}>
            <IconoChevron />
          </span>
        </button>
        {abierta ? null : avisos}
      </div>
      <div id="banda-completa" className={abierta ? "" : "max-sm:hidden"}>
        {children}
      </div>
    </>
  );
}
