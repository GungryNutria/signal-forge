"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, ComposedChart, Line, usePlotArea, XAxis, YAxis } from "recharts";
import type { OperacionesPrecio, SeriePrecio } from "@/server/consultas/tipos";
import { usd, zona } from "../_lib/formato";
import {
  agruparMarcadores,
  colocarRotulos,
  hrefOperacion,
  type Marca,
  marcas as construirMarcas,
  tramos,
  ticksX,
  ticksY,
} from "../_lib/precio";
import { FormaMarca, FormaSvg } from "./precio-comun";
import { PanelConsulta, type Seleccion } from "./precio-panel";

// Gráfica de S6 (spec 002). Recharts dibuja la rejilla, los ejes y las dos líneas (con cortes `null` en los huecos);
// los marcadores, los grupos "×N", los niveles y sus rótulos, el cursor y el anillo van en una capa SVG propia con las
// mismas escalas lineales, tomadas del área de trazado que Recharts informa (`usePlotArea`). La consulta (puntero,
// toque y teclado) es estado propio: no hay `Tooltip` ni capa de accesibilidad de Recharts (una sola parada de Tab).
const UMBRAL_PX = 20; // T-2: distancia entre centros para agrupar; el marcador mide ~16 px
const ALTO_ROTULO = 22;
const MARGEN = { top: 16, right: 12, bottom: 22, left: 0 };
const ALTO_EJE_X = 24;
const EJE = { fill: "var(--color-muted)", fontSize: 12 };
const miles = (n: number) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);

type Area = { left: number; top: number; width: number; height: number };
type Consulta = { k: "punto"; i: number } | { k: "marcas"; claves: string[] };

/** Hijo de `ComposedChart`: informa el área de trazado real de Recharts a la capa propia. */
function AreaDeTrazado({ onArea }: { onArea: (a: Area) => void }) {
  const a = usePlotArea();
  useEffect(() => {
    if (a) onArea({ left: a.x, top: a.y, width: a.width, height: a.height });
  }, [a, onArea]);
  return null;
}

const mismaArea = (a: Area | null, b: Area) => a !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

export function GraficaPrecio({
  serie,
  operaciones,
  op,
  nombre,
}: {
  serie: SeriePrecio;
  operaciones: OperacionesPrecio | null;
  op: string | null;
  nombre: string;
}) {
  const router = useRouter();
  const celda = useRef<HTMLDivElement>(null);
  const marco = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const tipoPuntero = useRef<string>("mouse");
  const [ancho, setAncho] = useState(0);
  const [area, setArea] = useState<Area | null>(null);

  // Ancho disponible de la celda (la gráfica ocupa todo el ancho, AC-UX-16). Recharts recibe medidas explícitas.
  useEffect(() => {
    const el = celda.current;
    if (!el) return;
    const medir = () => setAncho(Math.round(el.getBoundingClientRect().width));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const alto = ancho >= 600 ? 380 : 300;
  const anchoEjeY = ancho < 480 ? 52 : 64;
  const movil = ancho < 480;

  // ── datos ──
  const puntos = useMemo(() => serie.puntos.map((p, i) => ({ ...p, i, ms: new Date(p.t).getTime(), c: Number(p.cierre), s: Number(p.sma20) })), [serie.puntos]);
  const lista = useMemo(() => (operaciones ? construirMarcas(operaciones.filas) : []), [operaciones]);
  const abiertas = useMemo(() => (operaciones ? operaciones.filas.filter((f) => f.niveles) : []), [operaciones]);

  const { x0, x1, y0, y1 } = useMemo(() => {
    const x1 = new Date(serie.hasta).getTime();
    const primer = new Date(serie.primerPunto ?? serie.puntos[0].t).getTime();
    let x0 = serie.desde ? Math.max(new Date(serie.desde).getTime(), primer) : primer;
    for (const m of lista) x0 = Math.min(x0, new Date(m.t).getTime());
    const valores = [...puntos.flatMap((p) => [p.c, p.s]), ...lista.map((m) => Number(m.precio))];
    for (const f of abiertas) valores.push(Number(f.niveles!.stopLoss), Number(f.niveles!.takeProfit));
    const [min, max] = [Math.min(...valores), Math.max(...valores)];
    const pad = (max - min || 1) * 0.03; // D-6: la serie y los niveles de las abiertas, con 3 % de margen
    return { x0, x1, y0: min - pad, y1: max + pad };
  }, [serie, puntos, lista, abiertas]);

  const datos = useMemo(() => {
    const filas: { t: number; cierre: number | null; sma20: number | null }[] = [];
    tramos(serie.puntos).forEach((tr, k) => {
      if (k > 0) filas.push({ t: (new Date(filas[filas.length - 1].t).getTime() + new Date(tr[0].t).getTime()) / 2, cierre: null, sma20: null });
      for (const p of tr) filas.push({ t: new Date(p.t).getTime(), cierre: Number(p.cierre), sma20: Number(p.sma20) });
    });
    return filas;
  }, [serie.puntos]);

  const marcasX = useMemo(() => {
    const plano = Math.max(1, ancho - anchoEjeY - MARGEN.right);
    return ticksX(x0, x1, serie.rango, plano).filter((m) => ((x1 - m.t) / (x1 - x0)) * plano > 46);
  }, [x0, x1, serie.rango, ancho, anchoEjeY]);
  const etiquetaX = useMemo(() => new Map(marcasX.map((m) => [m.t, m.etiqueta])), [marcasX]);
  const marcasY = useMemo(() => ticksY(y0, y1, movil ? 4 : 5), [y0, y1, movil]);

  // ── escalas lineales sobre el área de trazado de Recharts ──
  const X = (ms: number) => (area ? area.left + ((ms - x0) / (x1 - x0)) * area.width : 0);
  const Y = (v: number) => (area ? area.top + (1 - (v - y0) / (y1 - y0)) * area.height : 0);

  const colocadas = useMemo(() => (area ? lista.map((m) => ({ m, x: X(new Date(m.t).getTime()), y: Y(Number(m.precio)) })) : []), [area, lista, x0, x1, y0, y1]); // eslint-disable-line react-hooks/exhaustive-deps
  const grupos = useMemo(() => agruparMarcadores(colocadas, UMBRAL_PX), [colocadas]);

  // ── consulta ──
  const [consulta, setConsulta] = useState<Consulta | null>(() => {
    const m = op ? (lista.find((x) => x.clave === `e:${op}`) ?? lista.find((x) => x.clave === `s:${op}`)) : undefined;
    return m ? { k: "marcas", claves: [m.clave] } : null;
  });

  useEffect(() => {
    if (op) marco.current?.focus({ preventScroll: true });
  }, [op]);

  const porClave = useMemo(() => new Map(lista.map((m) => [m.clave, m])), [lista]);
  const seleccion: Seleccion | null = useMemo(() => {
    if (!consulta) return null;
    if (consulta.k === "punto") return puntos[consulta.i] ? { tipo: "punto", punto: puntos[consulta.i] } : null;
    const ms = consulta.claves.map((c) => porClave.get(c)).filter((m): m is Marca => !!m);
    return ms.length ? { tipo: "marcas", marcas: ms } : null;
  }, [consulta, puntos, porClave]);

  const claveDestacada = seleccion?.tipo === "marcas" && seleccion.marcas.length === 1 && seleccion.marcas[0].tipo === "entrada" ? seleccion.marcas[0].op.propuestaId : null;
  const hayDestacada = claveDestacada !== null && abiertas.some((f) => f.propuestaId === claveDestacada);

  /** Dónde cae la consulta: la x del punto, o el centro del grupo del primer marcador. */
  const grupoDe = (clave: string) => grupos.find((g) => g.items.some((i) => i.m.clave === clave));
  const posicion = (() => {
    if (!consulta || !area) return null;
    if (consulta.k === "punto") {
      const p = puntos[consulta.i];
      return p ? { x: X(p.ms), y: Y(p.c), marca: false } : null;
    }
    const g = grupoDe(consulta.claves[0]);
    return g ? { x: g.x, y: g.y, marca: true } : null;
  })();

  const puntoMasCercano = (px: number): number => {
    let mejor = 0;
    let d = Infinity;
    for (const p of puntos) {
      const dx = Math.abs(X(p.ms) - px);
      if (dx < d) [d, mejor] = [dx, p.i];
    }
    return mejor;
  };

  /** Lo más cercano al puntero: un marcador o grupo si hay uno a tiro; si no, el punto más cercano en horizontal. */
  const buscar = (px: number, py: number, tactil: boolean): Consulta | null => {
    if (!area || px < area.left - 8 || px > area.left + area.width + 8) return null;
    const radio = tactil ? 26 : 16;
    let mejor: (typeof grupos)[number] | null = null;
    let d = radio;
    for (const g of grupos) {
      const dist = Math.hypot(g.x - px, g.y - py);
      if (dist < d) [d, mejor] = [dist, g];
    }
    if (mejor) return { k: "marcas", claves: mejor.items.map((i) => i.m.clave) };
    return { k: "punto", i: puntoMasCercano(px) };
  };

  const local = (e: PointerEvent) => {
    const r = marco.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const alPuntero = (e: PointerEvent) => {
    tipoPuntero.current = e.pointerType;
    const { px, py } = local(e);
    const c = buscar(px, py, e.pointerType === "touch");
    if (c) setConsulta(c);
  };
  const alSoltar = (e: PointerEvent) => {
    // Clic con ratón sobre un marcador suelto: va a S3 (1 clic). Con toque solo se consulta; "Ver operación" navega.
    if (e.pointerType !== "mouse" || e.button > 0) return;
    const { px, py } = local(e);
    const c = buscar(px, py, false);
    if (c?.k === "marcas" && c.claves.length === 1) {
      const m = porClave.get(c.claves[0]);
      if (m) router.push(hrefOperacion(m.op.propuestaId, serie.activo, serie.rango));
    }
  };

  const indiceActual = (): number => {
    if (!consulta) return -1;
    if (consulta.k === "punto") return consulta.i;
    const g = grupoDe(consulta.claves[0]);
    return g ? puntoMasCercano(g.x) : -1;
  };

  const alTeclado = (e: KeyboardEvent) => {
    const n = puntos.length;
    const ir = (i: number) => setConsulta({ k: "punto", i: Math.min(n - 1, Math.max(0, i)) });
    switch (e.key) {
      case "ArrowRight":
        ir(indiceActual() + 1);
        break;
      case "ArrowLeft":
        ir(indiceActual() < 0 ? n - 1 : indiceActual() - 1);
        break;
      case "Home":
        ir(0);
        break;
      case "End":
        ir(n - 1);
        break;
      case "PageDown":
      case "PageUp": {
        if (grupos.length === 0) return;
        const x = posicion?.x ?? -1;
        const abajo = e.key === "PageDown";
        const siguiente = abajo ? grupos.find((g) => g.x > x + 0.5) : [...grupos].reverse().find((g) => g.x < x - 0.5);
        const g = siguiente ?? (abajo ? grupos[grupos.length - 1] : grupos[0]);
        setConsulta({ k: "marcas", claves: g.items.map((i) => i.m.clave) });
        break;
      }
      case "Enter": {
        if (consulta?.k !== "marcas") return;
        if (consulta.claves.length === 1) {
          const m = porClave.get(consulta.claves[0]);
          if (m) router.push(hrefOperacion(m.op.propuestaId, serie.activo, serie.rango));
        } else panel.current?.querySelector<HTMLAnchorElement>("a")?.focus();
        break;
      }
      case "Escape":
        setConsulta(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // ── rótulos de nivel (AC-UX-8) ──
  const rotulos = useMemo(() => {
    if (!area) return [];
    const niveles = abiertas.flatMap((f) => [
      { tipo: "stop_loss" as const, f, valor: Number(f.niveles!.stopLoss), texto: f.niveles!.stopLoss, y: Y(Number(f.niveles!.stopLoss)) },
      { tipo: "take_profit" as const, f, valor: Number(f.niveles!.takeProfit), texto: f.niveles!.takeProfit, y: Y(Number(f.niveles!.takeProfit)) },
    ]);
    // Los stop loss y los take profit se agrupan por separado: un rótulo mixto no cabría en 360 px.
    return (["stop_loss", "take_profit"] as const).flatMap((tipo) =>
      colocarRotulos(niveles.filter((n) => n.tipo === tipo), ALTO_ROTULO).map((g) => {
        const color = tipo === "stop_loss" ? "var(--color-neg)" : "var(--color-pos)";
        let texto: string;
        if (g.items.length === 1) {
          texto = `${tipo === "stop_loss" ? "SL" : "TP"} #${g.items[0].f.numero} · ${usd(g.items[0].texto)}`;
        } else {
          const vs = g.items.map((i) => i.valor).sort((a, b) => a - b);
          const lista = movil ? "" : ` (${g.items.map((i) => `#${i.f.numero}`).sort().join(", ")})`;
          texto = `${g.items.length} ${tipo === "stop_loss" ? "stop loss" : "take profit"}${lista}: ${usd(vs[0])} a ${usd(vs[vs.length - 1])}`;
        }
        return { y: g.y, texto, color };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, abiertas, x0, x1, y0, y1, movil, hayDestacada, claveDestacada]);

  const hayDatos = ancho > 0;
  const ultimo = puntos[puntos.length - 1];
  const primero = puntos[0];
  const cierreSobreSma = primero.c >= primero.s;
  const zonaTexto = serie.rango === "24h" || x1 - x0 <= 36 * 3_600_000 ? "Hora de Torreón" : "Día · hora de Torreón";

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_304px]">
      <div ref={celda} className="min-w-0">
        <div
          ref={marco}
          role="group"
          aria-label={nombre}
          aria-describedby="ayuda-grafica"
          tabIndex={0}
          data-grafica
          data-grafica-lista={area ? "" : undefined}
          onPointerMove={alPuntero}
          onPointerDown={alPuntero}
          onPointerUp={alSoltar}
          onKeyDown={alTeclado}
          style={{ height: alto, touchAction: "pan-y" }}
          className="relative cursor-crosshair rounded-md select-none"
        >
          {hayDatos ? (
            <div aria-hidden="true" className="absolute inset-0">
              <ComposedChart width={ancho} height={alto} data={datos} margin={MARGEN} accessibilityLayer={false} tabIndex={-1}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  type="number"
                  dataKey="t"
                  domain={[x0, x1]}
                  allowDataOverflow
                  ticks={marcasX.map((m) => m.t)}
                  tickFormatter={(v: number) => etiquetaX.get(v) ?? ""}
                  tick={EJE}
                  tickLine={false}
                  stroke="var(--color-strong)"
                  height={ALTO_EJE_X}
                  interval={0}
                />
                <YAxis
                  type="number"
                  domain={[y0, y1]}
                  allowDataOverflow
                  ticks={marcasY}
                  tickFormatter={miles}
                  tick={EJE}
                  tickLine={false}
                  axisLine={false}
                  width={anchoEjeY}
                />
                <Line dataKey="cierre" type="linear" stroke="var(--color-ink)" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
                <Line
                  dataKey="sma20"
                  type="linear"
                  stroke="var(--color-muted)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                <AreaDeTrazado onArea={(a) => setArea((prev) => (mismaArea(prev, a) ? prev : a))} />
              </ComposedChart>

              {area ? (
                <svg width={ancho} height={alto} className="pointer-events-none absolute inset-0" data-capa>
                  {/* rótulos directos de las dos líneas */}
                  <text x={X(primero.ms) + 6} y={Y(primero.c) + (cierreSobreSma ? -8 : 16)} fontSize={12} fontWeight={600} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={3} paintOrder="stroke">
                    Cierre
                  </text>
                  <text x={X(primero.ms) + 6} y={Y(primero.s) + (cierreSobreSma ? 16 : -8)} fontSize={12} fontWeight={600} fill="var(--color-muted)" stroke="var(--color-surface)" strokeWidth={3} paintOrder="stroke">
                    SMA20
                  </text>
                  <text x={area.left + area.width} y={alto - 4} textAnchor="end" fontSize={12} fill="var(--color-muted)">
                    {zonaTexto} ({zona(new Date(x1))})
                  </text>

                  {/* niveles de salida vigentes: de la entrada (o el borde izquierdo) al final */}
                  {abiertas.map((f) => {
                    const desde = X(Math.max(new Date(f.entrada.t).getTime(), x0));
                    const dest = hayDestacada && f.propuestaId === claveDestacada;
                    const opaco = hayDestacada && !dest ? 0.65 : 1;
                    return (["stop_loss", "take_profit"] as const).map((t) => (
                      <line
                        key={`${f.propuestaId}-${t}`}
                        data-nivel-linea={`${f.numero}-${t}`}
                        x1={desde}
                        x2={area.left + area.width}
                        y1={Y(Number(t === "stop_loss" ? f.niveles!.stopLoss : f.niveles!.takeProfit))}
                        y2={Y(Number(t === "stop_loss" ? f.niveles!.stopLoss : f.niveles!.takeProfit))}
                        stroke={t === "stop_loss" ? "var(--color-neg)" : "var(--color-pos)"}
                        strokeWidth={dest ? 3 : 1.5}
                        strokeDasharray={dest ? undefined : "2 3"}
                        opacity={opaco}
                      />
                    ));
                  })}

                  {/* cursor de consulta */}
                  {posicion ? (
                    <>
                      <line x1={posicion.x} x2={posicion.x} y1={area.top} y2={area.top + area.height} stroke="var(--color-strong)" strokeWidth={1} />
                      {posicion.marca ? (
                        <circle cx={posicion.x} cy={posicion.y} r={13} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
                      ) : (
                        <circle cx={posicion.x} cy={posicion.y} r={4} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={1.5} />
                      )}
                    </>
                  ) : null}

                  {/* marcadores y grupos */}
                  {grupos.map((g) =>
                    g.items.length === 1 ? (
                      <g key={g.items[0].m.clave} data-marcador={g.items[0].m.clave} transform={`translate(${g.x} ${g.y})`}>
                        <FormaSvg tipo={g.items[0].m.tipo} />
                        {g.items[0].m.tipo === "entrada" && g.items[0].m.op.numero !== null ? (
                          <text y={-12} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={3} paintOrder="stroke">
                            #{g.items[0].m.op.numero}
                          </text>
                        ) : null}
                      </g>
                    ) : (
                      <g key={g.items[0].m.clave} data-grupo={g.items.length} transform={`translate(${g.x} ${g.y})`}>
                        <rect x={-15} y={-11} width={30} height={22} rx={11} fill="var(--color-sunken)" stroke="var(--color-ink)" strokeWidth={1.5} />
                        <text y={4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--color-ink)">
                          ×{g.items.length}
                        </text>
                      </g>
                    ),
                  )}

                  {/* rótulos de nivel, encima de líneas y marcadores */}
                  {rotulos.map((r) => {
                    const w = Math.min(r.texto.length * 6.4 + 10, area.width);
                    const xr = area.left + area.width - 4;
                    return (
                      <g key={r.texto + r.y} data-rotulo-nivel>
                        <rect x={xr - w} y={r.y - 10} width={w} height={20} rx={3} fill="var(--color-surface)" fillOpacity={0.92} />
                        <text x={xr - 5} y={r.y + 4} textAnchor="end" fontSize={12} fontWeight={600} fill={r.color}>
                          {r.texto}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : null}
            </div>
          ) : null}
        </div>
        <p id="ayuda-grafica" className="mt-2 hidden text-xs text-muted md:block">
          Teclas: ← → puntos · Re Pág / Av Pág marcadores · Intro abre · Esc cierra
        </p>
      </div>

      <PanelConsulta
        seleccion={seleccion}
        serie={serie}
        ultimo={ultimo}
        sinOperaciones={operaciones !== null && operaciones.filas.length === 0}
        referencia={(el) => {
          panel.current = el;
        }}
      />

      <Leyenda className="md:col-span-2" />
    </div>
  );
}

function Leyenda({ className = "" }: { className?: string }) {
  const item = "flex items-center gap-2 text-sm";
  return (
    <ul aria-label="Leyenda" className={`grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:flex md:flex-wrap md:gap-x-6 ${className}`}>
      <li className={item}>
        <svg aria-hidden="true" width={24} height={8}>
          <line x1={0} x2={24} y1={4} y2={4} stroke="var(--color-ink)" strokeWidth={2} />
        </svg>
        Cierre (30 min)
      </li>
      <li className={item}>
        <svg aria-hidden="true" width={24} height={8}>
          <line x1={0} x2={24} y1={4} y2={4} stroke="var(--color-muted)" strokeWidth={2} strokeDasharray="6 4" />
        </svg>
        SMA20
      </li>
      {(["entrada", "stop_loss", "take_profit"] as const).map((t) => (
        <li key={t} className={item}>
          <FormaMarca tipo={t} />
          {t === "entrada" ? "Entrada" : t === "stop_loss" ? "Stop loss" : "Take profit"}
        </li>
      ))}
      <li className={item}>
        <svg aria-hidden="true" width={24} height={8}>
          <line x1={0} x2={24} y1={4} y2={4} stroke="var(--color-pos)" strokeWidth={1.5} strokeDasharray="2 3" />
        </svg>
        Nivel de salida vigente
      </li>
      <li className={item}>
        <span aria-hidden="true" className="inline-flex h-[22px] min-w-[30px] items-center justify-center rounded-full border-[1.5px] border-ink bg-sunken px-1.5 text-xs font-semibold">
          ×N
        </span>
        Varios marcadores
      </li>
    </ul>
  );
}
