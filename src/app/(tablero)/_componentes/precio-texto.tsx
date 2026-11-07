import Link from "next/link";
import type { ReactNode } from "react";
import type { OperacionesPrecio, SeriePrecio } from "@/server/consultas/tipos";
import { dia, diaYHora, enUtc, hora, horaCorta, pct, signo, usd, usdConSigno, zona } from "../_lib/formato";
import { distanciaANiveles, hrefOperacion, type Marca, marcas, resumenSerie, type TipoMarca } from "../_lib/precio";
import { IconoChevron } from "./iconos";
import { FormaMarca } from "./precio-comun";
import { Tarjeta, TituloBloque } from "./tarjeta";

// Alternativa en texto de la gráfica (AC-UX-7): se arma en el servidor con los mismos valores que la gráfica, para
// teclado y lector de pantalla. Sin JavaScript propio.
const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;
export const NOMBRE_TIPO: Record<TipoMarca, string> = { entrada: "Entrada", stop_loss: "Stop loss", take_profit: "Take profit" };
export const CERRADA = { take_profit: "Cerrada por take profit", stop_loss: "Cerrada por stop loss" } as const;

/** `11:30` si es de hoy en Torreón, `5 nov, 11:30` si no. */
export const cuando = (iso: string, ahora: Date) => (dia(iso) === dia(ahora.toISOString()) ? horaCorta(iso) : diaYHora(iso));

/** Qué dice de la entrada una salida: su hora o que queda fuera del rango (AC-UX-10). */
export function entradaDe(m: Marca, ahora: Date): string {
  const e = m.op.entrada;
  return e.enRango ? `Entrada ${cuando(e.t, ahora)}` : `Entrada el ${dia(e.t)}, fuera de este rango`;
}

/** Título de una marca; "#n" solo si la posición sigue abierta (RK-3). */
export const tituloDeMarca = (m: Marca) => (m.tipo === "entrada" && m.op.numero !== null ? `Entrada #${m.op.numero}` : NOMBRE_TIPO[m.tipo]);

/** Importe y, en una salida, PnL con signo y de dónde entró. Lo usan la lista y la consulta de un grupo. */
export function detalleDeMarca(m: Marca, ahora: Date): ReactNode {
  if (m.tipo === "entrada") return `${usd(m.precio)} · ${m.op.salida ? CERRADA[m.op.salida.motivo] : "Abierta"}`;
  const s = m.op.salida!;
  return (
    <>
      {usd(m.precio)} ·{" "}
      <span className={COLOR[signo(s.pnlNetoUsd)]}>
        {usdConSigno(s.pnlNetoUsd)} ({pct(s.pnlNetoPct, 2)})
      </span>{" "}
      · {entradaDe(m, ahora)}
    </>
  );
}

const COLUMNAS = "md:grid-cols-[88px_170px_1fr_auto]";

function Fila({ m, serie, ahora }: { m: Marca; serie: SeriePrecio; ahora: Date }) {
  return (
    <li
      data-marca={m.clave}
      className={`grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-0.5 border-b border-line py-3 text-sm last:border-0 md:items-center md:py-2.5 ${COLUMNAS}`}
    >
      <p className="font-semibold md:font-normal">
        <span>{cuando(m.t, ahora)}</span>
        <span className="md:hidden"> · {tituloDeMarca(m)}</span>
      </p>
      <p className="hidden items-center gap-2 font-semibold md:col-start-2 md:row-start-1 md:flex">
        <FormaMarca tipo={m.tipo} />
        {tituloDeMarca(m)}
      </p>
      <p className="col-start-1 row-start-2 text-muted md:col-start-3 md:row-start-1 md:text-ink">{detalleDeMarca(m, ahora)}</p>
      <Link
        href={hrefOperacion(m.op.propuestaId, serie.activo, serie.rango)}
        className="col-start-2 row-span-2 row-start-1 inline-flex min-h-11 items-center gap-0.5 self-start whitespace-nowrap text-accent md:col-start-4 md:row-span-1 md:self-auto"
      >
        Ver operación
        <IconoChevron />
        <span className="sr-only"> ({tituloDeMarca(m)} de las {horaCorta(m.t)})</span>
      </Link>
    </li>
  );
}

export function AlternativaTexto({
  serie,
  operaciones,
  op,
  ahora,
}: {
  serie: SeriePrecio;
  operaciones: OperacionesPrecio | null;
  op: string | null;
  ahora: Date;
}) {
  const r = resumenSerie(serie.puntos);
  const ult = r.ultimo!;
  const z = zona(new Date(ult.t));
  const lista = operaciones ? marcas(operaciones.filas).reverse() : [];
  const abiertas = operaciones ? operaciones.filas.filter((f) => f.niveles) : [];
  const incompleta = serie.desde !== null && serie.primerPunto !== null && serie.primerPunto > serie.desde;
  const huecos = r.huecos.map((h) => `${horaCorta(h.desde)} a ${horaCorta(h.hasta)}`);

  return (
    <Tarjeta className="flex flex-col gap-6 p-4 md:p-6">
      <section aria-labelledby="alt-titulo">
        <TituloBloque id="alt-titulo" className="mb-1">
          Alternativa en texto
        </TituloBloque>
        <p className="text-sm text-muted">Mismo contenido que la gráfica, para teclado y lector de pantalla.</p>
      </section>

      <section aria-labelledby="alt-resumen" className="flex flex-col gap-1 text-sm">
        <h3 id="alt-resumen" className="text-[13px] font-semibold text-muted">
          Resumen
        </h3>
        <p>
          Último cierre: {usd(ult.cierre)} a las {hora(ult.t)} · SMA20: {usd(ult.sma20)}
        </p>
        <p>
          Mínimo {usd(r.minimo!)} · máximo {usd(r.maximo!)} en el rango
        </p>
        <p>
          {huecos.length === 0
            ? "Sin huecos en los datos"
            : `${huecos.length} ${huecos.length === 1 ? "hueco" : "huecos"} sin datos: ${huecos.join(" y ")} (${z})`}
        </p>
        <p>
          Datos desde el {diaYHora(r.primero!.t)} ({z}){incompleta ? "" : ", todo el rango"}
        </p>
      </section>

      <section aria-labelledby="alt-ops">
        <h3 id="alt-ops" className="mb-1 text-[13px] font-semibold text-muted">
          Operaciones del rango{operaciones ? ` (${lista.length})` : ""}
        </h3>
        {operaciones === null ? (
          <p className="text-sm text-muted">No disponibles.</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted">Ninguna.</p>
        ) : (
          <>
            <div aria-hidden="true" className={`hidden bg-sunken py-2 text-[13px] font-semibold md:grid md:gap-x-3 ${COLUMNAS}`}>
              <span>Hora</span>
              <span>Tipo</span>
              <span>Detalle</span>
              <span className="w-32" />
            </div>
            <ul aria-label="Operaciones del rango">
              {lista.map((m) => (
                <Fila key={m.clave} m={m} serie={serie} ahora={ahora} />
              ))}
            </ul>
          </>
        )}
      </section>

      {operaciones ? (
        <section aria-labelledby="alt-abiertas">
          <h3 id="alt-abiertas" className="mb-1 text-[13px] font-semibold text-muted">
            Posiciones abiertas ({abiertas.length})
          </h3>
          {abiertas.length === 0 ? (
            <p className="text-sm text-muted">Sin posiciones abiertas de {serie.activo}.</p>
          ) : (
            <ul aria-label="Posiciones abiertas">
              {abiertas.map((f) => (
                <li
                  key={f.propuestaId}
                  data-posicion={f.numero}
                  className={`flex flex-col gap-1 border-b border-l-[3px] border-b-line py-3 pl-3 text-sm last:border-b-0 md:grid md:grid-cols-[230px_1fr] md:gap-x-4 ${
                    f.propuestaId === op ? "border-l-ink bg-sunken" : "border-l-transparent"
                  }`}
                >
                  <p className="font-semibold">
                    #{f.numero} · {cuando(f.entrada.t, ahora)} · {usd(f.entrada.precio)}
                  </p>
                  <div className="flex flex-col gap-0.5 md:flex-row md:flex-wrap md:gap-x-6">
                    <p data-nivel="stop_loss" className="text-neg">
                      Stop loss {usd(f.niveles!.stopLoss)}
                    </p>
                    <p data-nivel="take_profit" className="text-pos">
                      Take profit {usd(f.niveles!.takeProfit)}
                    </p>
                    <p className="text-muted md:basis-full">
                      Última vela: {distanciaANiveles(ult.cierre, f.niveles!.stopLoss, f.niveles!.takeProfit)}
                    </p>
                    {f.entrada.enRango ? null : <p className="text-muted md:basis-full">Entrada el {dia(f.entrada.t)}, fuera de este rango</p>}
                  </div>
                  <Link
                    href={hrefOperacion(f.propuestaId, serie.activo, serie.rango)}
                    className="inline-flex min-h-11 items-center gap-0.5 self-start text-accent md:col-start-2 md:min-h-0"
                  >
                    Ver operación
                    <IconoChevron />
                    <span className="sr-only"> (posición #{f.numero})</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <details className="rounded-sm bg-sunken">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-sm font-semibold">
          <span>Tabla de puntos ({r.n} puntos)</span>
          <span className="hidden text-xs font-normal text-muted sm:inline">Plegada · hora, cierre, SMA20, cierre anterior, resultado</span>
        </summary>
        <div tabIndex={0} role="region" aria-label="Tabla de puntos, desplazable" className="max-h-[480px] overflow-auto px-3 pb-3">
          <table className="w-full text-sm whitespace-nowrap">
            <caption className="sr-only">Puntos de precio de {serie.activo} por hora de cierre de la vela, hora de Torreón</caption>
            <thead>
              <tr className="text-left text-[13px] font-semibold">
                <th scope="col" className="py-2 pr-3">
                  Hora ({z})
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  Cierre
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  SMA20
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  Cierre anterior
                </th>
                <th scope="col" className="py-2">
                  Resultado
                </th>
              </tr>
            </thead>
            <tbody>
              {serie.puntos.map((p) => (
                <tr key={p.evaluacionId} className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal" title={enUtc(p.t)}>
                    {diaYHora(p.t)}
                  </th>
                  <td className="py-1.5 pr-3 text-right">{usd(p.cierre)}</td>
                  <td className="py-1.5 pr-3 text-right">{usd(p.sma20)}</td>
                  <td className="py-1.5 pr-3 text-right">{usd(p.cierrePrevio)}</td>
                  <td className="py-1.5">{p.resultado === "propuesta" ? "Propuesta" : "Sin señal"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Tarjeta>
  );
}
