import Link from "next/link";
import { proximaEjecucion, proximaInvestigacion } from "@/core/tiempo";
import { listarPropuestas } from "@/server/consultas/propuestas";
import type { FilaPropuesta } from "@/server/consultas/tipos";
import { cartera, conHora } from "../_lib/datos";
import { cripto, hora, horaCorta, NOMBRE_PROPONENTE, unidad, usd } from "../_lib/formato";
import { consulta, DECISIONES, ESTADOS, leerPropuestas, type Params } from "../_lib/params";
import { BloqueConError } from "./bloque";
import { Barra, Cargando } from "./esqueleto";
import { ChipDecision, textoOperacion } from "./estados";
import { GrupoChips, GrupoSelect, Paginacion } from "./filtros";
import { IconoChevron } from "./iconos";
import { Tarjeta, Vacio } from "./tarjeta";
import { Enlace, EstadoOMotivo, Pnl } from "./ultimas-propuestas";

const LADO: Record<string, string> = { buy: "Compra", sell: "Venta" };
const TEXTO_DECISION = { ejecutada: "Ejecutadas", rechazada: "Rechazadas", conflicto: "Conflicto", error: "Error" } as const;

/** Tamaño: la cantidad de cripto si la propuesta la trae; si no, el nocional en USD. */
function tamano(f: FilaPropuesta): string {
  if (f.cantidad !== null && f.activo) return cripto(f.cantidad, unidad(f.activo));
  if (f.nocionalUsd !== null) return usd(f.nocionalUsd);
  return "—";
}

async function Vacia({ filtrado }: { filtrado: boolean }) {
  if (filtrado) {
    return (
      <Vacio>
        Ninguna propuesta coincide con los filtros.{" "}
        <Link href="/propuestas" className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2">
          Quitar los filtros
        </Link>
      </Vacio>
    );
  }
  const { ahora, datos } = await cartera();
  return (
    <Vacio>
      Todavía no hay propuestas. El saldo inicial es de {usd(datos.saldoVirtualUsd)}. El ciclo evalúa BTC/USD y SOL/USD cada
      30 minutos; la próxima ejecución se espera a las {hora(proximaEjecucion(ahora).toISOString())}. La investigación llega
      cada hora; la próxima se espera a las {hora(proximaInvestigacion(ahora).toISOString())}
    </Vacio>
  );
}

export async function ContenidoPropuestas({ searchParams }: { searchParams: Promise<Params> }) {
  const { filtro, valores } = leerPropuestas(await searchParams);
  const filtrado = Boolean(valores.proponente || valores.activo || valores.decision || valores.estado);
  const sufijo = `?v=${encodeURIComponent(consulta(valores).slice(1))}`;
  const otros = (sin: string) => ({ ...valores, [sin]: undefined });
  return (
    <>
      <Tarjeta className="mb-6 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:gap-x-10">
        <GrupoChips
          nombre="proponente"
          etiqueta="Proponente"
          actual={valores.proponente}
          otros={otros("proponente")}
          opciones={[{ valor: "", texto: "Todos" }, { valor: "ciclo", texto: "Ciclo" }, { valor: "decisor", texto: "Decisor" }]}
        />
        <GrupoChips
          nombre="activo"
          etiqueta="Activo"
          actual={valores.activo}
          otros={otros("activo")}
          opciones={[
            { valor: "", texto: "Todos" },
            { valor: "BTC/USD", texto: "BTC/USD" },
            { valor: "SOL/USD", texto: "SOL/USD" },
          ]}
        />
        <GrupoChips
          nombre="decision"
          etiqueta="Decisión"
          actual={valores.decision}
          otros={otros("decision")}
          opciones={[{ valor: "", texto: "Todas" }, ...DECISIONES.map((d) => ({ valor: d, texto: TEXTO_DECISION[d] }))]}
        />
        <GrupoSelect
          nombre="estado"
          etiqueta="Estado"
          actual={valores.estado}
          otros={otros("estado")}
          opciones={[{ valor: "", texto: "Todos" }, ...ESTADOS.map((e) => ({ valor: e, texto: textoOperacion(e) }))]}
        />
      </Tarjeta>
      <BloqueConError nombre="las propuestas">
        <Tabla filtro={filtro} filtrado={filtrado} valores={valores} sufijo={sufijo} />
      </BloqueConError>
    </>
  );
}

async function Tabla({
  filtro,
  filtrado,
  valores,
  sufijo,
}: {
  filtro: Parameters<typeof listarPropuestas>[0];
  filtrado: boolean;
  valores: Record<string, string | undefined>;
  sufijo: string;
}) {
  const { datos: pagina } = await conHora(() => listarPropuestas(filtro))();
  const filas = pagina.filas;
  // Los lotes abiertos dan el PnL no realizado de las filas "Abierta"; si esa fuente falla, dice "No disponible".
  const abiertos = filas.some((f) => f.estado === "abierta")
    ? await cartera()
        .then((r) => r.datos.lotesAbiertos)
        .catch(() => null)
    : [];

  return (
    <Tarjeta>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl leading-[1.3] font-semibold" aria-live="polite">
          {pagina.total} {pagina.total === 1 ? "propuesta" : "propuestas"}
        </h2>
        <p className="text-xs text-muted">Más recientes primero · hora (UTC−6)</p>
      </div>
      {filas.length === 0 ? (
        <Vacia filtrado={filtrado} />
      ) : (
        <>
          <table className="hidden w-full text-sm md:table [&_th]:whitespace-nowrap">
            <caption className="sr-only">Propuestas</caption>
            <thead>
              <tr className="bg-sunken text-[13px] font-semibold">
                <th scope="col" className="px-2 py-2 text-left">Hora (UTC−6)</th>
                <th scope="col" className="px-2 py-2 text-left">Activo</th>
                <th scope="col" className="px-2 py-2 text-left">Proponente</th>
                <th scope="col" className="px-2 py-2 text-left">Lado</th>
                <th scope="col" className="px-2 py-2 text-right">Tamaño</th>
                <th scope="col" className="px-2 py-2 text-left">Decisión</th>
                <th scope="col" className="px-2 py-2 text-left">Estado o motivo</th>
                <th scope="col" className="px-2 py-2 text-right">PnL</th>
                <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Ver detalle</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="relative min-h-10 border-b border-line last:border-0 hover:bg-sunken">
                  <td className="px-2 py-2"><Enlace f={f} sufijo={sufijo}>{horaCorta(f.recibidaEn)}</Enlace></td>
                  <td className="px-2 py-2 font-semibold">{f.activo ?? "—"}</td>
                  <td className="px-2 py-2">{NOMBRE_PROPONENTE[f.proponente]}</td>
                  <td className="px-2 py-2">{(f.lado && LADO[f.lado]) ?? "—"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">{tamano(f)}</td>
                  <td className="px-2 py-2"><ChipDecision decision={f.decision} /></td>
                  <td className="px-2 py-2"><EstadoOMotivo f={f} /></td>
                  <td className="px-2 py-2 text-right whitespace-nowrap"><Pnl f={f} abiertos={abiertos} /></td>
                  <td className="px-2 py-2 text-muted"><IconoChevron /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col md:hidden" aria-label="Propuestas">
            {filas.map((f) => (
              <li key={f.id} className="relative flex min-h-14 items-start gap-2 border-b border-line py-3 last:border-0">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p>
                      <Enlace f={f} sufijo={sufijo}><span className="font-semibold">{horaCorta(f.recibidaEn)}</span></Enlace>
                      {" · "}
                      <span className="font-semibold">{f.activo ?? "—"}</span>
                    </p>
                    <ChipDecision decision={f.decision} />
                  </div>
                  <p className="text-muted">{NOMBRE_PROPONENTE[f.proponente]} · {(f.lado && LADO[f.lado]) ?? "—"} · {tamano(f)}</p>
                  <div className="min-w-0 [overflow-wrap:anywhere]"><EstadoOMotivo f={f} /></div>
                  <div className="text-sm"><Pnl f={f} abiertos={abiertos} movil /></div>
                </div>
                <span className="mt-1 text-muted"><IconoChevron /></span>
              </li>
            ))}
          </ul>
          <Paginacion
            base="/propuestas"
            valores={valores}
            anterior={pagina.anterior}
            siguiente={pagina.siguiente}
            mostrando={filas.length}
            total={pagina.total}
          />
        </>
      )}
    </Tarjeta>
  );
}

export function PropuestasEsqueleto() {
  return (
    <Cargando etiqueta="las propuestas">
      <div className="flex flex-col gap-6">
        <div className="rounded-md border border-line bg-surface p-4"><Barra ancho="w-2/3" alto="h-8" /></div>
        <div className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
          <Barra ancho="w-1/4" alto="h-6" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Barra key={i} alto="h-6" />
          ))}
        </div>
      </div>
    </Cargando>
  );
}
