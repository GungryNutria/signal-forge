import Link from "next/link";
import { ACTIVOS } from "@/core/activos";
import { listarRanuras } from "@/server/consultas/decisor";
import type { Activo, EstadoRanura, FilaRanura, PorcentajeRanuras, ResultadoDecisorActivo } from "@/server/consultas/tipos";
import { conHora, estado } from "../_lib/datos";
import { hora, NOMBRE_MODO, pct, rangoRanura } from "../_lib/formato";
import { consulta, ESTADOS_RANURA, leerRanuras, RESULTADOS_RANURA, type Params } from "../_lib/params";
import { BloqueConError } from "./bloque";
import { ChipRanura, ChipResultadoDecisor, textoResultadoDecisor } from "./estados";
import { GrupoChips, GrupoSelect, Paginacion } from "./filtros";
import { Tarjeta, Vacio } from "./tarjeta";

const TEXTO_ESTADO: Record<EstadoRanura, string> = { completa: "Completa", parcial: "Parcial", invalida: "Inválida", sin_llegar: "Sin llegar", apagado: "Apagado" };
const TEXTO_RESULTADO: Record<ResultadoDecisorActivo["tipo"], string> = {
  comprar: "Comprar",
  comprar_rechazada: "Comprar sin datos",
  no_comprar: "No comprar",
  invalida: "Inválida",
  sin_decision: "Sin decisión",
};
const TODOS = { valor: "", texto: "Todos" };
const OPCIONES_ESTADO = [TODOS, ...ESTADOS_RANURA.map((e) => ({ valor: e, texto: TEXTO_ESTADO[e] }))];
const OPCIONES_RESULTADO = [TODOS, ...RESULTADOS_RANURA.map((r) => ({ valor: r, texto: TEXTO_RESULTADO[r] }))];

/** Estado "Sin llegar" de la spec: se explica, sin botón de reintento (AC-UX-11, AC-UX-19). */
const EXPLICACION_SIN_LLEGAR =
  "La ranura terminó sin envíos del decisor. Puede ser que la tarea no corrió o que se rechazó por el límite de uso de la suscripción; el historial de la tarea programada lo dice";

/** Una decisión con propuesta se audita en su S3; cualquier otra, en el detalle de decisión (regla de destino de la spec). */
function Resultado({ r, activo, ranura, sufijo }: { r: ResultadoDecisorActivo; activo: Activo; ranura: string; sufijo: string }) {
  const chip = <ChipResultadoDecisor r={r} />;
  if (r.tipo === "sin_decision") return chip;
  const href =
    r.tipo === "comprar" && r.propuesta
      ? `/propuestas/${r.propuesta.id}?de=ejecuciones&${sufijo}`
      : `/ejecuciones/decisiones/${r.decisionId}?${sufijo}`;
  return (
    <Link
      href={href}
      aria-label={`${activo}: ${textoResultadoDecisor(r)}, ranura de las ${hora(ranura)}. Ver detalle`}
      className="inline-flex min-h-11 items-center md:min-h-10"
    >
      {chip}
    </Link>
  );
}

const Cifra = ({ etiqueta, p }: { etiqueta: string; p: PorcentajeRanuras }) => (
  <div>
    <dt className="text-[13px] font-semibold text-muted">{etiqueta}</dt>
    <dd className="text-sm">
      {p.pct === null ? (
        <span className="font-semibold">—</span>
      ) : (
        <>
          <span className="text-xl font-semibold">{pct(p.pct, 0, false)}</span>, {p.completas} de {p.total} ranuras
        </>
      )}
    </dd>
  </div>
);

function Filtro({
  nombre,
  etiqueta,
  actual,
  otros,
  opciones,
}: {
  nombre: string;
  etiqueta: string;
  actual: string | undefined;
  otros: Record<string, string | undefined>;
  opciones: { valor: string; texto: string }[];
}) {
  return (
    <>
      <GrupoChips nombre={nombre} etiqueta={etiqueta} actual={actual} otros={otros} opciones={opciones} className="max-md:hidden" />
      <GrupoSelect nombre={nombre} etiqueta={etiqueta} actual={actual} otros={otros} opciones={opciones} className="md:hidden" />
    </>
  );
}

export async function ContenidoRanuras({ searchParams }: { searchParams: Promise<Params> }) {
  const { filtro, valores } = leerRanuras(await searchParams);
  const filtrado = Boolean(valores.activo || valores.estado || valores.resultado);
  const otros = (sin: string) => ({ ...valores, [sin]: undefined });
  return (
    <>
      <div className="mb-4 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:gap-x-10">
        <Filtro
          nombre="activo"
          etiqueta="Activo"
          actual={valores.activo}
          otros={otros("activo")}
          opciones={[TODOS, ...ACTIVOS.map((a) => ({ valor: a, texto: a }))]}
        />
        <Filtro nombre="estado" etiqueta="Estado de la ranura" actual={valores.estado} otros={otros("estado")} opciones={OPCIONES_ESTADO} />
        <Filtro nombre="resultado" etiqueta="Resultado" actual={valores.resultado} otros={otros("resultado")} opciones={OPCIONES_RESULTADO} />
      </div>
      <BloqueConError nombre="las ranuras del decisor">
        <Tabla filtro={filtro} filtrado={filtrado} valores={valores} />
      </BloqueConError>
    </>
  );
}

async function Vacia({ filtrado }: { filtrado: boolean }) {
  if (filtrado) {
    return (
      <Vacio>
        Ninguna ranura coincide con los filtros.{" "}
        <Link href="/ejecuciones?vista=decisor" className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2">
          Quitar los filtros
        </Link>
      </Vacio>
    );
  }
  const { datos: e } = await estado();
  const modo = e.modos?.decisor.efectivo ?? null;
  if (e.decisor.activacion === null && (modo === null || modo === "apagado")) {
    return <Vacio>El decisor está apagado. Se activa en la configuración del despliegue</Vacio>;
  }
  return (
    <Vacio>
      Decisor: {modo ? NOMBRE_MODO[modo] : "modo no disponible"} · sin ranuras todavía. Corre cada hora en el minuto 45; la próxima ranura empieza a las{" "}
      {hora(e.decisor.proximaRanura)}
    </Vacio>
  );
}

const Estado = ({ f }: { f: FilaRanura }) => (
  <span className="inline-flex flex-wrap items-center gap-2">
    <ChipRanura estado={f.estado} />
    {f.enCurso ? <span className="text-xs text-muted">en curso</span> : null}
  </span>
);

function FilaTabla({ f, sufijo }: { f: FilaRanura; sufijo: string }) {
  return (
    <>
      <tr className="min-h-10 border-b border-line align-middle last:border-0">
        <td className="px-2 py-1">{rangoRanura(f.ranura, true).replace(/\s\(UTC.*\)$/, "")}</td>
        <td className="px-2 py-1">
          <Estado f={f} />
        </td>
        <td className="px-2 py-1">{f.modo ? NOMBRE_MODO[f.modo] : "—"}</td>
        <td className="px-2 py-1 font-mono text-[13px]">{f.versionInstrucciones ?? "—"}</td>
        {ACTIVOS.map((a) => (
          <td key={a} className="px-2 py-0">
            {f.estado === "apagado" ? "—" : <Resultado r={f.porActivo[a]} activo={a} ranura={f.ranura} sufijo={sufijo} />}
          </td>
        ))}
      </tr>
      {f.estado === "sin_llegar" ? (
        <tr className="border-b border-line last:border-0">
          <td colSpan={4 + ACTIVOS.length} className="px-2 pb-2 text-xs text-muted">
            {EXPLICACION_SIN_LLEGAR}
          </td>
        </tr>
      ) : null}
    </>
  );
}

async function Tabla({
  filtro,
  filtrado,
  valores,
}: {
  filtro: Parameters<typeof listarRanuras>[0];
  filtrado: boolean;
  valores: Record<string, string | undefined>;
}) {
  const { datos: pagina } = await conHora((ahora) => listarRanuras(filtro, ahora))();
  const filas = pagina.filas;
  const sufijo = `v=${encodeURIComponent(consulta(valores).slice(1))}`;
  return (
    <>
      <dl className="mb-4 flex flex-wrap gap-x-10 gap-y-3" aria-label="Ranuras completas">
        <Cifra etiqueta="Ranuras completas, últimas 24 h" p={pagina.h24} />
        <Cifra etiqueta="Ranuras completas, últimos 7 días" p={pagina.d7} />
      </dl>
      <p className="mb-3 text-xs text-muted">No cuenta las ranuras apagadas ni la que sigue en curso.</p>
      <p className="mb-3 text-sm" aria-live="polite">
        <span className="font-semibold">
          {pagina.total} {pagina.total === 1 ? "resultado" : "resultados"}
        </span>
      </p>
      <Tarjeta className="px-2 md:px-4">
        {filas.length === 0 ? (
          <Vacia filtrado={filtrado} />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table [&_th]:whitespace-nowrap">
              <caption className="sr-only">Ranuras del decisor</caption>
              <thead>
                <tr className="bg-sunken text-[13px] font-semibold">
                  <th scope="col" className="px-2 py-2 text-left">Ranura (UTC−6)</th>
                  <th scope="col" className="px-2 py-2 text-left">Estado</th>
                  <th scope="col" className="px-2 py-2 text-left">Modo</th>
                  <th scope="col" className="px-2 py-2 text-left">Versión de instrucciones</th>
                  {ACTIVOS.map((a) => (
                    <th key={a} scope="col" className="px-2 py-2 text-left">{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <FilaTabla key={f.ranura} f={f} sufijo={sufijo} />
                ))}
              </tbody>
            </table>

            <ul className="flex flex-col md:hidden" aria-label="Ranuras del decisor">
              {filas.map((f) => (
                <li key={f.ranura} className="flex flex-col gap-1 border-b border-line px-2 py-3 text-sm last:border-0">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{rangoRanura(f.ranura, true)}</span>
                    <Estado f={f} />
                  </p>
                  <p className="text-xs text-muted [overflow-wrap:anywhere]">
                    {f.modo ? NOMBRE_MODO[f.modo] : "Modo: —"} · {f.versionInstrucciones ?? "Sin versión"}
                  </p>
                  {f.estado === "sin_llegar" ? <p className="text-xs text-muted">{EXPLICACION_SIN_LLEGAR}</p> : null}
                  {f.estado === "apagado"
                    ? null
                    : ACTIVOS.map((a) => (
                        <div key={a} className="flex items-center gap-3">
                          <span className="w-16 font-semibold">{a}</span>
                          <Resultado r={f.porActivo[a]} activo={a} ranura={f.ranura} sufijo={sufijo} />
                        </div>
                      ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </Tarjeta>
      {filas.length > 0 ? (
        <Paginacion base="/ejecuciones" valores={valores} anterior={pagina.anterior} siguiente={pagina.siguiente} mostrando={filas.length} total={pagina.total} />
      ) : null}
    </>
  );
}
