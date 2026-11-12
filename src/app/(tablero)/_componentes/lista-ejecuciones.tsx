import Link from "next/link";
import { ACTIVOS } from "@/core/activos";
import { proximaEjecucion } from "@/core/tiempo";
import { listarEjecuciones } from "@/server/consultas/ejecuciones";
import type { Activo, FilaEjecucion } from "@/server/consultas/tipos";
import { conHora } from "../_lib/datos";
import { diaYHora, hora, horaConSegundos } from "../_lib/formato";
import { consulta, leerEjecuciones, RESULTADOS, type Params } from "../_lib/params";
import { BloqueConError } from "./bloque";
import { Barra, Cargando } from "./esqueleto";
import { ChipOmitida, ChipResultado, esOmitida, textoResultado } from "./estados";
import { GrupoChips, GrupoSelect, Paginacion } from "./filtros";
import { Tarjeta, Vacio } from "./tarjeta";

const TEXTO_RESULTADO = {
  sin_senal: "Sin señal",
  propuesta: "Propuesta",
  datos_no_disponibles: "Datos no disponibles",
  error: "Error",
  senal_registrada: "Señal (solo registro)",
  omitida_solapamiento: "Omitida por solapamiento",
} as const;
const OPCIONES_RESULTADO = [{ valor: "", texto: "Todos" }, ...RESULTADOS.map((r) => ({ valor: r, texto: TEXTO_RESULTADO[r] }))];

/** Cada resultado por activo lleva a donde se ve: una propuesta a su S3; las demás evaluaciones a su detalle en S5. */
function Resultado({ f, activo, sufijo }: { f: FilaEjecucion; activo: Activo; sufijo: string }) {
  const r = f.porActivo[activo];
  const chip = <ChipResultado r={r} />;
  if (r === null || f.estado === "error") return chip;
  const href =
    r.resultado === "propuesta" && r.propuestaId
      ? `/propuestas/${r.propuestaId}?de=ejecuciones&${sufijo}`
      : `/ejecuciones/${f.id}/${activo.replace("/", "-")}?${sufijo}`;
  return (
    <Link
      href={href}
      aria-label={`${activo}: ${textoResultado(r)}, ejecución de las ${hora(f.inicio)}. Ver detalle`}
      className="inline-flex min-h-11 items-center md:min-h-10"
    >
      {chip}
    </Link>
  );
}

const ErrorEjecucion = ({ f }: { f: FilaEjecucion }) =>
  f.estado === "error" && f.error ? <span className="block text-xs text-muted [overflow-wrap:anywhere]">{f.error}</span> : null;

async function Vacia({ filtrado }: { filtrado: boolean }) {
  if (filtrado) {
    return (
      <Vacio>
        Ninguna ejecución coincide con los filtros.{" "}
        <Link href="/ejecuciones" className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2">
          Quitar los filtros
        </Link>
      </Vacio>
    );
  }
  const { ahora } = await conHora(async () => null)();
  return (
    <Vacio>
      Todavía no hay ejecuciones. El ciclo evalúa BTC/USD y SOL/USD cada 30 minutos; la próxima ejecución se espera a las{" "}
      {hora(proximaEjecucion(ahora).toISOString())}
    </Vacio>
  );
}

export async function ContenidoEjecuciones({ searchParams }: { searchParams: Promise<Params> }) {
  const { filtro, valores } = leerEjecuciones(await searchParams);
  const filtrado = Boolean(valores.activo || valores.resultado);
  const otros = (sin: string) => ({ ...valores, [sin]: undefined });
  return (
    <>
      <div className="mb-4 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:gap-x-10">
        <GrupoChips
          nombre="activo"
          etiqueta="Activo"
          actual={valores.activo}
          otros={otros("activo")}
          opciones={[{ valor: "", texto: "Todos" }, ...ACTIVOS.map((a) => ({ valor: a, texto: a }))]}
        />
        <GrupoChips
          nombre="resultado"
          etiqueta="Resultado"
          actual={valores.resultado}
          otros={otros("resultado")}
          opciones={OPCIONES_RESULTADO}
          className="max-md:hidden"
        />
        <GrupoSelect
          nombre="resultado"
          etiqueta="Resultado"
          actual={valores.resultado}
          otros={otros("resultado")}
          opciones={OPCIONES_RESULTADO}
          className="md:hidden"
        />
      </div>
      <BloqueConError nombre="las ejecuciones">
        <Tabla filtro={filtro} filtrado={filtrado} valores={valores} />
      </BloqueConError>
    </>
  );
}

async function Tabla({
  filtro,
  filtrado,
  valores,
}: {
  filtro: Parameters<typeof listarEjecuciones>[0];
  filtrado: boolean;
  valores: Record<string, string | undefined>;
}) {
  const { datos: pagina } = await conHora(() => listarEjecuciones(filtro))();
  const filas = pagina.filas;
  const sufijo = `v=${encodeURIComponent(consulta(valores).slice(1))}`;

  return (
    <>
      <p className="mb-3 text-sm" aria-live="polite">
        <span className="font-semibold">
          {pagina.total} {pagina.total === 1 ? "resultado" : "resultados"}
        </span>
        <span className="ml-3 text-muted">Las omitidas por solapamiento aparecen con cualquier filtro de activo.</span>
      </p>
      <Tarjeta className="px-2 md:px-4">
        {filas.length === 0 ? (
          <Vacia filtrado={filtrado} />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table [&_th]:whitespace-nowrap">
              <caption className="sr-only">Ejecuciones del ciclo</caption>
              <thead>
                <tr className="bg-sunken text-[13px] font-semibold">
                  <th scope="col" className="px-2 py-2 text-left">Inicio (UTC−6)</th>
                  <th scope="col" className="px-2 py-2 text-left">Fin (UTC−6)</th>
                  <th scope="col" className="px-2 py-2 text-left">Versión de la regla</th>
                  {ACTIVOS.map((a) => (
                    <th key={a} scope="col" className="px-2 py-2 text-left">{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="min-h-10 border-b border-line align-middle last:border-0">
                    <td className="px-2 py-1">
                      {diaYHora(f.inicio)}
                      <ErrorEjecucion f={f} />
                    </td>
                    <td className="px-2 py-1">{f.fin ? horaConSegundos(f.fin).replace(/\s\(.*\)$/, "") : "—"}</td>
                    <td className="px-2 py-1 font-mono text-[13px]">{esOmitida(f.estado) ? "—" : f.versionRegla}</td>
                    {esOmitida(f.estado) ? (
                      <td colSpan={ACTIVOS.length} className="px-2 py-1">
                        <ChipOmitida /> <span className="ml-2 text-xs text-muted">Sin resultado por activo</span>
                      </td>
                    ) : (
                      ACTIVOS.map((a) => (
                        <td key={a} className="px-2 py-0">
                          <Resultado f={f} activo={a} sufijo={sufijo} />
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="flex flex-col md:hidden" aria-label="Ejecuciones del ciclo">
              {filas.map((f) => (
                <li key={f.id} className="flex flex-col gap-1 border-b border-line px-2 py-3 text-sm last:border-0">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{diaYHora(f.inicio)} (UTC−6)</span>
                    {esOmitida(f.estado) ? null : <span className="font-mono text-[13px] text-muted">{f.versionRegla}</span>}
                  </p>
                  <p className="text-xs text-muted">Fin: {f.fin ? hora(f.fin) : "—"}</p>
                  <ErrorEjecucion f={f} />
                  {esOmitida(f.estado) ? (
                    <p className="flex flex-wrap items-center gap-2">
                      <ChipOmitida /> <span className="text-xs text-muted">Sin resultado por activo</span>
                    </p>
                  ) : (
                    ACTIVOS.map((a) => (
                      <div key={a} className="flex items-center gap-3">
                        <span className="w-16 font-semibold">{a}</span>
                        <Resultado f={f} activo={a} sufijo={sufijo} />
                      </div>
                    ))
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Tarjeta>
      {filas.length > 0 ? (
        <Paginacion
          base="/ejecuciones"
          valores={valores}
          anterior={pagina.anterior}
          siguiente={pagina.siguiente}
          mostrando={filas.length}
          total={pagina.total}
        />
      ) : null}
    </>
  );
}

export function EjecucionesEsqueleto() {
  return (
    <Cargando etiqueta="las ejecuciones">
      <div className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
        <Barra ancho="w-1/4" alto="h-6" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Barra key={i} alto="h-6" />
        ))}
      </div>
    </Cargando>
  );
}
