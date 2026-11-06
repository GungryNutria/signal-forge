import Link from "next/link";
import { consulta } from "../_lib/params";
import { SelectEnvio } from "./select-envio";

// Filtros con formularios GET: cada grupo es un <form> que conserva los demás filtros como campos ocultos y descarta
// el cursor (cambiar un filtro vuelve a la primera página). Sin server actions ni fetch del navegador.
type Opcion = { valor: string; texto: string };

const limpiar = (otros: Record<string, string | undefined>) => Object.entries(otros).filter(([k, v]) => v && k !== "cursor");

function Ocultos({ otros }: { otros: Record<string, string | undefined> }) {
  return limpiar(otros).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
}

export function GrupoChips({
  nombre,
  etiqueta,
  opciones,
  actual,
  otros,
  className = "",
}: {
  nombre: string;
  etiqueta: string;
  opciones: Opcion[];
  actual: string | undefined;
  otros: Record<string, string | undefined>;
  className?: string;
}) {
  const id = `grupo-${nombre}`;
  return (
    <form method="get" role="group" aria-labelledby={id} className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Ocultos otros={otros} />
      <span id={id} className="w-full text-[13px] font-semibold text-muted md:w-auto md:pr-1">
        {etiqueta}
      </span>
      {opciones.map((o) => {
        const on = (actual ?? "") === o.valor;
        return (
          <button
            key={o.valor}
            type="submit"
            name={nombre}
            value={o.valor}
            aria-pressed={on}
            className={`min-h-11 rounded-sm border px-3 text-[13px] font-semibold md:min-h-8 ${
              on ? "border-accent bg-accent text-bg" : "border-strong text-ink hover:bg-sunken"
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </form>
  );
}

export function GrupoSelect({
  nombre,
  etiqueta,
  opciones,
  actual,
  otros,
  className = "",
}: {
  nombre: string;
  etiqueta: string;
  opciones: Opcion[];
  actual: string | undefined;
  otros: Record<string, string | undefined>;
  className?: string;
}) {
  const id = `select-${nombre}`;
  return (
    <form method="get" className={`flex flex-col gap-1 ${className}`}>
      <Ocultos otros={otros} />
      <label htmlFor={id} className="text-[13px] font-semibold text-muted">
        {etiqueta}
      </label>
      <SelectEnvio id={id} nombre={nombre} actual={actual ?? ""} opciones={opciones} />
      <noscript>
        <button type="submit" className="min-h-11 rounded-sm border border-strong px-3 text-[13px] font-semibold">
          Aplicar
        </button>
      </noscript>
    </form>
  );
}

/** Enlaces "Más recientes" / "Anteriores". `anterior` es el cursor hacia lo más reciente; `siguiente`, hacia lo más antiguo. */
export function Paginacion({
  base,
  valores,
  anterior,
  siguiente,
  mostrando,
  total,
}: {
  base: string;
  valores: Record<string, string | undefined>;
  anterior: string | null;
  siguiente: string | null;
  mostrando: number;
  total: number;
}) {
  const clase = "inline-flex min-h-11 items-center justify-center rounded-sm border px-3 text-sm font-semibold whitespace-nowrap md:px-4";
  const ir = (cursor: string) => `${base}${consulta({ ...valores, cursor })}`;
  return (
    <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-3">
      {anterior ? (
        <Link href={ir(anterior)} className={`${clase} border-strong text-accent`} rel="prev">
          ‹ Más recientes
        </Link>
      ) : (
        <span aria-disabled="true" className={`${clase} border-line text-muted opacity-60`}>
          ‹ Más recientes
        </span>
      )}
      <p className="text-center text-sm text-muted">
        Mostrando {mostrando} de {total}
      </p>
      {siguiente ? (
        <Link href={ir(siguiente)} className={`${clase} border-strong text-accent`} rel="next">
          Anteriores ›
        </Link>
      ) : (
        <span aria-disabled="true" className={`${clase} border-line text-muted opacity-60`}>
          Anteriores ›
        </span>
      )}
    </nav>
  );
}
