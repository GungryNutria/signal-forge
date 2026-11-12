import type { LoteAbierto } from "@/server/consultas/tipos";
import { cartera, estado } from "../_lib/datos";
import { cripto, hora, NOMBRE_PROPONENTE, signo, unidad, usd, usdConSigno } from "../_lib/formato";
import { Chip } from "./chip";
import { Barra, Cargando } from "./esqueleto";
import { Vacio } from "./tarjeta";

const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;

const NoDisponible = () => <span className="text-muted">No disponible</span>;

/** `100,000.00 USD` con la moneda más chica, para que seis columnas de importes quepan en la tarjeta. */
function Monto({ texto }: { texto: string }) {
  return (
    <>
      {texto.slice(0, -4)} <span className="text-xs text-muted">USD</span>
    </>
  );
}

function Pnl({ lote }: { lote: LoteAbierto }) {
  if (lote.pnlNoRealizadoUsd === null) return <NoDisponible />;
  return (
    <span className={COLOR[signo(lote.pnlNoRealizadoUsd)]}>
      <Monto texto={usdConSigno(lote.pnlNoRealizadoUsd)} />
    </span>
  );
}

const Precio = ({ lote }: { lote: LoteAbierto }) =>
  lote.precioActual === null ? <NoDisponible /> : <Monto texto={usd(lote.precioActual)} />;

/** AC-UX-6: entradas abiertas por activo frente al tope. Neutro: en el tope solo dice qué pasará, sin alerta. */
function EntradasAbiertas({ filas, tope }: { filas: { activo: string; n: number }[]; tope: number | null }) {
  if (filas.length === 0) return null;
  return (
    <ul aria-label="Entradas abiertas por activo" data-entradas-abiertas className="mb-3 flex flex-col gap-1 text-sm">
      {filas.map(({ activo, n }) => (
        <li key={activo} className="[overflow-wrap:anywhere]">
          <span className="font-semibold">{activo}</span> · {n} {n === 1 ? "entrada abierta" : "entradas abiertas"} · {tope === null ? "tope no disponible" : `tope ${tope}`}
          {tope !== null && n >= tope ? ": las entradas nuevas se rechazan por R11" : ""}
        </li>
      ))}
    </ul>
  );
}

export async function PosicionesAbiertas() {
  const { datos: c } = await cartera();
  if (c.lotesAbiertos.length === 0 && c.entradasAbiertas.length === 0) return <Vacio>Sin posiciones abiertas</Vacio>;
  const entradas = <EntradasAbiertas filas={c.entradasAbiertas} tope={c.topeEntradasPorActivo} />;
  if (c.lotesAbiertos.length === 0) return entradas;

  const sinPrecio = c.lotesAbiertos.some((l) => l.precioActual === null);
  const lectura = sinPrecio
    ? await estado()
        .then((r) => r.datos.broker.leidoEn)
        .catch(() => null)
    : null;

  return (
    <>
      {entradas}
      {sinPrecio ? (
        <div className="mb-3">
          <Chip tono="warn">{lectura ? `Última lectura ${hora(lectura)}, desactualizada` : "Desactualizada"}</Chip>
        </div>
      ) : null}

      {/* Si el ancho no alcanza (precios de 6 cifras), la tabla se desplaza dentro de su tarjeta, nunca la página. */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Posiciones abiertas, tabla desplazable"
        className="hidden overflow-x-auto md:block"
      >
      <table className="w-full text-sm whitespace-nowrap">
        <caption className="sr-only">Posiciones abiertas</caption>
        <thead>
          <tr className="bg-sunken text-[13px] font-semibold">
            <th scope="col" className="px-1.5 py-2 text-left">Activo</th>
            <th scope="col" className="px-1.5 py-2 text-left">Proponente</th>
            <th scope="col" className="px-1.5 py-2 text-right">Cantidad</th>
            <th scope="col" className="px-1.5 py-2 text-right">Entrada</th>
            <th scope="col" className="px-1.5 py-2 text-right">Stop loss</th>
            <th scope="col" className="px-1.5 py-2 text-right">Take profit</th>
            <th scope="col" className="px-1.5 py-2 text-right">Precio actual</th>
            <th scope="col" className="px-1.5 py-2 text-right">PnL no realizado</th>
          </tr>
        </thead>
        <tbody>
          {c.lotesAbiertos.map((l) => (
            <tr key={l.loteId} className="h-10 border-b border-line last:border-0">
              <th scope="row" className="px-1.5 text-left font-semibold">{l.activo}</th>
              <td className="px-1.5 text-left">{NOMBRE_PROPONENTE[l.proponente]}</td>
              <td className="px-1.5 text-right">{cripto(l.cantidad, unidad(l.activo))}</td>
              <td className="px-1.5 text-right"><Monto texto={usd(l.precioEntrada)} /></td>
              <td className="px-1.5 text-right"><Monto texto={usd(l.stopLoss)} /></td>
              <td className="px-1.5 text-right"><Monto texto={usd(l.takeProfit)} /></td>
              <td className="px-1.5 text-right"><Precio lote={l} /></td>
              <td className="px-1.5 text-right"><Pnl lote={l} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {c.lotesAbiertos.map((l) => (
          <li key={l.loteId} className="border-b border-line pb-3 last:border-0 last:pb-0">
            <p className="mb-2 text-sm">
              <span className="font-semibold">{l.activo}</span> <span className="ml-1">{cripto(l.cantidad, unidad(l.activo))}</span> · {NOMBRE_PROPONENTE[l.proponente]}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Dato t="Entrada">{usd(l.precioEntrada)}</Dato>
              <Dato t="Precio actual"><Precio lote={l} /></Dato>
              <Dato t="Stop loss">{usd(l.stopLoss)}</Dato>
              <Dato t="Take profit">{usd(l.takeProfit)}</Dato>
              <Dato t="PnL no realizado"><Pnl lote={l} /></Dato>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function Dato({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{t}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PosicionesEsqueleto() {
  return (
    <Cargando etiqueta="las posiciones abiertas">
      <div className="flex flex-col gap-3">
        <Barra alto="h-8" />
        <Barra alto="h-6" />
      </div>
    </Cargando>
  );
}
