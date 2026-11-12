import type { HipoteticoVista } from "@/server/consultas/tipos";
import { hora, horaCorta, momento, usd, usdConSigno, pct } from "../_lib/formato";
import { Chip } from "./chip";
import { Dato, Datos } from "./datos";
import { Tarjeta, TituloBloque } from "./tarjeta";

/** Rótulo del resultado hipotético (vocabulario de la spec). Siempre neutro: los colores de dinero son del PnL real (AC-UX-14). */
export const TEXTO_HIPOTETICO = {
  take_profit: "Habría cerrado por take profit",
  stop_loss: "Habría cerrado por stop loss",
  pendiente: "Pendiente (hipotético)",
  sin_precio_entrada: "Sin precio de entrada",
} as const;

export const ChipHipotetico = ({ clave }: { clave: keyof typeof TEXTO_HIPOTETICO }) => <Chip>{TEXTO_HIPOTETICO[clave]}</Chip>;

const claveDe = (h: HipoteticoVista) => (h.estado === "resuelto" ? h.resultado : h.estado);

const SIN_PRECIO = "Sin precio de entrada: el activo no tenía datos de mercado al decidir, así que no se calcula un resultado hipotético";

/** `de 14:00 a 15:30 (UTC−6)`: un hueco de muestras (solo para los huecos, nunca para "sin precio de entrada"). */
const hueco = (h: { desde: string; hasta: string }) => `Sin datos de precio de ${horaCorta(h.desde)} a ${hora(h.hasta)}`;

/**
 * Resultado hipotético de una entrada evitada o de una señal registrada (REQ-20, AC-UX-13, AC-UX-14). Cada cifra lleva la
 * palabra "hipotético" junto a ella, en texto, en tinta neutra. El PnL es a nivel de stop loss o take profit.
 */
export function ResultadoHipotetico({ h, origen }: { h: HipoteticoVista; origen: "decision" | "senal" }) {
  return (
    <Tarjeta>
      <TituloBloque>Resultado hipotético</TituloBloque>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <ChipHipotetico clave={claveDe(h)} />
        <span className="text-muted">
          {origen === "decision" ? "El decisor no compró; esto es lo que habría pasado." : "El ciclo solo registró la señal; esto es lo que habría pasado."}
        </span>
      </p>
      {h.estado === "sin_precio_entrada" ? (
        <p className="text-sm">{SIN_PRECIO}</p>
      ) : (
        <Datos>
          <Dato etiqueta="Precio de entrada (hipotético)">{usd(h.precioEntrada)}</Dato>
          {h.estado === "resuelto" ? (
            <>
              <Dato etiqueta="Tocó el nivel (Torreón)">{momento(h.tocadoEn)}</Dato>
              <Dato etiqueta="PnL a nivel (hipotético)">
                {usdConSigno(h.pnlANivelUsd)} · {pct(Number(h.pnlANivelPct) * 100, 2)}
                <span className="block text-xs text-muted">hipotético, a nivel de stop loss o take profit, sin comisiones</span>
              </Dato>
            </>
          ) : null}
        </Datos>
      )}
      {h.estado !== "sin_precio_entrada" && h.huecos.length > 0 ? (
        <ul className="mt-3 text-sm text-muted">
          {h.huecos.map((x) => (
            <li key={x.desde}>{hueco(x)}</li>
          ))}
        </ul>
      ) : null}
    </Tarjeta>
  );
}
