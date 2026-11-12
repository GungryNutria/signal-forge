import type { DecisionVista } from "@/server/consultas/tipos";
import { confianza, momento, momentoUtc, NOMBRE_MODO, rangoRanura } from "../_lib/formato";
import { Chip } from "./chip";
import { Dato, Datos, Mono } from "./datos";
import { RazonamientoLiteral } from "./razonamiento-literal";
import { Tarjeta, TituloBloque } from "./tarjeta";

const NOMBRE_DECISION = { comprar: "Comprar", no_comprar: "No comprar" } as const;

/**
 * "Decisión del decisor" (AC-UX-6): lo que escribió el agente y los datos del envío. Sustituye a "Regla de entrada evaluada"
 * en S3 y abre el detalle de una decisión. `sistema` nombra el bloque donde está la decisión real, la del riesgo.
 */
export function DecisionDelDecisor({ d, sistema = "Reglas de riesgo" }: { d: DecisionVista; sistema?: string }) {
  return (
    <Tarjeta>
      <TituloBloque>Decisión del decisor</TituloBloque>
      <Datos>
        <Dato etiqueta="Decisión">
          {d.decision ? <Chip tono={d.decision === "comprar" ? "solido" : "neutro"}>{NOMBRE_DECISION[d.decision]}</Chip> : "—"}
        </Dato>
        <Dato etiqueta="Confianza">{d.confianza === null ? "No disponible" : confianza(d.confianza)}</Dato>
        <Dato etiqueta="Versión de instrucciones">
          <Mono>{d.versionInstrucciones ?? "—"}</Mono>
        </Dato>
        <Dato etiqueta="Modo">{d.modoEfectivo ? NOMBRE_MODO[d.modoEfectivo] : "—"}</Dato>
        <Dato etiqueta="Ranura">{rangoRanura(d.ranura, true)}</Dato>
        <Dato etiqueta="Ejecución del decisor">
          <Mono>{d.ejecucionDecisor ?? "—"}</Mono>
        </Dato>
        <Dato etiqueta="Recibida (Torreón)">{momento(d.recibidaEn)}</Dato>
        <Dato etiqueta="Recibida (UTC)">{momentoUtc(d.recibidaEn)}</Dato>
      </Datos>
      <div className="mt-4">
        <RazonamientoLiteral
          id={`razonamiento-${d.id}`}
          texto={d.razonamiento}
          nota={`Lo anterior es texto escrito por el agente. La decisión del sistema está en «${sistema}».`}
        />
      </div>
    </Tarjeta>
  );
}
