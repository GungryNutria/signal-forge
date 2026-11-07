"use client";

import Link, { useLinkStatus } from "next/link";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { Activo } from "@/core/activos";
import type { Rango } from "../_lib/precio";
import { EsqueletoZona } from "./precio-esqueleto";

// AC-UX-2: al cambiar de activo o de rango, la navegación del cliente conserva la pantalla anterior hasta que llega la
// nueva. Para que nunca se vea la gráfica anterior como si fuera la selección nueva, el enlace avisa de su destino en
// cuanto empieza a navegar (`useLinkStatus`) y la zona de la gráfica se cambia por el esqueleto "Cargando <activo> · <rango>".
type Destino = { activo: Activo; rango: Rango } | null;
const Espera = createContext<{ destino: Destino; fijar: (d: Destino) => void }>({ destino: null, fijar: () => {} });

export function EsperaProvider({ children }: { children: ReactNode }) {
  const [destino, fijar] = useState<Destino>(null);
  return <Espera.Provider value={{ destino, fijar }}>{children}</Espera.Provider>;
}

function AvisoDeDestino({ activo, rango }: { activo: Activo; rango: Rango }) {
  const { pending } = useLinkStatus();
  const { fijar } = useContext(Espera);
  useEffect(() => {
    if (!pending) return;
    fijar({ activo, rango });
    return () => fijar(null);
  }, [pending, activo, rango, fijar]);
  return null;
}

/** Enlace de los selectores: igual que un `<Link>`, pero avisa a la zona de la gráfica de lo que se va a cargar. */
export function EnlaceSeleccion({
  href,
  activo,
  rango,
  className,
  actual,
  children,
}: {
  href: string;
  activo: Activo;
  rango: Rango;
  className: string;
  actual: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} aria-current={actual ? "true" : undefined} className={className}>
      {children}
      <AvisoDeDestino activo={activo} rango={rango} />
    </Link>
  );
}

/** Mientras hay una selección nueva cargándose, la zona muestra el esqueleto en lugar de la gráfica anterior. */
export function ZonaEnEspera({ children }: { children: ReactNode }) {
  const { destino } = useContext(Espera);
  return destino ? <EsqueletoZona activo={destino.activo} rango={destino.rango} /> : children;
}
