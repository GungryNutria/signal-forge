import Link from "next/link";
import type { ReactNode } from "react";
import { ACTIVOS } from "@/core/activos";
import { comparacion, listarEvitadasYRechazadas } from "@/server/consultas/comparacion";
import type { Comparacion, FilaEvitadaORechazada, Tasa } from "@/server/consultas/tipos";
import { conHora } from "../_lib/datos";
import { dia, diaYHora, hora, horaCorta, nombreCorto, pct, signo, usdConSigno } from "../_lib/formato";
import { consulta, leerComparacion, type Params, type ValoresComparacion } from "../_lib/params";
import { BloqueConError } from "./bloque";
import { Chip } from "./chip";
import { GrupoSelect, Paginacion } from "./filtros";
import { ChipHipotetico, TEXTO_HIPOTETICO } from "./hipotetico";
import { Tarjeta, TituloBloque, Vacio } from "./tarjeta";

const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;
const OPCIONES_ACTIVO = [{ valor: "", texto: "Todos" }, ...ACTIVOS.map((a) => ({ valor: a, texto: a }))];
const OPCIONES_PERIODO = [
  { valor: "", texto: "Desde la activación" },
  { valor: "7d", texto: "7 días" },
  { valor: "30d", texto: "30 días" },
];
const OPCIONES_HIPOTETICO = [
  { valor: "", texto: "Todos los resultados" },
  ...(["take_profit", "stop_loss", "pendiente", "sin_precio_entrada"] as const).map((h) => ({ valor: h, texto: TEXTO_HIPOTETICO[h] })),
];

type Celda = { valor: ReactNode; nota: ReactNode; apagada?: boolean };
type Metrica = { clave: string; etiqueta: string; decisor: Celda; regla: Celda };

const Numero = ({ children, clase = "" }: { children: ReactNode; clase?: string }) => (
  <span className={`text-xl leading-[1.3] font-semibold ${clase}`}>{children}</span>
);
const NoAplica = (nota: string): Celda => ({ valor: <span className="text-sm font-semibold text-muted">No aplica</span>, nota, apagada: true });
const SinDato = (nota: string): Celda => ({ valor: <span className="text-xl font-semibold text-muted">—</span>, nota, apagada: true });

const tasa = (t: Tasa, hipotetico: boolean): Celda => ({
  valor: <Numero>{t ? pct(t.pct, 1, false) : "—"}</Numero>,
  nota: t ? `${t.aciertos} de ${t.cerradas} entradas cerradas${hipotetico ? " · hipotético" : ""}` : `0 entradas cerradas${hipotetico ? " · hipotético" : ""}`,
});

/** PnL a nivel: neutro, con signo y sin color. Sin entradas cerradas no hay cifra: "—", nunca "0.00 USD". */
const pnlANivel = (usd: string, cerradas: number, nota: string): Celda =>
  cerradas === 0 ? { valor: <Numero clase="text-muted">—</Numero>, nota: "0 entradas cerradas" } : { valor: <Numero>{usdConSigno(usd)}</Numero>, nota };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function metricas(c: Comparacion): Metrica[] {
  const d = c.decisor;
  const r = c.regla;
  const rechazadas = d.rechazadasPorRegla.reduce((a, x) => a + x.n, 0);
  return [
    {
      clave: "entradas",
      etiqueta: "Entradas",
      decisor: { valor: <Numero>{d.entradas}</Numero>, nota: `${plural(d.entradas, "ejecutada", "ejecutadas")} · ${plural(rechazadas, "rechazada", "rechazadas")} por el riesgo` },
      regla: { valor: <Numero>{r.cuentan}</Numero>, nota: `hipotético · ${plural(r.senales, "señal", "señales")}, ${plural(r.bloqueadasPorTope, "bloqueada", "bloqueadas")} por el tope` },
    },
    {
      clave: "tope",
      etiqueta: "Bloqueadas por el tope (hipotético)",
      decisor: NoAplica("El decisor no usa el tope de la regla: R11 lo evalúa el riesgo"),
      regla: { valor: <Numero>{r.bloqueadasPorTope}</Numero>, nota: `hipotético · señales con ${plural(c.topeN, "entrada ya abierta", "entradas ya abiertas")}` },
    },
    {
      clave: "cerradas",
      etiqueta: "Entradas cerradas",
      decisor: { valor: <Numero>{d.cerradas}</Numero>, nota: d.entradas - d.cerradas === 1 ? "1 sigue abierta" : `${d.entradas - d.cerradas} siguen abiertas` },
      regla: { valor: <Numero>{r.cerradas}</Numero>, nota: `hipotético · ${plural(r.pendientes, "pendiente", "pendientes")}` },
    },
    { clave: "tasa", etiqueta: "Tasa de aciertos", decisor: tasa(d.tasa, false), regla: tasa(r.tasa, true) },
    {
      clave: "pnl-nivel",
      etiqueta: "PnL a nivel (comparable)",
      decisor: pnlANivel(d.pnlANivelUsd, d.cerradas, "a nivel de stop loss y take profit, sin comisiones"),
      regla: pnlANivel(r.pnlANivelUsd, r.cerradas, "hipotético · mismos niveles"),
    },
    {
      clave: "pnl-neto",
      etiqueta: "PnL neto real",
      decisor:
        d.cerradas === 0
          ? { valor: <Numero clase="text-muted">—</Numero>, nota: "0 entradas cerradas" }
          : { valor: <Numero clase={COLOR[signo(d.pnlNetoRealUsd)]}>{usdConSigno(d.pnlNetoRealUsd)}</Numero>, nota: "dinero real, con comisiones y deslizamiento" },
      regla: SinDato("La regla no opera con dinero: no tiene PnL real"),
    },
    {
      clave: "rechazadas",
      etiqueta: "Rechazadas por regla (R1 a R11)",
      decisor: {
        valor: <Numero>{rechazadas}</Numero>,
        nota: rechazadas === 0 ? "Ninguna propuesta rechazada" : d.rechazadasPorRegla.map((x) => `${nombreCorto(x.regla)}: ${x.n}`).join(" · "),
      },
      regla: SinDato("La regla no pasa por el riesgo real"),
    },
    {
      clave: "evitadas",
      etiqueta: "Entradas evitadas (hipotético)",
      decisor: {
        valor: <Numero>{d.evitadas.total}</Numero>,
        nota: `stop loss: ${d.evitadas.stopLoss} · take profit: ${d.evitadas.takeProfit} · pendientes: ${d.evitadas.pendientes} · sin precio de entrada: ${d.evitadas.sinPrecio} · hipotético`,
      },
      regla: NoAplica("Son señales de la regla que el decisor no compró"),
    },
  ];
}

/** "Sin serie de la regla: el ciclo está apagado desde …": la columna de la regla no muestra ceros. */
function conCicloApagado(m: Metrica[], desde: string): Metrica[] {
  const nota = `Sin serie de la regla: el ciclo está apagado desde ${dia(desde)} ${hora(desde)}`;
  return m.map((x) => ({ ...x, regla: SinDato(nota) }));
}

function TablaMetricas({ m }: { m: Metrica[] }) {
  return (
    <Tarjeta className="px-4 py-2">
      <table className="hidden w-full text-sm md:table">
        <caption className="sr-only">Decisor frente a regla, métrica por métrica</caption>
        <thead>
          <tr className="text-left align-top">
            <th scope="col" className="w-[32%] px-2 py-3 text-[13px] font-semibold text-muted">Métrica</th>
            <th scope="col" className="w-[34%] px-2 py-3 font-semibold">
              Decisor
              <span className="block text-xs font-normal text-muted">Dinero real · casos del periodo</span>
            </th>
            <th scope="col" className="w-[34%] px-2 py-3 font-semibold">
              Regla (R11 entradas abiertas)
              <span className="block text-xs font-normal text-muted">Hipotético: nunca opera, solo registra la señal</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {m.map((x) => (
            <tr key={x.clave} className="border-t border-line align-top">
              <th scope="row" className="px-2 py-3 text-left font-normal">{x.etiqueta}</th>
              <td className="px-2 py-3">
                {x.decisor.valor}
                <span className="block text-xs text-muted">{x.decisor.nota}</span>
              </td>
              <td className="px-2 py-3">
                {x.regla.valor}
                <span className="block text-xs text-muted">{x.regla.nota}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="md:hidden">
        <div className="grid grid-cols-2 gap-4 border-b border-line pb-2 text-[13px] font-semibold">
          <span>Decisor</span>
          <span>Regla (hipotético)</span>
        </div>
        <ul aria-label="Decisor frente a regla, métrica por métrica">
          {m.map((x) => (
            <li key={x.clave} className="border-b border-line py-3 last:border-0">
              <h3 className="mb-1 text-[13px] font-semibold text-muted">{x.etiqueta}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0">
                  {x.decisor.valor}
                  <span className="block text-xs text-muted [overflow-wrap:anywhere]">{x.decisor.nota}</span>
                </div>
                <div className="min-w-0 border-l border-line pl-4">
                  {x.regla.valor}
                  <span className="block text-xs text-muted [overflow-wrap:anywhere]">{x.regla.nota}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Tarjeta>
  );
}

/** Coincidencia como 2×2 (AC-UX-16): señal o no de la regla por compró o no el decisor; los conteos suman las decisiones del periodo. */
function Coincidencia({ c }: { c: Comparacion["coincidencia"] }) {
  const compro = c.senalCompro + c.sinSenalCompro;
  const noCompro = c.senalNoCompro + c.sinSenalNoCompro;
  const senal = c.senalCompro + c.senalNoCompro;
  const sinSenal = c.sinSenalCompro + c.sinSenalNoCompro;
  const celda = (n: number, texto: string) => (
    <td className="px-2 py-3 align-top">
      <span className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:gap-3">
        <Numero>{n}</Numero>
        <span className="text-xs text-muted">{texto}</span>
      </span>
    </td>
  );
  return (
    <section aria-labelledby="coincidencia">
      <h2 id="coincidencia" className="mb-1 text-xl leading-[1.3] font-semibold">
        Coincidencia entre la regla y el decisor
      </h2>
      <p className="mb-3 text-xs text-muted">
        Cada decisión del periodo cae en una celda: {c.senalCompro} + {c.senalNoCompro} + {c.sinSenalCompro} + {c.sinSenalNoCompro} = {compro + noCompro}. Señal de la
        regla: hipotético.
      </p>
      <Tarjeta className="px-2 py-1">
        <table className="w-full text-sm">
          <caption className="sr-only">Señal de la regla y compra del decisor</caption>
          <thead>
            <tr className="text-left">
              <td />
              <th scope="col" className="px-2 py-3 font-semibold">El decisor compró ({compro})</th>
              <th scope="col" className="px-2 py-3 font-semibold">El decisor no compró ({noCompro})</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <th scope="row" className="w-1/4 px-2 py-3 text-left align-top font-semibold">
                La regla dio señal ({senal})
                <span className="block text-xs font-normal text-muted">hipotético</span>
              </th>
              {celda(c.senalCompro, "coinciden: ambos entran")}
              {celda(c.senalNoCompro, "entradas evitadas por el decisor")}
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="px-2 py-3 text-left align-top font-semibold">
                La regla no dio señal ({sinSenal})
                <span className="block text-xs font-normal text-muted">hipotético</span>
              </th>
              {celda(c.sinSenalCompro, "entradas solo del decisor")}
              {celda(c.sinSenalNoCompro, "coinciden: ninguno entra")}
            </tr>
          </tbody>
        </table>
      </Tarjeta>
    </section>
  );
}

const claveHipotetica = (f: FilaEvitadaORechazada) => f.hipotetico as keyof typeof TEXTO_HIPOTETICO | undefined;

function FilaLista({ f, v }: { f: FilaEvitadaORechazada; v: string }) {
  const href =
    f.tipo === "rechazada" && f.propuestaId
      ? `/propuestas/${f.propuestaId}?de=metricas&v=${v}`
      : `/ejecuciones/decisiones/${f.decisionId}?de=metricas&v=${v}`;
  const clave = claveHipotetica(f);
  return (
    <li className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex-1 text-sm md:w-28 md:flex-none">
          <span className="block">{diaYHora(f.recibidaEn)}</span>
          <span className="font-semibold">{f.activo}</span>
        </p>
        <div className="order-last min-w-0 basis-full md:order-none md:flex-1 md:basis-0">
          {f.tipo === "evitada" ? (
            clave ? <ChipHipotetico clave={clave} /> : null
          ) : (
            <Chip>Rechazada{f.reglaPrincipal ? ` (${nombreCorto(f.reglaPrincipal)})` : ""}</Chip>
          )}
        </div>
        <Link
          href={href}
          aria-label={`Ver detalle: ${f.tipo === "evitada" ? "entrada evitada" : "propuesta rechazada"} de ${f.activo}, ${diaYHora(f.recibidaEn)}`}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent"
        >
          Ver detalle
        </Link>
      </div>
      <p data-literal className="mt-1 line-clamp-2 font-mono text-[13px] text-muted [overflow-wrap:anywhere] md:truncate">
        Confianza {Number(f.confianza).toFixed(2)} · {f.primeraLinea}
      </p>
    </li>
  );
}

async function Lista({
  titulo,
  id,
  tipo,
  valores,
  vacio,
  filtro,
}: {
  titulo: string;
  id: string;
  tipo: "evitada" | "rechazada";
  valores: ValoresComparacion;
  vacio: ReactNode;
  filtro?: ReactNode;
}) {
  const clave = tipo === "evitada" ? "cursor_evitadas" : "cursor_rechazadas";
  const { datos: p } = await conHora((ahora) =>
    listarEvitadasYRechazadas(
      { activo: valores.activo, periodo: valores.periodo, tipo, hipotetico: tipo === "evitada" ? valores.hipotetico : undefined, antes: valores[clave] },
      ahora,
    ),
  )();
  const v = encodeURIComponent(consulta({ ...valores, vista: "comparacion" }).slice(1));
  return (
    <Tarjeta>
      <TituloBloque id={id}>
        {titulo} <span className="text-sm font-normal text-muted">({p.total})</span>
      </TituloBloque>
      {filtro}
      {p.filas.length === 0 ? (
        <Vacio>{vacio}</Vacio>
      ) : (
        <>
          <ul aria-labelledby={id}>
            {p.filas.map((f) => (
              <FilaLista key={f.decisionId} f={f} v={v} />
            ))}
          </ul>
          <Paginacion
            base="/metricas"
            valores={{ ...valores }}
            anterior={p.anterior}
            siguiente={p.siguiente}
            mostrando={p.filas.length}
            total={p.total}
            clave={clave}
            nombre={`Paginación de ${titulo.toLowerCase()}`}
          />
        </>
      )}
    </Tarjeta>
  );
}

async function Cuerpo({ valores }: { valores: ValoresComparacion }) {
  const { datos: c } = await conHora((ahora) => comparacion({ activo: valores.activo, periodo: valores.periodo }, ahora))();
  if (c.activacion === null || c.desde === null) {
    return (
      <Tarjeta>
        <Vacio>La comparación empieza cuando se activa el decisor</Vacio>
      </Tarjeta>
    );
  }
  const m = c.cicloApagadoDesde ? conCicloApagado(metricas(c), c.cicloApagadoDesde) : metricas(c);
  const k = c.coincidencia;
  const decisiones = k.senalCompro + k.senalNoCompro + k.sinSenalCompro + k.sinSenalNoCompro;
  const sinHipotetico = valores.hipotetico ? { ...valores, hipotetico: undefined } : null;
  return (
    <>
      <p className="text-sm">
        Periodo real: {dia(c.desde)} {horaCorta(c.desde)} a {dia(c.hasta)} {hora(c.hasta)} · el decisor se activó el {dia(c.activacion)} {horaCorta(c.activacion)}
        <span className="mt-0.5 block text-xs text-muted">
          {decisiones} {decisiones === 1 ? "decisión" : "decisiones"} en el periodo. Solo cuentan datos desde la activación.
        </span>
      </p>
      <TablaMetricas m={m} />
      <Coincidencia c={k} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <BloqueConError nombre="las entradas evitadas">
          <Lista
            titulo="Entradas evitadas"
            id="evitadas"
            tipo="evitada"
            valores={valores}
            filtro={
              <div className="mb-2">
                <GrupoSelect
                  nombre="hipotetico"
                  etiqueta="Resultado hipotético"
                  actual={valores.hipotetico}
                  otros={{ ...valores, hipotetico: undefined }}
                  opciones={OPCIONES_HIPOTETICO}
                />
              </div>
            }
            vacio={
              sinHipotetico ? (
                <>
                  Ninguna entrada evitada coincide con el resultado elegido.{" "}
                  <Link
                    href={`/metricas${consulta({ ...sinHipotetico })}`}
                    className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2"
                  >
                    Quitar el filtro
                  </Link>
                </>
              ) : (
                "El decisor no evitó ninguna entrada en este periodo."
              )
            }
          />
        </BloqueConError>
        <BloqueConError nombre="las propuestas rechazadas">
          <Lista titulo="Rechazadas por regla" id="rechazadas" tipo="rechazada" valores={valores} vacio="Ninguna propuesta del decisor fue rechazada en este periodo." />
        </BloqueConError>
      </div>
    </>
  );
}

/** S4, vista "Decisor frente a regla" (REQ-23, REQ-24). Los filtros y el cursor viajan en la dirección. */
export async function ContenidoComparacion({ searchParams }: { searchParams: Promise<Params> }) {
  const valores = leerComparacion(await searchParams);
  const otros = (sin: string) => ({ ...valores, [sin]: undefined });
  return (
    <>
      <div className="flex flex-wrap gap-4">
        <GrupoSelect nombre="activo" etiqueta="Activo" actual={valores.activo} otros={otros("activo")} opciones={OPCIONES_ACTIVO} />
        <GrupoSelect nombre="periodo" etiqueta="Periodo" actual={valores.periodo} otros={otros("periodo")} opciones={OPCIONES_PERIODO} />
      </div>
      <BloqueConError nombre="la comparación" cubre>
        <Cuerpo valores={valores} />
      </BloqueConError>
    </>
  );
}
