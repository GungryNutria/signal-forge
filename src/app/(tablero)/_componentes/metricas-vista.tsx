import type { ReactNode } from "react";
import { proximaEjecucion, proximaInvestigacion } from "@/core/tiempo";
import { metricas } from "@/server/consultas/metricas";
import type { Metricas } from "@/server/consultas/tipos";
import { cartera, conHora } from "../_lib/datos";
import { dia, diaYHora, hora, motivo, NOMBRE_REGLA, pct, signo, usd, usdConSigno, zona } from "../_lib/formato";
import { leerActivo, type Params } from "../_lib/params";
import { BloqueConError } from "./bloque";
import { Barra, Cargando } from "./esqueleto";
import { GrupoChips } from "./filtros";
import { CurvaSaldo, PnlDiario } from "./graficas";
import { Tarjeta } from "./tarjeta";

const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;

/** Etiqueta de ámbito (AC-UX-17, 18): `gap-2` entre etiquetas juntas. */
const Ambito = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex min-h-5 items-center rounded-sm border border-strong px-2 text-xs leading-[1.3]">{children}</span>
);
const Ambitos = ({ children }: { children: ReactNode }) => <p className="flex flex-wrap gap-2">{children}</p>;

function Kpi({ etiqueta, valor, detalle, ambitos }: { etiqueta: string; valor: ReactNode; detalle: ReactNode[]; ambitos: ReactNode }) {
  return (
    <Tarjeta className="flex flex-col gap-1.5">
      <h3 className="text-[13px] leading-[1.3] font-semibold text-muted">{etiqueta}</h3>
      <p className="text-2xl leading-[1.2] font-semibold">{valor}</p>
      {detalle.map((d, i) => (
        <p key={i} className="text-xs text-muted">
          {d}
        </p>
      ))}
      <Ambitos>{ambitos}</Ambitos>
    </Tarjeta>
  );
}

/** `del 1 al 6 nov`, `el 6 nov`. Las fechas son días UTC (`YYYY-MM-DD`): se fijan a mediodía UTC para no correr de día. */
function periodo(desde: string, hasta: string): string {
  const [a, b] = [dia(`${desde}T12:00:00Z`), dia(`${hasta}T12:00:00Z`)];
  return a === b ? `el ${a}` : `del ${a} al ${b}`;
}

const SinDatos = ({ children }: { children: ReactNode }) => (
  <div>
    <p className="text-base font-semibold">Sin datos suficientes</p>
    <p className="text-sm text-muted">{children}</p>
  </div>
);

/** Tabla solo para lectores de pantalla: los valores de cada punto, también sin ver la gráfica. */
function TablaTexto({ titulo, filas }: { titulo: string; filas: [string, string][] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{titulo}</caption>
        <tbody>
          {filas.map(([a, b], i) => (
            <tr key={i}>
              <th scope="row">{a}</th>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rechazadas por motivo (AC-UX-4). R11 va siempre: con su conteo, o "No evaluada en este periodo" si ninguna propuesta se evaluó con ella. */
function RechazosPorMotivo({ m }: { m: Metricas }) {
  const filas = m.porMotivo.filter((f) => f.motivo !== "R11" && f.n > 0).map((f) => ({ ...f, nombre: NOMBRE_REGLA[f.motivo] ? `${f.motivo} ${NOMBRE_REGLA[f.motivo]}` : motivo(f.motivo) }));
  const r11 = m.porMotivo.find((f) => f.motivo === "R11")?.n ?? 0;
  const nombreR11 = `R11 ${NOMBRE_REGLA.R11}`;
  return (
    <div className="mt-4" data-rechazos-por-motivo>
      <h3 className="mb-1 text-[13px] font-semibold text-muted">Rechazadas por motivo</h3>
      <ul className="text-sm">
        {filas.map((f) => (
          <li key={f.motivo} className="flex flex-wrap justify-between gap-x-4 border-b border-line py-1.5">
            <span>{f.nombre}</span>
            <span className="font-semibold">{f.n}</span>
          </li>
        ))}
        <li className="flex flex-wrap justify-between gap-x-4 py-1.5">
          <span>{nombreR11}</span>
          {m.r11Evaluadas === 0 ? <span className="text-muted">No evaluada en este periodo</span> : <span className="font-semibold">{r11}</span>}
        </li>
      </ul>
    </div>
  );
}

function Contenido({ m, activo, inicial, ahora }: { m: Metricas; activo: string | undefined; inicial: number; ahora: Date }) {
  const filtro = `Sigue el filtro: ${activo ?? "Todos"}`;
  const total = m.aprobadas + m.rechazadas;
  const sinCierres = m.tasaAciertos === null;

  if (m.curvaSaldo.length === 0 && total === 0 && !activo) {
    return (
      <Tarjeta>
        <p className="text-sm">
          Aún no hay datos. Saldo inicial: {usd(inicial)}. El ciclo evalúa BTC/USD y SOL/USD cada 30 minutos; la próxima ejecución
          se espera a las {hora(proximaEjecucion(ahora).toISOString())}. La investigación llega cada hora; la próxima, a las{" "}
          {hora(proximaInvestigacion(ahora).toISOString())}
        </p>
        <h3 className="mt-4 text-[13px] font-semibold text-muted">Tasa de aciertos</h3>
        <p className="text-2xl font-semibold">—</p>
        <p className="text-xs text-muted">0 entradas cerradas</p>
      </Tarjeta>
    );
  }

  const dias = m.pnlDiario.map((d) => d.diaUtc);
  const rango = dias.length > 0 ? periodo(dias[0], dias[dias.length - 1]) : null;
  const pnl = Number(m.pnlAcumuladoUsd);
  const dd = m.drawdownMax;

  const saldos = m.curvaSaldo.map((c) => Number(c.saldoUsd));
  const puntos = m.curvaSaldo.map((c, i) => {
    const saldo = saldos[i];
    const cambio = saldo - (i === 0 ? inicial : saldos[i - 1]);
    return {
      etiqueta: `${diaYHora(c.t)} (${zona(new Date(c.t))})`,
      eje: dia(c.t),
      saldo,
      texto: `Saldo ${usd(saldo)} · ${usdConSigno(cambio)}`,
    };
  });
  const barras = m.pnlDiario.map((d) => ({
    etiqueta: `${dia(`${d.diaUtc}T12:00:00Z`)} (día UTC)`,
    eje: dia(`${d.diaUtc}T12:00:00Z`),
    pnl: Number(d.pnlUsd),
    texto: Number(d.pnlUsd) === 0 ? "0.00" : usdConSigno(d.pnlUsd).replace(" USD", ""),
    detalle: `PnL del día ${usdConSigno(d.pnlUsd)}`,
  }));
  const pctAprobadas = total === 0 ? 0 : (m.aprobadas * 100) / total;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        <Kpi
          etiqueta="PnL realizado"
          valor={
            sinCierres ? (
              "—"
            ) : (
              <span className={COLOR[signo(pnl)]}>{usdConSigno(pnl)}</span>
            )
          }
          detalle={
            sinCierres
              ? ["0 entradas cerradas"]
              : [`${pct((pnl * 100) / inicial, 2)} del saldo inicial${rango ? `, ${rango}` : ""}`, "día UTC"]
          }
          ambitos={<Ambito>{filtro}</Ambito>}
        />
        <Kpi
          etiqueta="Tasa de aciertos"
          valor={m.tasaAciertos ? pct(m.tasaAciertos.pct, 1, false) : "—"}
          detalle={[
            m.tasaAciertos
              ? `${m.tasaAciertos.aciertos} de ${m.tasaAciertos.cerradas} entradas cerradas`
              : "0 entradas cerradas",
          ]}
          ambitos={<Ambito>{filtro}</Ambito>}
        />
        <Kpi
          etiqueta="Drawdown máximo"
          valor={dd ? <span className={Number(dd.pct) < 0 ? "text-neg" : ""}>{pct(dd.pct, 2)}</span> : "—"}
          detalle={[
            dd === null
              ? "Sin entradas cerradas todavía"
              : dd.desde && dd.hasta
                ? dia(dd.desde) === dia(dd.hasta)
                  ? `el ${dia(dd.hasta)}`
                  : `del ${dia(dd.desde)} al ${dia(dd.hasta)}`
                : "La curva no ha caído bajo su pico",
            "sobre saldo realizado",
          ]}
          ambitos={<Ambito>cartera global</Ambito>}
        />
        <Kpi
          etiqueta="Aprobadas y rechazadas"
          valor={total === 0 ? "—" : `${m.aprobadas} / ${m.rechazadas}`}
          detalle={[
            `${m.aprobadas} aprobadas, ${m.rechazadas} rechazadas`,
            total === 1 ? "de 1 propuesta" : `de ${total} propuestas`,
          ]}
          ambitos={<Ambito>{filtro}</Ambito>}
        />
      </div>

      <Tarjeta>
        <h2 className="mb-2 text-xl leading-[1.3] font-semibold">Curva de saldo</h2>
        <div className="mb-3">
          <Ambitos>
            <Ambito>sobre saldo realizado</Ambito>
            <Ambito>cartera global</Ambito>
          </Ambitos>
        </div>
        {puntos.length < 2 ? (
          <SinDatos>Se necesitan al menos 2 cierres con saldo realizado para dibujar la curva.</SinDatos>
        ) : (
          <>
            <CurvaSaldo
              nombre="Curva de saldo realizado de la cartera global"
              puntos={puntos.map((p) => ({ eje: p.eje, titulo: p.etiqueta, saldo: p.saldo, detalle: p.texto }))}
            />
            <TablaTexto titulo="Saldo tras cada cierre" filas={puntos.map((p) => [p.etiqueta, p.texto])} />
          </>
        )}
      </Tarjeta>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Tarjeta>
          <h2 className="mb-2 text-xl leading-[1.3] font-semibold">PnL diario</h2>
          <div className="mb-3">
            <Ambitos>
              <Ambito>día UTC</Ambito>
              <Ambito>{filtro}</Ambito>
            </Ambitos>
          </div>
          {barras.length === 0 ? (
            <SinDatos>Aparece con el primer cierre.</SinDatos>
          ) : (
            <>
              <PnlDiario nombre="PnL diario por día UTC" barras={barras.map((b) => ({ eje: b.eje, titulo: b.etiqueta, pnl: b.pnl, texto: b.texto, detalle: b.detalle }))} />
              <p className="mt-1 text-right text-xs text-muted">día UTC</p>
              <TablaTexto titulo="PnL de cada día UTC" filas={barras.map((b) => [b.etiqueta, b.detalle])} />
            </>
          )}
        </Tarjeta>

        <Tarjeta>
          <h2 className="mb-2 text-xl leading-[1.3] font-semibold">Aprobadas frente a rechazadas</h2>
          <div className="mb-4">
            <Ambitos>
              <Ambito>{filtro}</Ambito>
            </Ambitos>
          </div>
          {total === 0 ? (
            <p className="text-sm text-muted">Todavía no hay propuestas aprobadas ni rechazadas.</p>
          ) : (
            <>
              <div
                role="img"
                aria-label={`${m.aprobadas} aprobadas y ${m.rechazadas} rechazadas, de ${total} propuestas`}
                className="flex h-6 overflow-hidden rounded-sm border border-strong"
              >
                <div className="bg-ink" style={{ width: `${pctAprobadas}%` }} />
              </div>
              <p className="mt-3 flex flex-wrap justify-between gap-x-4 text-sm font-semibold">
                <span>
                  Aprobadas {m.aprobadas} ({pct(pctAprobadas, 1, false)})
                </span>
                <span>
                  Rechazadas {m.rechazadas} ({pct(100 - pctAprobadas, 1, false)})
                </span>
              </p>
              <p className="mt-3 text-xs text-muted">Relleno sólido: aprobadas. Contorno: rechazadas.</p>
              <RechazosPorMotivo m={m} />
            </>
          )}
        </Tarjeta>
      </div>
    </>
  );
}

async function Cuerpo({ activo }: { activo: ReturnType<typeof leerActivo> }) {
  const [{ ahora, datos: m }, { datos: c }] = await Promise.all([conHora(() => metricas({ activo }))(), cartera()]);
  // Saldo inicial: lo que hay hoy menos lo realizado (el saldo virtual es inicial + realizado).
  const inicial = Number(c.saldoVirtualUsd) - Number(c.pnlAcumuladoUsd);
  return <Contenido m={m} activo={activo} inicial={inicial} ahora={ahora} />;
}

export async function ContenidoMetricas({ searchParams }: { searchParams: Promise<Params> }) {
  const activo = leerActivo(await searchParams);
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted">
            El filtro aplica a PnL, tasa de aciertos y aprobadas frente a rechazadas. La curva de saldo y el drawdown son de la
            cartera global.
          </p>
        </div>
        <GrupoChips
          nombre="activo"
          etiqueta="Activo"
          actual={activo}
          otros={{}}
          opciones={[
            { valor: "", texto: "Todos" },
            { valor: "BTC/USD", texto: "BTC/USD" },
            { valor: "SOL/USD", texto: "SOL/USD" },
          ]}
        />
      </div>
      <BloqueConError nombre="las métricas" cubre>
        <Cuerpo activo={activo} />
      </BloqueConError>
    </>
  );
}

export function MetricasEsqueleto() {
  return (
    <Cargando etiqueta="las métricas">
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4">
              <Barra ancho="w-1/2" />
              <Barra ancho="w-3/4" alto="h-6" />
              <Barra ancho="w-2/3" alto="h-3" />
            </div>
          ))}
        </div>
        <div className="rounded-md border border-line bg-surface p-4">
          <Barra ancho="w-1/3" alto="h-6" />
          <div className="mt-4 flex flex-col gap-3">
            <Barra />
            <Barra />
            <Barra ancho="w-2/3" />
          </div>
        </div>
      </div>
    </Cargando>
  );
}
