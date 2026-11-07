import type { ReactNode } from "react";
import { horaCorta, usd, zona } from "../_lib/formato";
import { Chip } from "./chip";
import { IconoCirculo } from "./iconos";
import { Tarjeta, TituloBloque } from "./tarjeta";

// Regla de entrada evaluada (AC-UX-12, AC-UX-29). Decisión D1: en las condiciones de la regla de entrada, "Cumple" va
// en `pos` y "Incumple" en neutro con círculo vacío: no cumplir es el resultado normal ("Neutral es normal").
export type ResultadoRegla = { senal: boolean; closeUltimo: number; closePrevio: number; sma20: number };

// La justificación de una propuesta trae números; la foto de una evaluación los trae como texto decimal.
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** `{ senal, close_ultimo, close_previo, sma20 }` tal como lo guarda el motor; `null` si falta algo. */
export function leerResultado(x: unknown): ResultadoRegla | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const [closeUltimo, closePrevio, sma20] = [num(r.close_ultimo), num(r.close_previo), num(r.sma20)];
  if (typeof r.senal !== "boolean" || closeUltimo === null || closePrevio === null || sma20 === null) return null;
  return { senal: r.senal, closeUltimo, closePrevio, sma20 };
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] font-semibold text-muted">{etiqueta}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Cumple({ si }: { si: boolean }) {
  return si ? (
    <Chip tono="pos">Cumple</Chip>
  ) : (
    <span className="inline-flex min-h-6 items-center gap-1 rounded-sm border border-strong px-2 py-0.5 text-[13px] leading-[1.3] font-semibold text-ink">
      <IconoCirculo />
      Incumple
    </span>
  );
}

export function ReglaEntrada({
  version,
  resultado,
  barra,
  sinDatos,
}: {
  version: string | null;
  resultado: ResultadoRegla | null;
  /** Inicio de la última barra cerrada usada (ISO), si se conoce. */
  barra?: string | null;
  /** Texto cuando la regla no se pudo evaluar. */
  sinDatos: string;
}) {
  return (
    <Tarjeta>
      <TituloBloque>Regla de entrada evaluada</TituloBloque>
      {resultado === null ? (
        <p className="text-sm text-muted">{sinDatos}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:flex-wrap md:gap-x-10">
            <Dato etiqueta="Versión de la regla">
              <span className="font-mono text-[13px]">{version ?? "—"}</span>
            </Dato>
            <Dato etiqueta={barra ? `Último cierre (barra de ${horaCorta(barra)}, ${zona(new Date(barra))})` : "Último cierre"}>
              {usd(resultado.closeUltimo)}
            </Dato>
            <Dato etiqueta="Cierre previo">{usd(resultado.closePrevio)}</Dato>
            <Dato etiqueta="Media de 20 barras (SMA20)">{usd(resultado.sma20)}</Dato>
            <Dato etiqueta="Resultado">
              <Chip tono={resultado.senal ? "solido" : "neutro"}>{resultado.senal ? "Señal de compra" : "Sin señal"}</Chip>
            </Dato>
          </dl>
          <ul aria-label="Condiciones de la regla" className="mt-4 flex flex-col">
            {[
              { texto: "Último cierre > SMA20", valores: `${usd(resultado.closeUltimo)} > ${usd(resultado.sma20)}`, si: resultado.closeUltimo > resultado.sma20 },
              { texto: "Último cierre > cierre previo", valores: `${usd(resultado.closeUltimo)} > ${usd(resultado.closePrevio)}`, si: resultado.closeUltimo > resultado.closePrevio },
            ].map((c) => (
              <li
                key={c.texto}
                className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-t border-line py-2 text-sm first:border-0 md:grid-cols-[1fr_1fr_auto]"
              >
                <span>{c.texto}</span>
                <span className="order-3 col-span-2 text-muted md:order-none md:col-span-1">{c.valores}</span>
                <Cumple si={c.si} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Tarjeta>
  );
}
