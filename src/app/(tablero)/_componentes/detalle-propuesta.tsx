import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { detallePropuesta } from "@/server/consultas/propuestas";
import type { DetallePropuesta, OrdenVista, ReglaDetalle } from "@/server/consultas/tipos";
import { conHora } from "../_lib/datos";
import {
  cripto,
  desgloseR11,
  hora,
  horaConSegundos,
  momento,
  momentoUtc,
  NOMBRE_REGLA,
  pct,
  signo,
  unidad,
  usd,
  usdConSigno,
  valorRegla,
} from "../_lib/formato";
import { esActivo } from "@/core/activos";
import { paramV, vienedeEjecuciones, vienedePrecio, volverAEjecuciones, volverAPrecio, volverAPropuestas, type Params } from "../_lib/params";
import { hrefPrecio, rangoQueIncluye } from "../_lib/precio";
import { Alerta } from "./alerta";
import { Barra, Cargando } from "./esqueleto";
import { ChipDecision, ChipOperacion } from "./estados";
import { Chip } from "./chip";
import { IconoChevron, IconoGrafica } from "./iconos";
import { InvestigacionAdjunta } from "./investigacion-adjunta";
import { leerResultado, ReglaEntrada } from "./regla-entrada";
import { Tarjeta, TituloBloque } from "./tarjeta";

const LADO: Record<string, string> = { buy: "Compra", sell: "Venta" };
const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-semibold text-muted">{etiqueta}</dt>
      <dd className="text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
const Datos = ({ children }: { children: ReactNode }) => (
  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:flex md:flex-wrap md:gap-x-10">{children}</dl>
);
const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-[13px]">{children}</span>;

export const Volver = ({ href, texto }: { href: string; texto: string }) => (
  <Link href={href} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">
    <span className="rotate-180">
      <IconoChevron />
    </span>
    {texto}
  </Link>
);

function tamano(d: DetallePropuesta): string {
  const cantidad = d.cantidad !== null && d.activo ? cripto(d.cantidad, unidad(d.activo)) : null;
  const nocional = d.nocionalUsd !== null ? usd(d.nocionalUsd) : null;
  return [cantidad, nocional].filter(Boolean).join(" · ") || "—";
}

/** REQ-19: solo si la operación abrió posición (hay lote). Lleva a S6 con el rango más corto que la incluye. */
function VerEnGrafica({ d, ahora }: { d: DetallePropuesta; ahora: Date }) {
  if (!d.lote || !esActivo(d.activo)) return null;
  const href = hrefPrecio({ activo: d.activo, rango: rangoQueIncluye(d.lote.abiertoEn, ahora), op: d.id, de: "propuesta" });
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Link
        href={href}
        className="inline-flex min-h-11 w-full items-center gap-2 rounded-sm border-[1.5px] border-accent px-3 text-sm font-semibold text-accent"
      >
        <IconoGrafica />
        <span className="flex-1">Ver en la gráfica</span>
        <IconoChevron />
      </Link>
      <p className="text-xs text-muted">Abre {d.activo} en el rango más corto que incluye esta operación, con la entrada consultada.</p>
    </div>
  );
}

function Cabecera({ d, ahora }: { d: DetallePropuesta; ahora: Date }) {
  const titulo = d.activo ? `${d.activo} · ${LADO[d.lado ?? ""] ?? "—"} · ${tamano(d)}` : "Propuesta inválida";
  return (
    <Tarjeta>
      <h1 className="mb-3 text-2xl leading-[1.25] font-semibold [overflow-wrap:anywhere]">{titulo}</h1>
      <p className="mb-4 flex flex-wrap items-center gap-2">
        <ChipDecision decision={d.decision} />
        {d.estado ? <ChipOperacion estado={d.estado} /> : null}
      </p>
      <Datos>
        <Dato etiqueta="Activo">{d.activo ?? "—"}</Dato>
        <Dato etiqueta="Lado">{LADO[d.lado ?? ""] ?? "—"}</Dato>
        <Dato etiqueta="Tamaño">{tamano(d)}</Dato>
        <Dato etiqueta="Hora">{hora(d.recibidaEn)}</Dato>
      </Datos>
      <VerEnGrafica d={d} ahora={ahora} />
    </Tarjeta>
  );
}

const ESTADO_REGLA: Record<ReglaDetalle["estado"], { texto: string; tono: "pos" | "neg" | "neutro" }> = {
  cumple: { texto: "Cumple", tono: "pos" },
  incumple: { texto: "Incumple", tono: "neg" },
  no_aplica: { texto: "No aplica", tono: "neutro" },
  no_evaluada: { texto: "No evaluada", tono: "neutro" }, // AC-UX-3: texto propio, sin color de resultado
};
const CONJUNTO = { "R1-R10": "R1 a R10", "R1-R11": "R1 a R11" } as const;
const SIN_R11 = "Esta propuesta se evaluó con R1 a R10";
// AC-UX-11: R2 solo aplica a ventas; cuando no aplica, el límite explica por qué.
const limite = (r: ReglaDetalle) =>
  r.regla === "R2" && r.estado === "no_aplica" ? "Solo en ventas: cantidad vendida ≤ posición" : valorRegla(r.limite);
const observado = (r: ReglaDetalle) =>
  r.estado === "no_aplica" || r.estado === "no_evaluada"
    ? "—"
    : r.regla === "R11"
      ? desgloseR11(r.observado, r.limite)
      : valorRegla(r.observado);
const nombre = (r: ReglaDetalle) => (NOMBRE_REGLA[r.regla] ? `${r.regla} ${NOMBRE_REGLA[r.regla]}` : r.regla);

function ReglasRiesgo({ reglas, conjunto }: { reglas: ReglaDetalle[]; conjunto: DetallePropuesta["reglasAplicadas"] }) {
  const fallan = reglas.filter((r) => r.estado === "incumple").length;
  return (
    <Tarjeta>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <TituloBloque className="mb-1">Reglas de riesgo</TituloBloque>
          {conjunto ? <p className="text-sm text-muted">Conjunto aplicado: {CONJUNTO[conjunto]}</p> : null}
        </div>
        {reglas.length > 0 ? (
          <p className="text-sm text-muted">{fallan === 0 ? "Todas cumplen o no aplican" : `${fallan} no se cumplen`}</p>
        ) : null}
      </div>
      {reglas.length === 0 ? (
        <p className="text-sm text-muted">No se evaluaron reglas de riesgo: la propuesta no llegó a ese paso.</p>
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <caption className="sr-only">Reglas de riesgo</caption>
            <thead>
              <tr className="bg-sunken text-[13px] font-semibold">
                <th scope="col" className="px-2 py-2 text-left">Regla</th>
                <th scope="col" className="px-2 py-2 text-left">Resultado</th>
                <th scope="col" className="px-2 py-2 text-left">Valor observado</th>
                <th scope="col" className="px-2 py-2 text-left">Límite</th>
              </tr>
            </thead>
            <tbody>
              {reglas.map((r) => (
                <tr key={r.regla} className="min-h-10 border-b border-line last:border-0">
                  <td className="px-2 py-2">{nombre(r)}</td>
                  <td className="px-2 py-2"><Chip tono={ESTADO_REGLA[r.estado].tono}>{ESTADO_REGLA[r.estado].texto}</Chip></td>
                  {r.estado === "no_evaluada" ? (
                    <td colSpan={2} className="px-2 py-2 text-muted">{SIN_R11}</td>
                  ) : (
                    <>
                      <td className="px-2 py-2">{observado(r)}</td>
                      <td className="px-2 py-2">{limite(r)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="flex flex-col md:hidden" aria-label="Reglas de riesgo">
            {reglas.map((r) => (
              <li key={r.regla} className="flex flex-col gap-1 border-b border-line py-3 text-sm last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{nombre(r)}</span>
                  <Chip tono={ESTADO_REGLA[r.estado].tono}>{ESTADO_REGLA[r.estado].texto}</Chip>
                </div>
                {r.estado === "no_evaluada" ? (
                  <p className="text-muted">{SIN_R11}</p>
                ) : (
                  <>
                    <p className="text-muted">Observado: {observado(r)}</p>
                    <p className="text-muted">Límite: {limite(r)}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Tarjeta>
  );
}

function texto(v: unknown): string | null {
  return typeof v === "string" || typeof v === "number" ? String(v) : null;
}
/** `{ status, cuerpo: { code, message } }` de la respuesta cruda del broker (la de una orden rechazada). */
function codigoYMensaje(r: unknown): string | null {
  if (typeof r !== "object" || r === null) return null;
  const c = (r as Record<string, unknown>).cuerpo;
  if (typeof c !== "object" || c === null) return null;
  const [codigo, mensaje] = [texto((c as Record<string, unknown>).code), texto((c as Record<string, unknown>).message)];
  return [codigo ? `Código ${codigo}` : null, mensaje].filter(Boolean).join(": ") || null;
}

const RESPUESTA: Record<string, string> = {
  rechazada: "Orden rechazada por el broker",
  cancelada: "Orden cancelada por el broker",
  no_enviada: "La orden no llegó al broker",
  desconocido: "El broker no confirmó el estado de la orden",
  llenada: "Orden aceptada y llenada",
  parcial: "Orden llenada parcialmente",
  aceptada: "Orden aceptada, sin llenar todavía",
  enviada: "Orden enviada, sin respuesta todavía",
  pendiente_envio: "Orden pendiente de envío",
};
const SIN_POSICION = new Set(["rechazada", "cancelada", "no_enviada"]);

function RespuestaBroker({ d }: { d: DetallePropuesta }) {
  const entrada: OrdenVista | undefined = d.ordenes.find((o) => o.tramo === "entrada");
  const ejecutada = d.decision === "ejecutada";
  // Una ejecutada sin orden registrada nunca llegó al broker (plan T-10); las demás decisiones no envían orden.
  const estado = ejecutada ? (entrada?.estado ?? "no_enviada") : null;
  const ultimo = entrada?.eventos.at(-1);
  const respuesta = estado ? (RESPUESTA[estado] ?? estado) : "No se envió ninguna orden al broker: la propuesta no fue ejecutada.";
  const detalle = codigoYMensaje(entrada?.respuestaBroker) ?? ultimo?.detalle ?? null;
  const sinPosicion = estado !== null && SIN_POSICION.has(estado);

  return (
    <Tarjeta>
      <TituloBloque>Respuesta del broker</TituloBloque>
      <Datos>
        <Dato etiqueta="Respuesta">{respuesta}</Dato>
        {estado === "llenada" && d.lote ? (
          <Dato etiqueta="Llenada">
            {horaConSegundos(d.lote.abiertoEn)} a {usd(d.lote.precioEntrada)}
          </Dato>
        ) : null}
        {detalle && detalle !== respuesta ? <Dato etiqueta="Motivo">{detalle}</Dato> : null}
        {ejecutada ? (
          <Dato etiqueta="Id de orden">
            {entrada && estado !== "no_enviada" ? <Mono>{entrada.clientOrderId}</Mono> : "—"}
          </Dato>
        ) : null}
      </Datos>
      {sinPosicion ? (
        <ul className="mt-3">
          <Alerta tono="warn">No se abrió posición. Esta propuesta no tiene PnL.</Alerta>
        </ul>
      ) : null}
    </Tarjeta>
  );
}

const CIERRE = { take_profit: "Take profit", stop_loss: "Stop loss" } as const;

type SalidaVista = NonNullable<DetallePropuesta["salida"]>;

/** Renglón del desglose: USD y % con su signo, en tinta neutra (AC-UX-9). Cada % sobre su propia base (D-6). */
function Renglon({ nombre, usd: u, frac, nota, fuerte = false }: { nombre: string; usd: string; frac: string; nota?: string; fuerte?: boolean }) {
  const valor = `${usdConSigno(u)} · ${pct(Number(frac) * 100, 2)}`;
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line py-2 last:border-0 ${fuerte ? "font-semibold" : ""}`}>
      <dt className="min-w-0 [overflow-wrap:anywhere]">
        {nombre}
        {nota ? <span className="font-normal text-muted"> ({nota})</span> : null}
      </dt>
      <dd className={`[overflow-wrap:anywhere] ${fuerte ? COLOR[signo(u)] : ""}`}>{valor}</dd>
    </div>
  );
}

/** REQ-19, AC-UX-8: lo que pasó entre el nivel y el llenado, en este orden. Solo para lotes cerrados por SL o TP. */
function Salida({ s }: { s: SalidaVista }) {
  return (
    <Tarjeta>
      <TituloBloque>Salida de la operación</TituloBloque>
      <Datos>
        <Dato etiqueta={`Nivel tocado: ${CIERRE[s.motivo]}`}>{usd(s.nivel)}</Dato>
        <Dato etiqueta="Precio que disparó la salida">
          {s.precioDisparo && s.precioDisparoEn ? (
            <>
              {usd(s.precioDisparo)} · {momento(s.precioDisparoEn)} · {momentoUtc(s.precioDisparoEn)}
            </>
          ) : (
            "No registrado: el cierre es anterior a esta medición"
          )}
        </Dato>
        <Dato etiqueta="Precio de llenado">{usd(s.precioLlenado)}</Dato>
      </Datos>
      <h3 className="mt-4 mb-1 text-[13px] font-semibold text-muted">Desglose del PnL neto</h3>
      <dl className="text-sm" aria-label="Desglose del PnL neto">
        <Renglon nombre="Movimiento hasta el nivel" usd={s.movimientoUsd} frac={s.movimientoPct} />
        <Renglon nombre="Deslizamiento de precio" nota="sin comisiones" usd={s.deslizamientoUsd} frac={s.deslizamientoPct} />
        <Renglon nombre="Comisión modelada" nota="entrada y salida" usd={s.comisionUsd} frac={s.comisionPct} />
        <Renglon nombre="PnL neto" usd={s.pnlNetoUsd} frac={s.pnlNetoPct} fuerte />
      </dl>
    </Tarjeta>
  );
}

function Etiqueta({ d }: { d: DetallePropuesta }) {
  const e = d.etiqueta;
  return (
    <Tarjeta>
      <TituloBloque>Etiqueta de resultado</TituloBloque>
      {e.estado === "pendiente" ? (
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <Chip>Pendiente</Chip>
          <span className="text-muted">Se define cuando se cierra la posición.</span>
        </p>
      ) : e.estado === "no_aplica" ? (
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <Chip>No aplica</Chip>
          <span className="text-muted">Esta propuesta no abrió una posición, así que no tiene resultado ni PnL.</span>
        </p>
      ) : (
        <>
          <p className="mb-3">
            <Chip tono={e.exito === 1 ? "pos" : "neutro"}>{e.exito === 1 ? "Acierto" : "No acierto"}</Chip>
          </p>
          <Datos>
            {e.motivoCierre ? <Dato etiqueta="Cierre por">{CIERRE[e.motivoCierre]}</Dato> : null}
            {e.cerradoEn ? <Dato etiqueta="Cerrada">{momento(e.cerradoEn)}</Dato> : null}
            {e.precioSalida ? <Dato etiqueta="Precio de salida">{usd(e.precioSalida)}</Dato> : null}
            {e.pnlNetoUsd !== null ? (
              <Dato etiqueta="PnL neto">
                <span className={COLOR[signo(e.pnlNetoUsd)]}>
                  {usdConSigno(e.pnlNetoUsd)}
                  {e.pnlNetoPct !== null ? ` (${pct(e.pnlNetoPct, 2)})` : ""}
                </span>
              </Dato>
            ) : null}
            {e.duracionMin !== null ? <Dato etiqueta="Duración">{e.duracionMin} min</Dato> : null}
          </Datos>
        </>
      )}
    </Tarjeta>
  );
}

function Ejecucion({ d }: { d: DetallePropuesta }) {
  return (
    <Tarjeta>
      <TituloBloque>Ejecución del ciclo</TituloBloque>
      <Datos>
        <Dato etiqueta="Id de la ejecución">
          {d.ejecucion ? (
            d.activo ? (
              <Link
                href={`/ejecuciones/${d.ejecucion.id}/${d.activo.replace("/", "-")}`}
                className="inline-flex min-h-11 items-center text-accent underline underline-offset-2 md:min-h-0"
              >
                <Mono>{d.ejecucion.id}</Mono>
                <span className="sr-only"> (ver la evaluación en Ejecuciones)</span>
              </Link>
            ) : (
              <Mono>{d.ejecucion.id}</Mono>
            )
          ) : (
            "—"
          )}
        </Dato>
        <Dato etiqueta="Recibida (Torreón)">{momento(d.recibidaEn)}</Dato>
        <Dato etiqueta="Recibida (UTC)">{momentoUtc(d.recibidaEn)}</Dato>
        <Dato etiqueta="Versión de la regla"><Mono>{d.versionRegla ?? "—"}</Mono></Dato>
      </Datos>
    </Tarjeta>
  );
}

export async function DetallePropuestaVista({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  const sp = await searchParams;
  const v = paramV(sp);
  const deEjecuciones = vienedeEjecuciones(sp);
  const dePrecio = vienedePrecio(sp);
  const { ahora, datos: d } = await conHora(() => detallePropuesta(id))();
  if (d === null) notFound();

  const regla = typeof d.reglaEntrada === "object" && d.reglaEntrada !== null ? (d.reglaEntrada as Record<string, unknown>) : null;
  return (
    <div className="flex flex-col gap-6">
      <Volver
        href={dePrecio ? `/precio${volverAPrecio(v)}` : deEjecuciones ? `/ejecuciones${volverAEjecuciones(v)}` : `/propuestas${volverAPropuestas(v)}`}
        texto={dePrecio ? "Precio" : deEjecuciones ? "Ejecuciones" : "Propuestas"}
      />
      <Cabecera d={d} ahora={ahora} />
      <ReglaEntrada
        version={d.versionRegla}
        resultado={leerResultado(regla?.resultado)}
        sinDatos="Esta propuesta no trae una regla de entrada evaluada."
      />
      <ReglasRiesgo reglas={d.reglas} conjunto={d.reglasAplicadas} />
      <RespuestaBroker d={d} />
      {d.salida ? <Salida s={d.salida} /> : null}
      <Etiqueta d={d} />
      <InvestigacionAdjunta activo={d.activo} inv={d.investigacion} />
      <Ejecucion d={d} />
    </div>
  );
}

export function DetalleEsqueleto({ etiqueta }: { etiqueta: string }) {
  return (
    <Cargando etiqueta={etiqueta}>
      <div className="flex flex-col gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
            <Barra ancho="w-1/3" alto="h-6" />
            <Barra ancho="w-2/3" />
            <Barra ancho="w-1/2" />
          </div>
        ))}
      </div>
    </Cargando>
  );
}
