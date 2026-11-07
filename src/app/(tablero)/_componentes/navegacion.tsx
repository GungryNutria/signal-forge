"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { IconoEjecuciones, IconoMetricas, IconoPrecio, IconoPropuestas, IconoResumen } from "./iconos";

const DESTINOS: { href: string; etiqueta: string; icono: ReactNode }[] = [
  { href: "/", etiqueta: "Resumen", icono: <IconoResumen /> },
  { href: "/propuestas", etiqueta: "Propuestas", icono: <IconoPropuestas /> },
  { href: "/metricas", etiqueta: "Métricas", icono: <IconoMetricas /> },
  { href: "/ejecuciones", etiqueta: "Ejecuciones", icono: <IconoEjecuciones /> },
  { href: "/precio", etiqueta: "Precio", icono: <IconoPrecio /> },
];

const activa = (ruta: string, href: string) => (href === "/" ? ruta === "/" : ruta === href || ruta.startsWith(`${href}/`));

/** Pestañas de la cabecera (≥ 768 px): la activa va subrayada 2 px `accent`. */
export function Pestanas() {
  const ruta = usePathname();
  return (
    <nav aria-label="Principal" className="ml-8 hidden self-stretch md:block">
      <ul className="flex h-full gap-6">
        {DESTINOS.map((d) => {
          const on = activa(ruta, d.href);
          return (
            <li key={d.href} className="flex">
              <Link
                href={d.href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center border-b-2 px-1 text-[15px] ${
                  on ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {d.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Barra inferior de 5 destinos (< 768 px), fija al pie del viewport. Icono y texto siempre visibles. */
export function BarraInferior() {
  const ruta = usePathname();
  return (
    <nav aria-label="Principal (móvil)" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface md:hidden">
      <ul className="grid h-14 grid-cols-5">
        {DESTINOS.map((d) => {
          const on = activa(ruta, d.href);
          return (
            <li key={d.href} className="flex">
              <Link
                href={d.href}
                aria-current={on ? "page" : undefined}
                className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
                  on ? "font-semibold text-accent" : "text-muted"
                }`}
              >
                {d.icono}
                {d.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
