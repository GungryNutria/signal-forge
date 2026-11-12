import Link from "next/link";
import { notFound } from "next/navigation";
import { detalleEvaluacion } from "@/server/consultas/ejecuciones";
import { conHora } from "../_lib/datos";
import { horaConSegundos, momento, momentoUtc } from "../_lib/formato";
import { paramV, volverAEjecuciones, type Params } from "../_lib/params";
import { Volver } from "./detalle-propuesta";
import { ChipDecision, ChipResultado } from "./estados";
import { ResultadoHipotetico } from "./hipotetico";
import { InvestigacionAdjunta } from "./investigacion-adjunta";
import { leerResultado, ReglaEntrada } from "./regla-entrada";

const objeto = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null ? (x as Record<string, unknown>) : null);

export async function DetalleEvaluacionVista({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; activo: string }>;
  searchParams: Promise<Params>;
}) {
  const { id, activo } = await params;
  const v = paramV(await searchParams);
  const { datos: d } = await conHora(() => detalleEvaluacion(id, activo))();
  if (d === null) notFound();

  const regla = objeto(d.regla);
  const barra = objeto(objeto(d.foto)?.mercado)?.ts_ultima_barra;
  const version = typeof regla?.version === "string" ? regla.version : null;
  const nombre = d.evaluacion.activo;

  return (
    <div className="flex flex-col gap-6">
      <Volver href={`/ejecuciones${volverAEjecuciones(v)}`} texto="Ejecuciones" />
      <header>
        <h1 className="mb-2 flex flex-wrap items-center gap-3 text-2xl leading-[1.25] font-semibold">
          {nombre}
          <ChipResultado r={{ resultado: d.evaluacion.resultado, decision: d.propuesta?.decision }} />
        </h1>
        <p className="text-sm text-muted [overflow-wrap:anywhere]">
          Ejecución <span className="font-mono text-[13px]">{d.ejecucion.id}</span> · inicio {momento(d.ejecucion.inicio)} · {momentoUtc(d.ejecucion.inicio)}
          {d.ejecucion.fin ? ` · fin ${horaConSegundos(d.ejecucion.fin)}` : ""}
        </p>
        {d.propuesta ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            Propuesta de esta evaluación: <ChipDecision decision={d.propuesta.decision} />
            <Link
              href={`/propuestas/${d.propuesta.id}?de=ejecuciones&v=${encodeURIComponent(v ?? "")}`}
              className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-2"
            >
              Ver la propuesta
            </Link>
          </p>
        ) : null}
      </header>

      <ReglaEntrada
        version={version ?? d.evaluacion.versionRegla}
        resultado={leerResultado(regla?.resultado)}
        barra={typeof barra === "string" ? barra : null}
        sinDatos={`La regla no se pudo evaluar${d.evaluacion.errorDetalle ? `: ${d.evaluacion.errorDetalle}` : "."}`}
      />
      <InvestigacionAdjunta activo={nombre} inv={d.investigacion} />
      {d.hipotetico ? <ResultadoHipotetico h={d.hipotetico} origen="senal" /> : null}
    </div>
  );
}
