import { ACTIVOS } from "@/core/activos";
import { proximaInvestigacion } from "@/core/tiempo";
import type { InvestigacionVista } from "@/server/consultas/tipos";
import { investigaciones } from "../_lib/datos";
import { confianza, dominio, hora, relativo, sentimiento } from "../_lib/formato";
import { Chip } from "./chip";
import { Barra, Cargando } from "./esqueleto";
import { IconoCirculo, IconoEnlaceExterno } from "./iconos";
import { Vacio } from "./tarjeta";

/** Rótulo fijo (AC-UX-25): la investigación nunca es el motivo de una decisión. */
export function RotuloInformativa() {
  return (
    <p className="mb-4 inline-flex max-w-full items-center gap-2 border-l-[3px] border-info bg-info-bg px-3 py-1 text-sm">
      <span className="text-info">
        <IconoCirculo />
      </span>
      Informativa: no interviene en la decisión de entrada
    </p>
  );
}

function Fuente({ url }: { url: string }) {
  const { dominio: d, enlazable } = dominio(url);
  return (
    <li className="min-w-0">
      {enlazable ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-accent underline underline-offset-2 md:min-h-0"
        >
          {d}
          <IconoEnlaceExterno />
          <span className="sr-only">(se abre fuera del tablero)</span>
        </a>
      ) : (
        <span className="text-[13px] font-semibold">{d}</span>
      )}
      <p className="truncate text-xs text-muted" title={url}>
        {url}
      </p>
    </li>
  );
}

function PorActivo({ activo, inv }: { activo: string; inv: InvestigacionVista | null }) {
  const idTitulo = `inv-${activo.replace("/", "-")}`;
  if (inv === null) {
    return (
      <section aria-labelledby={idTitulo} className="border-t border-line pt-4 first:border-0 first:pt-0">
        <h3 id={idTitulo} className="mb-1 text-base font-semibold">
          {activo}
        </h3>
        <Chip>Sin investigación</Chip>
        <p className="mt-2 text-sm text-muted">Todavía no hay una investigación aceptada de este activo.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={idTitulo} className="border-t border-line pt-4 first:border-0 first:pt-0">
      <h3 id={idTitulo} className="mb-2 text-base font-semibold">
        {activo} <span className="font-normal">{hora(inv.recibidaEn)}</span>{" "}
        <span className="text-xs font-normal text-muted">· {relativo(inv.antiguedadMin)}</span>
      </h3>
      <Chip tono={inv.vigente ? "info" : "warn"}>
        {inv.vigente ? "Vigente: se adjunta a las evaluaciones" : "Vencida: las evaluaciones van sin investigación"}
      </Chip>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="font-semibold text-muted">Sentimiento</dt>
        <dd>{sentimiento(inv.sentimiento)}</dd>
        <dt className="font-semibold text-muted">Noticia fuerte</dt>
        <dd>{inv.noticiaFuerte ? "Sí" : "No"}</dd>
        <dt className="font-semibold text-muted">Confianza</dt>
        <dd>{confianza(inv.confianza)}</dd>
      </dl>
      {/* Texto de terceros: texto literal, completo y sin enlaces (AC-UX-13). */}
      <p className="mt-3 text-base [overflow-wrap:anywhere] whitespace-pre-line">{inv.resumen}</p>
      {inv.fuentes.length > 0 ? (
        <>
          <h4 className="mt-3 mb-1 text-[13px] font-semibold text-muted">Fuentes</h4>
          <ul className="flex flex-col gap-1.5">
            {inv.fuentes.map((u, i) => (
              <Fuente key={`${i}-${u}`} url={u} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export async function Investigacion() {
  const { ahora, datos } = await investigaciones();
  if (ACTIVOS.every((a) => datos[a] === null)) {
    return (
      <Vacio>
        Aún no llega ninguna investigación. Llega cada hora; la próxima se espera a las{" "}
        {hora(proximaInvestigacion(ahora).toISOString())}
      </Vacio>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {ACTIVOS.map((a) => (
        <PorActivo key={a} activo={a} inv={datos[a]} />
      ))}
    </div>
  );
}

export function InvestigacionEsqueleto() {
  return (
    <Cargando etiqueta="la investigación">
      <div className="flex flex-col gap-2">
        {["w-1/3", "w-2/3", "w-5/6", "w-3/4", "w-full", "w-full", "w-1/2", "w-1/3", "w-2/3", "w-5/6", "w-3/4", "w-full"].map(
          (w, i) => (
            <Barra key={i} ancho={w} />
          ),
        )}
      </div>
    </Cargando>
  );
}
