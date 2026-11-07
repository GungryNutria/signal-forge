import type { InvestigacionVista } from "@/server/consultas/tipos";
import { confianza, hora, sentimiento } from "../_lib/formato";
import { Chip } from "./chip";
import { Fuente, RotuloInformativa } from "./investigacion";
import { TituloBloque } from "./tarjeta";

/**
 * Investigación adjunta a una evaluación (S3 y S5): después de la regla, con el rótulo fijo (AC-UX-25, AC-UX-29).
 * Texto de terceros: literal y completo; las fuentes muestran su dominio (AC-UX-13). Todas las fuentes, también en móvil.
 */
export function InvestigacionAdjunta({ activo, inv }: { activo: string | null; inv: InvestigacionVista | null }) {
  return (
    <section aria-labelledby="titulo-adjunta" className="rounded-md border border-dashed border-strong p-4">
      <TituloBloque id="titulo-adjunta" className="text-info">
        Investigación adjunta
      </TituloBloque>
      <RotuloInformativa />
      {inv === null ? (
        <>
          <Chip>Sin investigación</Chip>
          <p className="mt-2 text-sm text-muted">Esta evaluación no tuvo una investigación vigente adjunta.</p>
        </>
      ) : (
        <>
          <p className="mb-3 flex flex-wrap items-center gap-2 text-base font-semibold">
            {activo}
            <span className="font-normal">{hora(inv.recibidaEn)}</span>
            <Chip tono={inv.vigente ? "info" : "warn"}>{inv.vigente ? "Vigente" : "Vencida"}</Chip>
          </p>
          <div className="grid gap-x-10 gap-y-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <dl className="grid grid-cols-[auto_1fr] content-start gap-x-6 gap-y-1 text-sm">
              <dt className="font-semibold text-muted">Antigüedad</dt>
              <dd>{inv.antiguedadMin} min al evaluar</dd>
              <dt className="font-semibold text-muted">Sentimiento</dt>
              <dd>{sentimiento(inv.sentimiento)}</dd>
              <dt className="font-semibold text-muted">Noticia fuerte</dt>
              <dd>{inv.noticiaFuerte ? "Sí" : "No"}</dd>
              <dt className="font-semibold text-muted">Confianza</dt>
              <dd>{confianza(inv.confianza)}</dd>
              <dt className="font-semibold text-muted">Versión de instrucciones</dt>
              <dd className="font-mono text-[13px]">{inv.versionInstrucciones}</dd>
            </dl>
            <div className="min-w-0">
              <p className="text-base [overflow-wrap:anywhere] whitespace-pre-line">{inv.resumen}</p>
              {inv.fuentes.length > 0 ? (
                <>
                  <h3 className="mt-3 mb-1 text-[13px] font-semibold text-muted">Fuentes</h3>
                  <ul className="flex flex-col gap-1.5">
                    {inv.fuentes.map((u, i) => (
                      <Fuente key={`${i}-${u}`} url={u} />
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
