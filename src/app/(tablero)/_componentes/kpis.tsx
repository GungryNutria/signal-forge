import type { ReactNode } from "react";
import { cartera, estado } from "../_lib/datos";
import { hora, horaConSegundos, signo, usd, usdConSigno } from "../_lib/formato";
import { Chip } from "./chip";
import { Barra, Cargando } from "./esqueleto";
import { Tarjeta } from "./tarjeta";

const COLOR = { "-1": "text-neg", "0": "text-ink", "1": "text-pos" } as const;

function Kpi({ etiqueta, children, contexto }: { etiqueta: string; children: ReactNode; contexto: ReactNode }) {
  return (
    <Tarjeta className="flex flex-col gap-1.5">
      <h3 className="text-[13px] leading-[1.3] font-semibold text-muted">{etiqueta}</h3>
      <div className="text-xl leading-[1.2] font-semibold md:text-2xl">{children}</div>
      <div className="text-xs text-muted">{contexto}</div>
    </Tarjeta>
  );
}

/** `10,184.20 USD`, con el sufijo más chico en móvil para que quepa en 2 columnas. */
function Importe({ texto }: { texto: string }) {
  const [cifra, moneda] = [texto.slice(0, -4), texto.slice(-3)];
  return (
    <>
      {cifra} <span className="text-[13px] md:text-[1em]">{moneda}</span>
    </>
  );
}

const NoDisponible = () => <span className="text-base font-semibold text-muted md:text-xl">No disponible</span>;

export async function Kpis() {
  const { ahora, datos: c } = await cartera();
  // La hora de la última lectura del broker viene de la banda; si esa fuente falla, el aviso va sin hora.
  const lectura = await estado()
    .then((r) => r.datos.broker.leidoEn)
    .catch(() => null);
  const desactualizada = (
    <Chip tono="warn">{lectura ? `Última lectura ${hora(lectura)}, desactualizada` : "Desactualizada"}</Chip>
  );
  const ahoraIso = ahora.toISOString();

  return (
    <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
      <Kpi etiqueta="Saldo virtual" contexto={c.vacio ? "saldo inicial" : "sobre saldo realizado"}>
        <Importe texto={usd(c.saldoVirtualUsd)} />
      </Kpi>
      <Kpi
        etiqueta="Valor de cartera"
        contexto={c.valorCarteraUsd === null ? desactualizada : `a las ${horaConSegundos(ahoraIso)}`}
      >
        {c.valorCarteraUsd === null ? <NoDisponible /> : <Importe texto={usd(c.valorCarteraUsd)} />}
      </Kpi>
      <Kpi etiqueta="PnL del día" contexto={c.pnlDiaUsd === null && !c.vacio ? desactualizada : "día UTC"}>
        {c.vacio ? (
          "—"
        ) : c.pnlDiaUsd === null ? (
          <NoDisponible />
        ) : (
          <span className={COLOR[signo(c.pnlDiaUsd)]}>
            <Importe texto={usdConSigno(c.pnlDiaUsd)} />
          </span>
        )}
      </Kpi>
      <Kpi etiqueta="PnL acumulado" contexto="realizado, desde el inicio">
        {c.vacio ? (
          "—"
        ) : (
          <span className={COLOR[signo(c.pnlAcumuladoUsd)]}>
            <Importe texto={usdConSigno(c.pnlAcumuladoUsd)} />
          </span>
        )}
      </Kpi>
    </section>
  );
}

export function KpisEsqueleto() {
  return (
    <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
      {["Saldo virtual", "Valor de cartera", "PnL del día", "PnL acumulado"].map((e) => (
        <Tarjeta key={e} className="flex flex-col gap-1.5">
          <h3 className="text-[13px] leading-[1.3] font-semibold text-muted">{e}</h3>
          <Cargando etiqueta={e}>
            <div className="flex flex-col gap-2 pt-1">
              <Barra ancho="w-3/4" alto="h-6" />
              <Barra ancho="w-1/2" alto="h-3" />
            </div>
          </Cargando>
        </Tarjeta>
      ))}
    </section>
  );
}
