import { connection } from "next/server";
import { cache, type ReactNode } from "react";
import { ACTIVOS, type Activo } from "@/core/activos";
import { proximaEjecucion } from "@/core/tiempo";
import { operacionesPrecio, seriePrecio } from "@/server/consultas/precio";
import type { OperacionesPrecio, Rango, SeriePrecio } from "@/server/consultas/tipos";
import { dia, diaYHora, hora, horaCorta, minutosDesde, relativo, zona } from "../_lib/formato";
import { FRASE_RANGO, hrefPrecio, NOMBRE_RANGO, RANGOS, type ValoresPrecio } from "../_lib/precio";
import { Alerta } from "./alerta";
import { GraficaPrecio } from "./grafica-precio";
import { EnlaceSeleccion } from "./precio-espera";
import { AlternativaTexto } from "./precio-texto";
import { Tarjeta } from "./tarjeta";

// S6 Precio (spec 002). Las dos consultas se memorizan por petición y por selección: el selector (con sus
// "· N abiertas") y la zona de la gráfica comparten la misma lectura y la misma hora. Una consulta que falla guarda
// su rechazo como resultado (`allSettled`): la zona decide si es error total (serie) o parcial (operaciones).
const cargarPrecio = cache(async (activo: Activo, rango: Rango) => {
  await connection();
  const ahora = new Date();
  const [s, o] = await Promise.allSettled([seriePrecio(activo, rango, ahora), operacionesPrecio(activo, rango, ahora)]);
  return { ahora, s, o };
});

const ATRASADO_MIN = 45; // REQ-20: mismo umbral de "ciclo detenido" de 001, medido desde el cierre de la vela

// ───────────────────────────── Selectores ─────────────────────────────

const abiertas = (n: number) => `${n} ${n === 1 ? "abierta" : "abiertas"}`;

/** Chips de 44 px que son enlaces: sin formularios ni JavaScript propio. Cambiar uno conserva el otro y quita `op` y `de`. */
export function Selectores({ v, conteo }: { v: ValoresPrecio; conteo: Record<Activo, number> | null }) {
  const chip = (on: boolean) =>
    `inline-flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-sm border px-3 text-[13px] font-semibold whitespace-nowrap md:flex-none md:px-4 ${
      on ? "border-accent bg-accent text-bg" : "border-strong text-ink hover:bg-sunken"
    }`;
  return (
    <div className="flex flex-col gap-3 md:flex-1 md:flex-row md:items-center md:justify-between md:gap-6">
      <nav aria-label="Activo" className="flex gap-2 md:gap-2">
        {ACTIVOS.map((a) => (
          <EnlaceSeleccion key={a} href={hrefPrecio({ activo: a, rango: v.rango })} activo={a} rango={v.rango} actual={a === v.activo} className={chip(a === v.activo)}>
            {conteo ? `${a} · ${abiertas(conteo[a])}` : a}
          </EnlaceSeleccion>
        ))}
      </nav>
      <nav aria-label="Rango" className="flex gap-1.5 md:gap-2">
        {RANGOS.map((r) => (
          <EnlaceSeleccion key={r} href={hrefPrecio({ activo: v.activo, rango: r })} activo={v.activo} rango={r} actual={r === v.rango} className={chip(r === v.rango)}>
            {NOMBRE_RANGO[r]}
          </EnlaceSeleccion>
        ))}
      </nav>
    </div>
  );
}

export async function SelectoresConConteo({ v }: { v: ValoresPrecio }) {
  const { o } = await cargarPrecio(v.activo, v.rango);
  return <Selectores v={v} conteo={o.status === "fulfilled" ? o.value.abiertasPorActivo : null} />;
}

// ───────────────────────────── Zona de la gráfica ─────────────────────────────

const Aviso = ({ tono = "warn", children }: { tono?: "warn" | "neg"; children: ReactNode }) => (
  <ul>
    <Alerta tono={tono}>{children}</Alerta>
  </ul>
);

/** `desde las 12:30 (UTC−6) del 6 nov` solo con el día cuando no es de hoy. */
const hastaLas = (iso: string, ahora: Date) =>
  `las ${hora(iso)}${dia(iso) === dia(ahora.toISOString()) ? "" : ` del ${dia(iso)}`}`;

function nombreGrafica(s: SeriePrecio): string {
  const [a, b] = [s.puntos[0].t, s.puntos[s.puntos.length - 1].t];
  const f = (iso: string) => `${dia(iso)} ${horaCorta(iso)}`;
  return `Precio de ${s.activo}, ${NOMBRE_RANGO[s.rango]}, del ${f(a)} al ${f(b)} (${zona(new Date(b))})`;
}

export async function ZonaPrecio({ v }: { v: ValoresPrecio }) {
  const { ahora, s, o } = await cargarPrecio(v.activo, v.rango);
  if (s.status === "rejected") throw s.reason; // lo recoge BloqueConError: "No se pudo cargar la gráfica de precio de …"
  const serie: SeriePrecio = s.value;
  const operaciones: OperacionesPrecio | null = o.status === "fulfilled" ? o.value : null;

  if (serie.primerPunto === null) {
    return (
      <Tarjeta>
        <p className="text-sm">
          Todavía no hay precios registrados de {v.activo}. El ciclo evalúa BTC/USD y SOL/USD cada 30 minutos; la próxima ejecución se
          espera a las {hora(proximaEjecucion(ahora).toISOString())}
        </p>
      </Tarjeta>
    );
  }

  const ultimo = serie.ultimoPunto!;
  const minutos = minutosDesde(ultimo, ahora);
  const atrasado = minutos > ATRASADO_MIN;
  const avisoAtrasado = atrasado ? (
    <Aviso>
      Los precios {serie.puntos.length === 0 ? `de ${v.activo} ` : "de esta gráfica "}llegan hasta {hastaLas(ultimo, ahora)}, {relativo(minutos)}.
      El ciclo no ha registrado velas nuevas
    </Aviso>
  ) : null;

  if (serie.puntos.length === 0) {
    return (
      <Tarjeta className="flex flex-col gap-3">
        {avisoAtrasado}
        <p className="text-sm">
          No hay precios de {v.activo} en {FRASE_RANGO[v.rango]}. El último registrado es de las {hora(ultimo)}
          {dia(ultimo) === dia(ahora.toISOString()) ? "" : ` del ${dia(ultimo)}`}
        </p>
      </Tarjeta>
    );
  }

  const ult = serie.puntos[serie.puntos.length - 1];
  const incompleta = serie.desde !== null && serie.primerPunto > serie.desde;
  return (
    <>
      <div className="flex flex-col gap-1 text-sm text-muted">
        <p>Cierre de velas de 30 min evaluadas por el ciclo · los marcadores son precios reales de llenado</p>
        <p>
          Último punto: {hora(ult.t)} · cierre de la vela de {horaCorta(ult.inicioVela)} a {horaCorta(ult.t)} · {relativo(minutosDesde(ult.t, ahora))}
        </p>
      </div>
      {avisoAtrasado}
      {incompleta ? (
        <p className="rounded-sm border-l-[3px] border-strong bg-sunken px-3 py-2 text-sm">
          Rango: {NOMBRE_RANGO[v.rango]} · Hay datos desde el {diaYHora(serie.primerPunto)} ({zona(new Date(serie.primerPunto))})
        </p>
      ) : null}
      {operaciones === null ? (
        <Aviso>No se pudieron cargar las entradas, las salidas ni los niveles. La gráfica no los muestra; recarga la página para intentar de nuevo</Aviso>
      ) : null}
      <Tarjeta className="p-3 md:p-4">
        <GraficaPrecio serie={serie} operaciones={operaciones} op={v.op} nombre={nombreGrafica(serie)} />
      </Tarjeta>
      <AlternativaTexto serie={serie} operaciones={operaciones} op={v.op} ahora={ahora} />
    </>
  );
}
