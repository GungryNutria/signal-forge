"use client";

import { catchError } from "next/error";
import { IconoExclamacion } from "./iconos";

// Un bloque que falla no oculta los demás (AC-UX-9). Sin botón de reintento: el tablero es de solo lectura
// (AC-UX-21); el mensaje indica recargar la página. No muestra `error.message` (puede traer detalles de la base).
export const BloqueConError = catchError(function Fallo(props: { nombre: string; cubre?: boolean }) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-md border border-line bg-surface p-4 text-sm ${props.cubre ? "col-span-full" : ""}`}
    >
      <span className="mt-0.5 text-neg">
        <IconoExclamacion />
      </span>
      <p>
        No se pudo cargar {props.nombre}. Estos datos no se muestran; recarga la página para intentar de nuevo.
      </p>
    </div>
  );
});
