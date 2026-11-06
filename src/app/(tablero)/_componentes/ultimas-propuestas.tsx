import Link from "next/link";
import type { ReactNode } from "react";
import { ACTIVOS } from "@/core/activos";
import { proximaEjecucion } from "@/core/tiempo";
import type { FilaPropuesta, LoteAbierto } from "@/server/consultas/tipos";
import { cartera, estado, ultimasPropuestas } from "../_lib/datos";
import { horaCorta, hora, motivo, reglaPrincipal, signo, usdConSigno } from "../_lib/formato";
import { Barra, Cargando } from "./esqueleto";
import { ChipDecision, ChipOperacion, textoResultado } from "./estados";
import { IconoChevron } from "./iconos";
import { Vacio } from "./tarjeta";

const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;

/** Qué se muestra en "Estado o motivo": el estado de la operación (ejecutadas) o el motivo (las demás). */
export function EstadoOMotivo({ f }: { f: FilaPropuesta }) {
  if (f.decision === "ejecutada" && f.estado) return <ChipOperacion estado={f.estado} />;
  if (f.decision === "rechazada" && f.reglaPrincipal) {
    return (
      <span>
        {reglaPrincipal(f.reglaPrincipal)}
        {f.masReglas > 0 ? <span className="text-muted"> +{f.masReglas}</span> : null}
      </span>
    );
  }
  return <span>{motivo(f.motivo)}</span>;
}

/** PnL: el del lote cerrado, el no realizado si sigue abierta, o "—" (sin PnL). `null` = no disponible. */
function pnlDe(f: FilaPropuesta, abiertos: LoteAbierto[] | null): { texto: string; valor: string | null } {
  if (f.pnlUsd !== null) return { texto: usdConSigno(f.pnlUsd), valor: f.pnlUsd };
  if (f.estado === "abierta") {
    const lote = abiertos?.find((l) => l.propuestaId === f.id);
    if (!lote || lote.pnlNoRealizadoUsd === null) return { texto: "No disponible", valor: null };
    return { texto: usdConSigno(lote.pnlNoRealizadoUsd), valor: lote.pnlNoRealizadoUsd };
  }
  return { texto: "—", valor: null };
}

export function Pnl({ f, abiertos, movil = false }: { f: FilaPropuesta; abiertos: LoteAbierto[] | null; movil?: boolean }) {
  const { texto, valor } = pnlDe(f, abiertos);
  if (valor === null) {
    if (texto === "No disponible") return <span className="text-muted">No disponible</span>;
    return <span className="text-muted">{movil ? (f.estado === "rechazada_broker" ? "Sin PnL" : "PnL —") : "—"}</span>;
  }
  return <span className={COLOR[signo(valor)]}>{texto}</span>;
}

/** Fila entera clicable hacia S3: el enlace se extiende sobre la fila y lleva el nombre accesible. */
export function Enlace({ f, children, sufijo = "" }: { f: FilaPropuesta; children: ReactNode; sufijo?: string }) {
  return (
    <Link
      href={`/propuestas/${f.id}${sufijo}`}
      className="after:absolute after:inset-0"
      aria-label={`Ver la propuesta de las ${hora(f.recibidaEn)}${f.activo ? `, ${f.activo}` : ""}`}
    >
      {children}
    </Link>
  );
}

async function vacio() {
  // Con la base sin ejecuciones es el primer día; con ejecuciones, el ciclo funciona y simplemente no hubo propuesta.
  const e = await estado().catch(() => null);
  if (e === null) return <Vacio>Todavía no hay propuestas.</Vacio>;
  const { ahora, datos } = e;
  const ult = datos.ultimaEjecucion;
  if (ult === null) {
    return (
      <Vacio>
        El ciclo aún no ha generado propuestas. Evalúa BTC/USD y SOL/USD cada 30 minutos; la próxima ejecución se espera a las{" "}
        {hora(proximaEjecucion(ahora).toISOString())}
      </Vacio>
    );
  }
  const resultados = ACTIVOS.map((a) => textoResultado(ult.porActivo[a]));
  const iguales = resultados.every((r) => r === resultados[0]);
  const detalle = iguales
    ? `${resultados[0]} en ${ACTIVOS.join(" y ")}`
    : ACTIVOS.map((a, i) => `${a}: ${resultados[i]}`).join(" · ");
  return (
    <Vacio>
      Ninguna ejecución ha encontrado señal todavía. Última ejecución: {hora(ult.inicio)} ({detalle})
    </Vacio>
  );
}

export async function UltimasPropuestas() {
  const { datos: filas } = await ultimasPropuestas();
  if (filas.length === 0) return vacio();
  // Los lotes abiertos dan el PnL no realizado de las filas "Abierta"; si esa fuente falla, dice "No disponible".
  const abiertos = filas.some((f) => f.estado === "abierta")
    ? await cartera()
        .then((r) => r.datos.lotesAbiertos)
        .catch(() => null)
    : [];

  return (
    <>
      <table className="hidden w-full text-sm md:table [&_th]:whitespace-nowrap">
        <caption className="sr-only">Últimas propuestas</caption>
        <thead>
          <tr className="bg-sunken text-[13px] font-semibold">
            <th scope="col" className="px-2 py-2 text-left">Hora (UTC−6)</th>
            <th scope="col" className="px-2 py-2 text-left">Activo</th>
            <th scope="col" className="px-2 py-2 text-left">Decisión</th>
            <th scope="col" className="px-2 py-2 text-left">Estado o motivo</th>
            <th scope="col" className="px-2 py-2 text-right">PnL</th>
            <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Ver detalle</span></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="relative min-h-10 border-b border-line last:border-0 hover:bg-sunken">
              <td className="px-2 py-2">
                <Enlace f={f}>{horaCorta(f.recibidaEn)}</Enlace>
              </td>
              <td className="px-2 py-2 font-semibold">{f.activo ?? "—"}</td>
              <td className="px-2 py-2"><ChipDecision decision={f.decision} /></td>
              <td className="px-2 py-2"><EstadoOMotivo f={f} /></td>
              <td className="px-2 py-2 text-right whitespace-nowrap"><Pnl f={f} abiertos={abiertos} /></td>
              <td className="px-2 py-2 text-muted"><IconoChevron /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col md:hidden">
        {filas.map((f) => (
          <li key={f.id} className="relative flex min-h-14 items-start gap-2 border-b border-line py-3 last:border-0">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p>
                  <Enlace f={f}>
                    <span className="font-semibold">{horaCorta(f.recibidaEn)}</span>
                  </Enlace>{" "}
                  · <span className="font-semibold">{f.activo ?? "—"}</span>
                </p>
                <ChipDecision decision={f.decision} />
              </div>
              <div className="min-w-0 [overflow-wrap:anywhere]"><EstadoOMotivo f={f} /></div>
              <div className="text-sm"><Pnl f={f} abiertos={abiertos} movil /></div>
            </div>
            <span className="mt-1 text-muted"><IconoChevron /></span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function UltimasPropuestasEsqueleto() {
  return (
    <Cargando etiqueta="las últimas propuestas">
      <div className="flex flex-col gap-4">
        <Barra alto="h-8" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Barra key={i} alto="h-6" />
        ))}
      </div>
    </Cargando>
  );
}
