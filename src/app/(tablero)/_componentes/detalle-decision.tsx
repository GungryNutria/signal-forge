import { notFound, redirect } from "next/navigation";
import { detalleDecision } from "@/server/consultas/decisor";
import type { DecisionVista, ResultadoDecisorActivo } from "@/server/consultas/tipos";
import { conHora } from "../_lib/datos";
import { motivoDecision, NOMBRE_MODO, rangoRanura } from "../_lib/formato";
import { consulta, paramV, vienedeMetricas, volverAEjecuciones, volverAMetricas, type Params } from "../_lib/params";
import { Chip } from "./chip";
import { ContextoDelDecisor } from "./contexto-decisor";
import { DecisionDelDecisor } from "./decision-decisor";
import { Volver } from "./detalle-propuesta";
import { ChipResultadoDecisor } from "./estados";
import { ResultadoHipotetico } from "./hipotetico";
import { RazonamientoLiteral } from "./razonamiento-literal";
import { Tarjeta, TituloBloque } from "./tarjeta";

/** El resultado por activo que tendría esta decisión en el historial de ranuras (mismo vocabulario que S5). */
function resultadoDe(d: DecisionVista): ResultadoDecisorActivo {
  if (!d.valida) return { tipo: "invalida", decisionId: d.id, motivo: d.motivo ?? "desconocido" };
  if (d.decision === "no_comprar") return { tipo: "no_comprar", decisionId: d.id };
  if (d.motivo === "datos_no_disponibles") return { tipo: "comprar_rechazada", decisionId: d.id, motivo: "datos_no_disponibles" };
  return { tipo: "comprar", decisionId: d.id, propuesta: null };
}

/** Motivo del sistema (AC-UX-12): por qué esta decisión no creó una propuesta, con su detalle registrado. */
function MotivoDelSistema({ d }: { d: DecisionVista }) {
  const registrado = d.motivos ?? [];
  return (
    <Tarjeta>
      <TituloBloque>Motivo del sistema</TituloBloque>
      {d.motivo ? (
        <>
          <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <Chip tono={d.valida ? "neutro" : "warn"}>{motivoDecision(d.motivo)}</Chip>
            <span className="text-muted">No creó una propuesta, así que no pasó por las reglas de riesgo.</span>
          </p>
          {registrado.length > 0 ? (
            <ul className="text-sm">
              {registrado.map((m, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {d.motivo === "contexto_vencido" ? (
                    <>Contexto vencido: {m.motivo}</>
                  ) : (
                    <>
                      <span className="font-mono text-[13px]">{m.campo.slice(0, 80)}</span>: {m.motivo}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : d.decision === "no_comprar" ? (
        <p className="text-sm">No comprar: el decisor decidió no comprar, así que no se creó una propuesta.</p>
      ) : (
        <p className="text-sm">
          Solo registro: el decisor está en Solo registra, así que su decisión de comprar no pasó por las reglas de riesgo ni envió una orden. El modo se
          cambia en la configuración del despliegue.
        </p>
      )}
    </Tarjeta>
  );
}

export async function DetalleDecisionVista({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  const { id } = await params;
  const sp = await searchParams;
  const v = paramV(sp);
  const deMetricas = vienedeMetricas(sp);
  const { datos: det } = await conHora((ahora) => detalleDecision(id, ahora))();
  if (det === null) notFound();

  // Una decisión que creó una propuesta se audita en S3: no hay dos páginas para lo mismo.
  if (det.propuestaId) redirect(`/propuestas/${det.propuestaId}${consulta({ de: deMetricas ? "metricas" : "ejecuciones", v })}`);

  const d = det.decision;
  return (
    <div className="flex flex-col gap-6">
      <Volver
        href={deMetricas ? `/metricas${volverAMetricas(v)}` : `/ejecuciones${volverAEjecuciones(v)}`}
        texto={deMetricas ? "Métricas" : "Ejecuciones"}
      />
      <header>
        <h1 className="mb-2 flex flex-wrap items-center gap-3 text-2xl leading-[1.25] font-semibold">
          {d.activo ?? "Decisión sin activo"}
          <ChipResultadoDecisor r={resultadoDe(d)} />
        </h1>
        <p className="text-sm text-muted [overflow-wrap:anywhere]">
          Ranura {rangoRanura(d.ranura, true)} · Modo: {d.modoEfectivo ? NOMBRE_MODO[d.modoEfectivo] : "—"}
        </p>
      </header>

      <DecisionDelDecisor d={d} sistema="Motivo del sistema" />
      <MotivoDelSistema d={d} />
      {det.hipotetico ? <ResultadoHipotetico h={det.hipotetico} origen="decision" /> : null}
      {!d.valida && d.cuerpoCrudo !== null ? (
        <Tarjeta>
          <TituloBloque>Contenido recibido</TituloBloque>
          <RazonamientoLiteral
            id={`recibido-${d.id}`}
            texto={d.cuerpoCrudo}
            rotulo="Contenido recibido (texto del agente, literal)"
            nota="El sistema lo guardó tal como llegó y no lo interpretó."
          />
        </Tarjeta>
      ) : null}
      <ContextoDelDecisor contexto={det.contexto} />
    </div>
  );
}
