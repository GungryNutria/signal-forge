import Link from "next/link";
import type { ReactNode } from "react";
import { ACTIVOS } from "@/core/activos";
import type { EstadoSistema } from "@/server/consultas/tipos";
import { estado } from "../_lib/datos";
import { dia, enUtc, hora, horaConSegundos, horaCorta, lineaDeModos, minutosDesde, NOMBRE_MODO, pct, rangoRanura, relativo, usdConSigno } from "../_lib/formato";
import { Alerta } from "./alerta";
import { Chip } from "./chip";
import { Barra, Cargando } from "./esqueleto";
import { ChipOmitida, ChipRanura, ChipResultado, ChipResultadoDecisor, esOmitida } from "./estados";
import { IconoChevron } from "./iconos";
import { BandaPlegable } from "./banda-plegable";
import { Tarjeta } from "./tarjeta";

const Etiqueta = ({ children }: { children: ReactNode }) => (
  <h2 className="mb-1.5 text-[13px] leading-[1.3] font-semibold text-muted">{children}</h2>
);

function ChipModo({ modo }: { modo: EstadoSistema["modo"] }) {
  if (modo === "pausa_manual") return <Chip tono="warn">Pausa manual</Chip>;
  if (modo === "pausa_automatica") return <Chip tono="neg">Pausa automática por pérdida diaria</Chip>;
  return (
    <Chip tono="pos" punto>
      Operando
    </Chip>
  );
}

type AlertaVista = { clave: string; tono: "neg" | "warn"; contenido: ReactNode };

/** Alertas activas, las de severidad `neg` primero. Todas son texto: sin botones (AC-UX-21). */
function alertas(e: EstadoSistema, ahora: Date): AlertaVista[] {
  const lista: AlertaVista[] = [];
  if (e.pausaAutomatica) {
    const p = e.pausaAutomatica;
    lista.push({
      clave: "pausa-automatica",
      tono: "neg",
      contenido: `PnL del día ${usdConSigno(p.pnlDiaUsd)} (${pct(p.pnlDiaPct, 2)}) / límite ${usdConSigno(p.limiteUsd)} (${pct(p.limitePct, 2)}). Se levanta sola a las ${hora(p.seLevantaEn)}, ${enUtc(p.seLevantaEn)}. El stop loss y el take profit siguen activos`,
    });
  }
  if (e.cicloDetenido) {
    lista.push({
      clave: "ciclo-detenido",
      tono: e.cicloDetenido.severidad,
      contenido: `El ciclo no corre desde ${hora(e.cicloDetenido.desde)} · ${relativo(minutosDesde(e.cicloDetenido.desde, ahora))}`,
    });
  }
  if (e.broker.desactualizado) {
    lista.push({
      clave: "broker",
      tono: "neg",
      contenido: `${e.broker.leidoEn ? `El broker no responde desde ${hora(e.broker.leidoEn)}.` : "El broker no responde."} Los valores que dependen de él no están actualizados`,
    });
  }
  if (e.modos === null) {
    lista.push({
      clave: "modos-invalidos",
      tono: "neg",
      contenido:
        "Los modos de los proponentes no son válidos. No se ejecuta ninguna propuesta hasta corregir la configuración del despliegue",
    });
  } else if (e.modos.ciclo.motivo === "dos_proponentes_en_ejecuta") {
    lista.push({
      clave: "dos-proponentes",
      tono: "neg",
      contenido:
        "Configuración inválida: el ciclo y el decisor están en Ejecuta. No se ejecuta ninguna propuesta hasta corregir la configuración del despliegue",
    });
  } else if (e.modos.decisor.motivo === "r11_no_vigente") {
    lista.push({
      clave: "r11-no-vigente",
      tono: "warn",
      contenido:
        "El decisor está configurado en Ejecuta, pero opera en Solo registra porque R11 no está en vigor. Se corrige en la configuración del despliegue",
    });
  }
  for (const a of e.decisor.alertas) {
    const desde = a.desde ?? e.decisor.activacion;
    lista.push({
      clave: `decisor-${a.activo}`,
      tono: a.severidad,
      contenido: a.desde
        ? `${a.activo}: sin decisión válida del decisor desde ${hora(a.desde)} · ${relativo(minutosDesde(a.desde, ahora))}`
        : `${a.activo}: sin decisión válida del decisor desde su activación${desde ? ` (${dia(desde)} ${horaCorta(desde)})` : ""}`,
    });
  }
  if (e.modo === "pausa_manual") {
    lista.push({
      clave: "pausa-manual",
      tono: "warn",
      contenido:
        "El ciclo sigue corriendo y registrándose, pero sus propuestas se rechazan. Se levanta en la configuración del despliegue",
    });
  }
  // Sin ninguna ejecución es el primer día (estado vacío): "sin investigación" todavía no es una alerta.
  const primerDia = e.ultimaEjecucion === null;
  for (const a of ACTIVOS) {
    const inv = e.investigacionPorActivo[a];
    if (inv === null && !primerDia) {
      lista.push({ clave: `inv-${a}`, tono: "warn", contenido: `${a}: sin investigación aceptada` });
    } else if (inv?.alerta) {
      lista.push({ clave: `inv-${a}`, tono: "warn", contenido: `${a}: sin investigación aceptada desde ${hora(inv.recibidaEn)}` });
    }
  }
  for (const o of e.ordenesDesconocidas) {
    lista.push({
      clave: `orden-${o.ordenId}`,
      tono: "warn",
      contenido: (
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span>{o.activo}: nuevas propuestas bloqueadas hasta reconciliar la orden</span>
          {o.propuestaId ? (
            <Link
              href={`/propuestas/${o.propuestaId}`}
              className="inline-flex min-h-11 items-center gap-0.5 text-accent underline underline-offset-2 md:min-h-0"
            >
              Ver orden
              <IconoChevron />
            </Link>
          ) : null}
        </span>
      ),
    });
  }
  return lista.sort((a, b) => Number(b.tono === "neg") - Number(a.tono === "neg"));
}

function GrupoDecisor({ e, ahora }: { e: EstadoSistema; ahora: Date }) {
  const modo = e.modos?.decisor.efectivo ?? null;
  const u = e.decisor.ultimaRanura;
  return (
    <section
      aria-label="Decisor, última ranura"
      className="relative order-2 border-t border-line pt-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent lg:order-3 lg:border-0 lg:pt-0"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="text-[13px] leading-[1.3] font-semibold text-muted">Decisor · última ranura</h2>
        <span className="flex items-center gap-1">
          {u ? <ChipRanura estado={u.estado} /> : null}
          <Link
            href="/ejecuciones?vista=decisor"
            className="inline-flex text-accent outline-none after:absolute after:inset-0"
          >
            <IconoChevron />
            <span className="sr-only">Ver el historial del decisor</span>
          </Link>
        </span>
      </div>
      {modo === null ? (
        <p className="text-sm">Decisor: modo no disponible</p>
      ) : modo === "apagado" ? (
        <>
          <p className="text-sm">Decisor: {NOMBRE_MODO.apagado}</p>
          <p className="text-xs text-muted">Se activa en la configuración del despliegue</p>
        </>
      ) : u === null ? (
        <p className="text-sm">
          Decisor: {NOMBRE_MODO[modo]} · sin ranuras todavía. Corre cada hora en el minuto 45; la próxima ranura empieza a las{" "}
          {hora(e.decisor.proximaRanura)}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {rangoRanura(u.ranura)}{" "}
            <span className="text-xs text-muted">· {u.enCurso ? "en curso" : `terminó ${relativo(minutosDesde(u.fin, ahora))}`}</span>
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {ACTIVOS.map((a) => (
              <li key={a} className="flex items-center gap-2 text-sm">
                <span className="font-semibold">{a}</span>
                <ChipResultadoDecisor r={u.porActivo[a]} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export async function Banda() {
  const { ahora, datos: e } = await estado();
  const ult = e.ultimaEjecucion;
  const avisos = alertas(e, ahora);
  const sinInvestigacion = ACTIVOS.every((a) => e.investigacionPorActivo[a] === null);

  const cicloApagado = e.modos?.ciclo.efectivo === "apagado";

  return (
    <Tarjeta className="relative px-4 py-4">
      <div className="grid grid-cols-1 gap-y-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,0.6fr)] lg:gap-x-4">
        <section aria-label="Modo de trading" className="order-1">
          <h2 className="sr-only text-[13px] leading-[1.3] font-semibold text-muted lg:not-sr-only lg:mb-1.5 lg:block">Modo</h2>
          <div className="max-w-[calc(100%-12rem)] lg:max-w-none">
            <ChipModo modo={e.modo} />
          </div>
          <p className="mt-1.5 text-[13px] [overflow-wrap:anywhere]">
            {e.modos ? lineaDeModos(e.modos.ciclo, e.modos.decisor) : "Ejecuta: ninguno"}
          </p>
        </section>

        <section aria-label="Datos" className="absolute top-4 right-4 text-right lg:static lg:order-5 lg:text-left">
          <h2 className="inline text-xs text-muted lg:mb-1.5 lg:block lg:text-[13px] lg:leading-[1.3] lg:font-semibold">Datos de las</h2>{" "}
          <p className="inline text-xs lg:block lg:text-sm">{horaConSegundos(ahora.toISOString())}</p>
          <p className="hidden text-xs text-muted lg:block">{dia(ahora.toISOString())}</p>
        </section>

        <GrupoDecisor e={e} ahora={ahora} />

        <section
          aria-label="Última ejecución del ciclo"
          className="relative order-3 border-t border-line pt-3 lg:order-2 lg:border-0 lg:pt-0"
        >
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <h2 className="text-[13px] leading-[1.3] font-semibold text-muted">Última ejecución del ciclo</h2>
            <Link
              href="/ejecuciones"
              className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-accent after:absolute after:inset-0"
            >
              <span className="lg:sr-only">Ver ejecuciones</span>
              <IconoChevron />
            </Link>
          </div>
          {cicloApagado ? (
            <p className="text-sm">Ciclo: {NOMBRE_MODO.apagado}. Se enciende en la configuración del despliegue</p>
          ) : ult ? (
            <>
              <p className="text-sm">
                {hora(ult.inicio)} <span className="text-xs text-muted">· {relativo(minutosDesde(ult.inicio, ahora))}</span>
              </p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {esOmitida(ult.estado) ? (
                  <li>
                    <ChipOmitida />
                  </li>
                ) : (
                  ACTIVOS.map((a) => (
                    <li key={a} className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">{a}</span>
                      <ChipResultado r={ult.porActivo[a]} />
                    </li>
                  ))
                )}
              </ul>
            </>
          ) : (
            <p className="text-sm">El ciclo aún no tiene ejecuciones registradas.</p>
          )}
        </section>

        <section
          aria-label="Última investigación por activo"
          className="order-4 border-t border-line pt-3 lg:border-0 lg:pt-0"
        >
          <Etiqueta>Investigación (UTC−6)</Etiqueta>
          {sinInvestigacion && ult === null ? (
            <p className="text-sm">Aún no llega ninguna investigación.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {ACTIVOS.map((a) => {
                const inv = e.investigacionPorActivo[a];
                return (
                  <li key={a} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-semibold">{a}</span>
                    {inv ? (
                      <>
                        <span>{horaCorta(inv.recibidaEn)}</span>
                        <span className="text-xs text-muted">{relativo(inv.antiguedadMin)}</span>
                        <Chip tono={inv.vigente ? "info" : "warn"}>{inv.vigente ? "Vigente" : "Vencida"}</Chip>
                      </>
                    ) : (
                      <Chip>Sin investigación</Chip>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {avisos.length > 0 ? (
        <ul aria-label="Alertas" className="mt-4 flex flex-col gap-2">
          {avisos.map((a) => (
            <Alerta key={a.clave} tono={a.tono}>
              {a.contenido}
            </Alerta>
          ))}
        </ul>
      ) : null}
    </Tarjeta>
  );
}

/**
 * La banda de siempre; en S6 móvil va plegada tras una línea (D-5). Si algo de la banda completa está en aviso o error, la
 * línea lo dice con el mismo color, icono y texto del estado más grave (nunca solo un punto de color).
 */
export async function BandaConResumen() {
  const { ahora, datos: e } = await estado();
  const lista = alertas(e, ahora);
  const ult = e.ultimaEjecucion;
  if (ult && !esOmitida(ult.estado) && (ult.estado === "error" || ACTIVOS.some((a) => ult.porActivo[a]?.resultado === "error"))) {
    lista.push({ clave: "ejecucion-error", tono: "warn", contenido: "La última ejecución del ciclo terminó con error" });
  }
  for (const a of ACTIVOS) {
    const inv = e.investigacionPorActivo[a];
    if (inv && !inv.vigente && !inv.alerta) lista.push({ clave: `inv-vencida-${a}`, tono: "warn", contenido: `${a}: la investigación aceptada ya no está vigente` });
  }
  const [grave, ...resto] = lista;
  return (
    <BandaPlegable
      linea={
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <ChipModo modo={e.modo} />
          <span className="text-sm">Datos de las {hora(ahora.toISOString())}</span>
        </span>
      }
      avisos={
        grave ? (
          <ul aria-label="Alertas" className="mt-2 flex flex-col gap-2">
            <Alerta tono={grave.tono}>{grave.contenido}</Alerta>
            {resto.length > 0 ? <li className="px-1 text-xs text-muted">y {resto.length} {resto.length === 1 ? "aviso más" : "avisos más"} en la banda completa</li> : null}
          </ul>
        ) : null
      }
    >
      <Banda />
    </BandaPlegable>
  );
}

export function BandaEsqueleto() {
  return (
    <Tarjeta className="px-4 py-4">
      <Cargando etiqueta="la banda de estado">
        <div className="grid grid-cols-1 gap-y-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,0.6fr)] lg:gap-x-4">
          <div className="flex flex-col gap-2">
            <Barra ancho="w-36" alto="h-6" />
            <Barra ancho="w-3/4" />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Barra ancho="w-28" />
              <Barra ancho="w-3/4" />
              <Barra ancho="w-full" alto="h-6" />
            </div>
          ))}
          <div className="hidden flex-col gap-2 lg:flex">
            <Barra ancho="w-20" />
            <Barra ancho="w-28" />
          </div>
        </div>
      </Cargando>
    </Tarjeta>
  );
}
