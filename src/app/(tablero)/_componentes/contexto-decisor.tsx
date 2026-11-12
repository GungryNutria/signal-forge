import type { ReactNode } from "react";
import { ACTIVOS, type Activo } from "@/core/activos";
import type { ContextoV1 } from "@/core/contexto";
import type { ContextoVista } from "@/server/consultas/tipos";
import { confianza, cripto, hora, horaCorta, momento, momentoUtc, NOMBRE_PROPONENTE, pct, relativo, sentimiento, signo, unidad, usd, usdConSigno } from "../_lib/formato";
import { Chip } from "./chip";
import { Fuente, Rotulo } from "./investigacion";
import { Tarjeta, TituloBloque } from "./tarjeta";

// "Contexto que vio el decisor" (AC-UX-7, AC-UX-9): lo que recibió el agente al decidir, tal como se guardó (`contexto-v1`).
// Agrupado en mercado, investigación, cartera, historial de 24 h y estado. Un dato que falta dice "No disponible", nunca 0.

const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;
const NOMBRE_TRADING = { operando: "Operando", pausa_manual: "Pausa manual", pausa_automatica: "Pausa automática por pérdida diaria" } as const;
const CIERRE = { take_profit: "Cerrada por take profit", stop_loss: "Cerrada por stop loss" } as const;

const NoDisponible = () => <Chip>No disponible</Chip>;
const Grupo = ({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) => (
  <section aria-labelledby={id} className="mt-4 border-t border-line pt-4">
    <h3 id={id} className="mb-2 text-base font-semibold">
      {titulo}
    </h3>
    {children}
  </section>
);
const Lineas = ({ children, etiqueta }: { children: ReactNode; etiqueta?: string }) => (
  <dl aria-label={etiqueta} className="flex flex-col">
    {children}
  </dl>
);
function Linea({ clave, children }: { clave: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 text-[13px] last:border-0">
      <dt className="text-muted">{clave}</dt>
      <dd className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
/** Valor o "No disponible" cuando el dato no está (REQ-4). */
const Dato = <T,>({ v, f }: { v: T | null | undefined; f: (v: T) => ReactNode }) => (v === null || v === undefined ? <NoDisponible /> : <>{f(v)}</>);

/** Margen frente a un tope: la barra solo refuerza; la cifra va en texto. */
function Margen({ clave, usado, tope, texto }: { clave: string; usado: number; tope: number; texto: string }) {
  const frac = tope > 0 ? Math.min(1, Math.max(0, usado / tope)) : 1;
  return (
    <div className="border-b border-line py-1.5 text-[13px] last:border-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-muted">{clave}</span>
        <span className="min-w-0 text-right font-semibold [overflow-wrap:anywhere]">{texto}</span>
      </div>
      <div aria-hidden="true" className="mt-1 h-1.5 rounded-sm bg-sunken">
        <div className="h-full rounded-sm bg-accent" style={{ width: `${Math.round(frac * 100)}%` }} />
      </div>
    </div>
  );
}

type A = ContextoV1["activos"][Activo];

function Mercado({ a, activo }: { a: A; activo: Activo }) {
  const m = a.mercado;
  const conTs = (x: { valor: string; ts: string } | null) => <Dato v={x} f={(d) => `${usd(d.valor)} (${horaCorta(d.ts)})`} />;
  return (
    <div className="mb-3 last:mb-0">
      <h4 className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
        {activo}
        {a.datos === "no_disponibles" ? <NoDisponible /> : null}
      </h4>
      {a.datos === "no_disponibles" ? <p className="mb-1 text-[13px] text-muted">Motivo: {a.motivo_no_disponibles ?? "—"}</p> : null}
      <Lineas etiqueta={`Mercado de ${activo}`}>
        <Linea clave="Último precio">{conTs(m.ultimo_precio)}</Linea>
        <Linea clave="Bid">{conTs(m.bid)}</Linea>
        <Linea clave="Ask">{conTs(m.ask)}</Linea>
        <Linea clave="Spread"><Dato v={m.spread_bps} f={(v) => `${Number(v).toFixed(2)} pb`} /></Linea>
        <Linea clave="Variación 1 h"><Dato v={m.variacion_1h} f={(v) => pct(Number(v) * 100, 2)} /></Linea>
        <Linea clave="Variación 24 h"><Dato v={m.variacion_24h} f={(v) => pct(Number(v) * 100, 2)} /></Linea>
        <Linea clave="Volumen 24 h"><Dato v={m.volumen_24h} f={(v) => cripto(v, unidad(activo))} /></Linea>
        <Linea clave="Volatilidad 24 h"><Dato v={m.volatilidad_24h} f={(v) => pct(Number(v) * 100, 2, false)} /></Linea>
      </Lineas>
      {m.serie_30m.length > 0 ? (
        <details className="mt-2 rounded-sm bg-sunken">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-semibold">
            Serie reciente de precios de {activo} ({m.serie_30m.length} velas de 30 min)
          </summary>
          <div className="max-h-64 overflow-y-auto px-3 pb-2" tabIndex={0} role="region" aria-label={`Serie de precios de ${activo}`}>
            <table className="w-full text-[13px]">
              <caption className="sr-only">Cierre de cada vela de 30 min de {activo}, hora de inicio en Torreón</caption>
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-1 pr-3 font-semibold">Vela de las (UTC−6)</th>
                  <th scope="col" className="py-1 text-right font-semibold">Cierre</th>
                </tr>
              </thead>
              <tbody>
                {m.serie_30m.map((p) => (
                  <tr key={p.t} className="border-t border-line">
                    <td className="py-1 pr-3">{horaCorta(p.t)}</td>
                    <td className="py-1 text-right">{usd(p.c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function InvestigacionLeida({ a, activo }: { a: A; activo: Activo }) {
  const i = a.investigacion;
  return (
    <div className="mb-4 border-t border-line pt-3 first:border-0 first:pt-0 last:mb-0">
      <h4 className="mb-1 text-sm font-semibold">{activo}</h4>
      {i.estado === "sin_investigacion" ? (
        <Chip>Sin investigación</Chip>
      ) : (
        <>
          <p className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            {/* F-5: la antigüedad se mide a la hora del contexto, no a la actual. */}
            <span>
              Última aceptada: {hora(i.recibida_en)}, tenía {i.antiguedad_min} min al armar el contexto
            </span>
            <Chip tono={i.vigente ? "info" : "warn"}>{i.vigente ? "Vigente" : "Vencida"}</Chip>
          </p>
          <Lineas etiqueta={`Investigación de ${activo}`}>
            <Linea clave="Sentimiento">{sentimiento(i.sentimiento)}</Linea>
            <Linea clave="Noticia fuerte">{i.noticia_fuerte ? "Sí" : "No"}</Linea>
            <Linea clave="Confianza">{confianza(i.confianza)}</Linea>
          </Lineas>
          {/* Texto de terceros: literal, completo y sin enlaces (AC-UX-13). */}
          <p className="mt-2 text-sm [overflow-wrap:anywhere] whitespace-pre-line">{i.resumen}</p>
          {i.fuentes.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5" aria-label={`Fuentes de ${activo}`}>
              {i.fuentes.map((u, k) => (
                <Fuente key={`${k}-${u}`} url={u} />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

function Pnl({ usd: v }: { usd: string | null }) {
  return <Dato v={v} f={(x) => <span className={COLOR[signo(x)]}>{usdConSigno(x)}</span>} />;
}

function Cartera({ c, a }: { c: ContextoV1["cartera"]; a: ContextoV1["activos"] }) {
  return (
    <>
      <Lineas etiqueta="Cartera">
        <Linea clave="Saldo virtual">{usd(c.saldo_virtual_usd)}</Linea>
        <Linea clave="Saldo libre">{usd(c.saldo_libre_usd)}</Linea>
        <Linea clave="Exposición total">{usd(c.exposicion_total_usd)}</Linea>
        {ACTIVOS.map((x) => (
          <Linea key={x} clave={`Exposición en ${x}`}>{usd(c.exposicion_por_activo_usd[x])}</Linea>
        ))}
        <Linea clave="PnL del día"><Pnl usd={c.pnl_dia_usd} /></Linea>
      </Lineas>
      <h4 className="mt-3 mb-1 text-[13px] font-semibold text-muted">Entradas abiertas</h4>
      {ACTIVOS.every((x) => a[x].entradas_abiertas.length === 0) ? (
        <p className="text-[13px] text-muted">Sin entradas abiertas.</p>
      ) : (
        <ul className="flex flex-col" aria-label="Entradas abiertas">
          {ACTIVOS.flatMap((x) =>
            a[x].entradas_abiertas.map((e, i) => (
              <li key={`${x}-${i}`} className="flex flex-col gap-0.5 border-b border-line py-1.5 text-[13px] last:border-0">
                <span className="font-semibold">
                  {x} · {NOMBRE_PROPONENTE[e.proponente]} ·{" "}
                  {e.estado === "pendiente_llenado" ? "Pendiente de llenado" : <>entrada <Dato v={e.precio_entrada} f={usd} /></>}
                </span>
                <span className="text-muted">
                  {e.estado === "pendiente_llenado" ? (
                    "Orden viva sin llenar: sin precios ni PnL"
                  ) : (
                    <>
                      Stop loss <Dato v={e.stop_loss} f={usd} /> · Take profit <Dato v={e.take_profit} f={usd} /> · {relativo(e.antiguedad_min)} · PnL no realizado{" "}
                      <Pnl usd={e.pnl_no_realizado_usd} />
                    </>
                  )}
                </span>
              </li>
            )),
          )}
        </ul>
      )}
    </>
  );
}

function Historial({ a }: { a: ContextoV1["activos"] }) {
  const filas = ACTIVOS.flatMap((x) => [
    ...a[x].historial_24h.entradas.map((e) => ({ t: e.t, x, texto: `Entrada de ${NOMBRE_PROPONENTE[e.proponente]} a ${usd(e.precio_entrada)}`, pnl: null as string | null })),
    ...a[x].historial_24h.cierres.map((c) => ({ t: c.t, x, texto: CIERRE[c.motivo], pnl: c.pnl_neto_usd as string | null })),
  ]).sort((p, q) => Date.parse(q.t) - Date.parse(p.t));
  if (filas.length === 0) return <p className="text-[13px] text-muted">Sin entradas ni cierres en las 24 h anteriores.</p>;
  return (
    <ul className="flex flex-col" aria-label="Historial de 24 h">
      {filas.map((h, i) => (
        <li key={i} className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 text-[13px] last:border-0">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {horaCorta(h.t)} · <span className="font-semibold">{h.x}</span> · {h.texto}
          </span>
          {h.pnl === null ? null : (
            <span className="font-semibold">
              <Pnl usd={h.pnl} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Estado({ c }: { c: ContextoV1 }) {
  const { limites: l } = c.estado;
  const tope4 = (Number(c.cartera.saldo_virtual_usd) * Number(l.r4_max_exposicion_pct)) / 100;
  return (
    <>
      <Lineas etiqueta="Estado">
        <Linea clave="Modo de trading">{NOMBRE_TRADING[c.estado.modo_trading]}</Linea>
        <Linea clave="Nocional por entrada">{usd(l.nocional_por_entrada_usd)}</Linea>
        <Linea clave="R3 tamaño máximo">{l.r3_max_nocional_pct} % del saldo</Linea>
      </Lineas>
      <div role="group" aria-label="Márgenes frente a R4, R5 y N">
        <Margen
          clave="R5 entradas del día"
          usado={c.estado.entradas_hoy}
          tope={l.r5_max_entradas_dia}
          texto={`${c.estado.entradas_hoy} de ${l.r5_max_entradas_dia} · margen ${c.estado.margen_entradas_dia}`}
        />
        <Margen
          clave="R4 exposición total"
          usado={Number(c.cartera.exposicion_total_usd)}
          tope={tope4}
          texto={`${usd(c.cartera.exposicion_total_usd)} de ${usd(tope4)} · margen ${usd(c.estado.margen_exposicion_usd)}`}
        />
        {ACTIVOS.map((x) =>
          l.r11_max_entradas_abiertas_por_activo === null ? (
            <Lineas key={x}>
              <Linea clave={`R11 entradas abiertas de ${x}`}><NoDisponible /></Linea>
            </Lineas>
          ) : (
            <Margen
              key={x}
              clave={`R11 entradas abiertas de ${x}`}
              usado={c.activos[x].entradas_abiertas_n}
              tope={l.r11_max_entradas_abiertas_por_activo}
              texto={`${c.activos[x].entradas_abiertas_n} de ${l.r11_max_entradas_abiertas_por_activo} · margen ${c.activos[x].margen_r11 ?? "No disponible"}`}
            />
          ),
        )}
      </div>
    </>
  );
}

function leer(x: unknown): ContextoV1 | null {
  return typeof x === "object" && x !== null && (x as { version?: unknown }).version === "contexto-v1" ? (x as ContextoV1) : null;
}

export function ContextoDelDecisor({ contexto }: { contexto: ContextoVista | null }) {
  const c = contexto ? leer(contexto.contenido) : null;
  return (
    <Tarjeta>
      <TituloBloque>Contexto que vio el decisor</TituloBloque>
      {contexto === null || c === null ? (
        <p className="text-sm text-muted">No disponible: el contexto de esta decisión no se puede mostrar.</p>
      ) : (
        <>
          <p className="text-sm font-semibold">
            Contexto <span className="font-mono text-[13px]">{contexto.id.slice(0, 8)}</span>
          </p>
          <p className="text-[13px] text-muted">
            {momento(contexto.creadoEn)} · {momentoUtc(contexto.creadoEn)} · contexto de {relativo(contexto.antiguedadAlRecibirMin)}
          </p>

          <Grupo id="cx-mercado" titulo="Mercado">
            {ACTIVOS.map((x) => (
              <Mercado key={x} a={c.activos[x]} activo={x} />
            ))}
          </Grupo>

          <section aria-labelledby="cx-investigacion" className="mt-4 rounded-md border border-dashed border-strong p-3">
            <h3 id="cx-investigacion" className="mb-2 text-base font-semibold text-info">
              Investigación
            </h3>
            <Rotulo>Leída por el decisor: forma parte del contexto con el que decidió</Rotulo>
            {ACTIVOS.map((x) => (
              <InvestigacionLeida key={x} a={c.activos[x]} activo={x} />
            ))}
          </section>

          <Grupo id="cx-cartera" titulo="Cartera">
            <Cartera c={c.cartera} a={c.activos} />
          </Grupo>
          <Grupo id="cx-historial" titulo="Historial de 24 h">
            <Historial a={c.activos} />
          </Grupo>
          <Grupo id="cx-estado" titulo="Estado y márgenes">
            <Estado c={c} />
          </Grupo>
        </>
      )}
    </Tarjeta>
  );
}
