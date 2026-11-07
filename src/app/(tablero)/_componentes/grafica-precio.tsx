"use client";

import type { OperacionesPrecio, SeriePrecio } from "@/server/consultas/tipos";

// Hueco de T-4: la gráfica real llega en T-5.
export function GraficaPrecio({ nombre }: { serie: SeriePrecio; operaciones: OperacionesPrecio | null; op: string | null; nombre: string }) {
  return <div role="group" aria-label={nombre} data-grafica className="h-[300px]" />;
}
