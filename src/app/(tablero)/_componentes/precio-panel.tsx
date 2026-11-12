"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { PuntoPrecio, SeriePrecio } from "@/server/consultas/tipos";
import { confianza, cripto, enUtc, hora, horaCorta, NOMBRE_PROPONENTE, pct, signo, unidad, usd, usdConSigno, zona } from "../_lib/formato";
import { distanciaANiveles, duracionTexto, hrefOperacion, type Marca } from "../_lib/precio";
import { Chip } from "./chip";
import { ChipOperacion } from "./estados";
import { IconoChevron } from "./iconos";
import { FormaMarca } from "./precio-comun";
import { cuando, detalleDeMarca, entradaDe, NOMBRE_TIPO, tituloDeMarca } from "./precio-texto";

// Panel de consulta de la gráfica (REQ-5, REQ-8, REQ-9, AC-UX-3, AC-UX-4). Va fuera del SVG y lo anuncia el lector de
// pantalla (`role="status"`). En escritorio queda a la derecha; en móvil, debajo de la gráfica y antes de la leyenda.
const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;

export type Seleccion = { tipo: "punto"; punto: PuntoPrecio } | { tipo: "marcas"; marcas: Marca[] };

function Filas({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">{children}</dl>;
}
const Fila = ({ t, children }: { t: string; children: ReactNode }) => (
  <>
    <dt className="text-muted">{t}</dt>
    <dd className="text-right [overflow-wrap:anywhere]">{children}</dd>
  </>
);

const EnlaceOperacion = ({ m, serie }: { m: Marca; serie: SeriePrecio }) => (
  <Link
    href={hrefOperacion(m.op.propuestaId, serie.activo, serie.rango)}
    className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-sm border border-accent px-3 text-sm font-semibold text-accent"
  >
    Ver operación
    <IconoChevron />
    <span className="sr-only"> ({tituloDeMarca(m)})</span>
  </Link>
);

function DePunto({ p }: { p: PuntoPrecio }) {
  return (
    <>
      <h3 className="text-base font-semibold">Punto de precio</h3>
      <p className="text-sm text-muted">
        Vela {horaCorta(p.inicioVela)} a {horaCorta(p.t)} ({zona(new Date(p.t))})
      </p>
      <Filas>
        <Fila t="Hora de cierre">
          {hora(p.t)} · {enUtc(p.t)}
        </Fila>
        <Fila t="Cierre">{usd(p.cierre)}</Fila>
        <Fila t="SMA20">{usd(p.sma20)}</Fila>
        <Fila t="Cierre anterior">{usd(p.cierrePrevio)}</Fila>
        <Fila t="Resultado">
          <Chip>{p.resultado === "propuesta" ? "Propuesta" : "Sin señal"}</Chip>
        </Fila>
      </Filas>
    </>
  );
}

function Niveles({ m, ultimo }: { m: Marca; ultimo: PuntoPrecio }) {
  const n = m.op.niveles!;
  const num = m.op.numero !== null ? ` #${m.op.numero}` : "";
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
      <h4 className="text-[13px] font-semibold">Niveles vigentes</h4>
      <p className="flex items-center gap-2 text-neg">
        <span aria-hidden="true" className="h-0 w-5 border-t-[3px] border-neg" />
        SL{num} · {usd(n.stopLoss)}
      </p>
      <p className="flex items-center gap-2 text-pos">
        <span aria-hidden="true" className="h-0 w-5 border-t-[3px] border-pos" />
        TP{num} · {usd(n.takeProfit)}
      </p>
      <p className="text-xs text-muted">Última vela: {distanciaANiveles(ultimo.cierre, n.stopLoss, n.takeProfit)}</p>
    </div>
  );
}

/** Valor de la regla que una propuesta que no es de la regla puede no traer (R-3). */
const valor = (v: string | null) => (v === null ? "—" : usd(v));

function DeMarca({ m, serie, ultimo, ahora }: { m: Marca; serie: SeriePrecio; ultimo: PuntoPrecio; ahora: Date }) {
  const op = m.op;
  const cabeza = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <FormaMarca tipo={m.tipo} />
        {tituloDeMarca(m)}
      </h3>
      {m.tipo === "entrada" ? <ChipOperacion estado={op.salida ? (op.salida.motivo === "take_profit" ? "cerrada_tp" : "cerrada_sl") : "abierta"} /> : null}
    </div>
  );
  if (m.tipo === "entrada") {
    const e = op.entrada;
    return (
      <>
        {cabeza}
        <p className="text-sm">Proponente: {NOMBRE_PROPONENTE[e.proponente]}</p>
        <Filas>
          <Fila t="Hora">
            {hora(e.t)} · {enUtc(e.t)}
          </Fila>
          <Fila t="Precio de llenado">{usd(e.precio)}</Fila>
          <Fila t="Tamaño">
            {cripto(e.cantidad, unidad(serie.activo))} · {usd(e.nocionalUsd)}
          </Fila>
          {/* REQ-32: la entrada del decisor no trae los valores de la regla; muestra su confianza. */}
          {e.proponente === "decisor" ? (
            <Fila t="Confianza">{e.confianza === null ? "—" : confianza(e.confianza)}</Fila>
          ) : (
            <>
              <Fila t="Cierre">{valor(e.cierre)}</Fila>
              <Fila t="Cierre anterior">{valor(e.cierrePrevio)}</Fila>
              <Fila t="SMA20">{valor(e.sma20)}</Fila>
            </>
          )}
        </Filas>
        {op.niveles ? <Niveles m={m} ultimo={ultimo} /> : null}
        <EnlaceOperacion m={m} serie={serie} />
      </>
    );
  }
  const s = op.salida!;
  return (
    <>
      {cabeza}
      <Filas>
        <Fila t="Hora">
          {hora(s.t)} · {enUtc(s.t)}
        </Fila>
        <Fila t="Precio de salida">{usd(s.precio)}</Fila>
        <Fila t="Motivo">Cierre por {NOMBRE_TIPO[s.motivo].toLowerCase()}</Fila>
        <Fila t="Nivel cruzado">{usd(s.nivel)}</Fila>
        <Fila t="PnL neto">
          <span className={COLOR[signo(s.pnlNetoUsd)]}>
            {usdConSigno(s.pnlNetoUsd)} ({pct(Number(s.pnlNetoPct) * 100, 2)})
          </span>
        </Fila>
        <Fila t="Duración">{duracionTexto(s.duracionS)}</Fila>
      </Filas>
      <p className="text-sm text-muted">{entradaDe(m, ahora)}</p>
      <EnlaceOperacion m={m} serie={serie} />
    </>
  );
}

const PLURAL: Record<Marca["tipo"], string> = { entrada: "entradas", stop_loss: "stop loss", take_profit: "take profit" };

function DeGrupo({ marcas, serie, ahora }: { marcas: Marca[]; serie: SeriePrecio; ahora: Date }) {
  const cuenta = (["entrada", "stop_loss", "take_profit"] as const)
    .map((t) => [t, marcas.filter((m) => m.tipo === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${PLURAL[t]}`);
  const [a, b] = [marcas[0].t, marcas[marcas.length - 1].t];
  return (
    <>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <span aria-hidden="true" className="inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-full border-[1.5px] border-ink bg-sunken px-1.5 text-xs font-semibold">
          ×{marcas.length}
        </span>
        {marcas.length} operaciones
      </h3>
      <p className="text-sm text-muted">{cuenta.join(" · ")}</p>
      <p className="text-sm text-muted">
        {a === b ? `A las ${hora(a)}` : `Entre ${horaCorta(a)} y ${hora(b)}`}
      </p>
      <ul aria-label="Operaciones del grupo" className="flex flex-col">
        {marcas.map((m) => (
          <li key={m.clave} className="flex flex-col gap-0.5 border-t border-line py-2 text-sm">
            <p className="font-semibold">
              {cuando(m.t, ahora)} · {tituloDeMarca(m)}
            </p>
            <p className="text-muted">{detalleDeMarca(m, ahora)}</p>
            <Link
              href={hrefOperacion(m.op.propuestaId, serie.activo, serie.rango)}
              className="inline-flex min-h-11 items-center gap-0.5 self-start text-accent"
            >
              Ver operación
              <IconoChevron />
              <span className="sr-only"> ({tituloDeMarca(m)} de las {horaCorta(m.t)})</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PanelConsulta({
  seleccion,
  serie,
  ultimo,
  sinOperaciones,
  referencia,
}: {
  seleccion: Seleccion | null;
  serie: SeriePrecio;
  ultimo: PuntoPrecio;
  /** Hay operaciones cargadas y ninguna en el rango (no es un error). */
  sinOperaciones: boolean;
  referencia?: (el: HTMLDivElement | null) => void;
}) {
  const ahora = new Date(serie.hasta);
  return (
    <div
      ref={referencia}
      role="status"
      data-panel-consulta
      className="flex max-h-[372px] flex-col gap-3 overflow-y-auto rounded-md border border-line bg-sunken p-4 md:max-h-[380px]"
    >
      {seleccion === null ? (
        <>
          {sinOperaciones ? (
            <>
              <h3 className="text-base font-semibold">Sin operaciones en este rango</h3>
              <p className="text-sm text-muted">No es un error.</p>
            </>
          ) : null}
          <p className="text-sm text-muted">
            <span className="md:hidden">Toca un punto o un marcador para ver su detalle</span>
            <span className="hidden md:inline">Pasa el puntero o usa las flechas sobre la gráfica para ver el detalle de un punto</span>
          </p>
        </>
      ) : seleccion.tipo === "punto" ? (
        <DePunto p={seleccion.punto} />
      ) : seleccion.marcas.length === 1 ? (
        <DeMarca m={seleccion.marcas[0]} serie={serie} ultimo={ultimo} ahora={ahora} />
      ) : (
        <DeGrupo marcas={seleccion.marcas} serie={serie} ahora={ahora} />
      )}
    </div>
  );
}
