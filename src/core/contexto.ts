import { ACTIVOS, type Activo } from "./activos";
import { aCentavos, deCentavos } from "./dinero";
import { type BarraMercado, type EntradaFoto, type InvestigacionAdjunta, mercadoFoto } from "./foto";
import { VIGENCIA_MIN } from "./investigacion";
import { TENDENCIA_SMA_V1 } from "./regla/tendencia-sma-v1";
import { MAX_ENTRADAS_DIA, PCT_MAX_EXPOSICION, PCT_MAX_OPERACION } from "./riesgo";
import { minutosEntre } from "./tiempo";

export const VIGENCIA_CONTEXTO_MIN = 15;
const SERIE_BARRAS = 48; // 24 h de barras de 30 min

export type ProponenteVista = "ciclo" | "decisor";
export type EntradaAbierta = {
  /** `pendiente_llenado`: orden viva sin lote; no tiene precios ni PnL. */
  estado: "abierta" | "pendiente_llenado";
  abiertaEn: Date;
  proponente: ProponenteVista;
  precioEntrada: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnlNoRealizadoC: number | null;
};

export type EntradaContexto = {
  id: string;
  creadoEn: Date;
  modoTrading: "operando" | "pausa_manual" | "pausa_automatica";
  /** N de R11; `null` si la configuración es inválida (las entradas están detenidas y el contexto lo dice). */
  maxEntradasAbiertasPorActivo: number | null;
  entradasHoy: number;
  cartera: {
    saldoVirtualC: number;
    /** Lotes abiertos más entradas vivas sin lote (el costo que ve R4). */
    exposicionC: number;
    exposicionPorActivoC: Record<Activo, number>;
    pnlDiaC: number | null;
  };
  activos: Record<
    Activo,
    {
      mercado: EntradaFoto["mercado"];
      /** Motivo de "datos no disponibles" (`motivoSinDatos`); `null` si hay datos. */
      sinDatos: string | null;
      /** La última aceptada del activo, aunque esté vencida. */
      investigacion: InvestigacionAdjunta | null;
      entradasAbiertas: readonly EntradaAbierta[];
      bloqueadoR9: boolean;
      historial: {
        entradas: readonly { t: Date; precioEntrada: number; proponente: ProponenteVista }[];
        cierres: readonly { t: Date; motivo: "take_profit" | "stop_loss"; pnlNetoC: number }[];
      };
    }
  >;
};

const iso = (d: Date) => d.toISOString();
const num = (n: number) => String(n);

/**
 * `contexto-v1` (REQ-3 a REQ-6). Pura. Lo que no se puede calcular va `null` y nombrado en `faltantes`; nunca se
 * inventa un valor. No recibe ni la regla fija, ni razonamientos previos, ni configuración interna (REQ-5):
 * lo que no entra aquí no puede salir.
 */
export function armarContexto(e: EntradaContexto) {
  const T = e.creadoEn;
  const { cartera: k } = e;
  const saldoLibreC = k.saldoVirtualC - k.exposicionC;
  const topeExposicionC = Math.floor((k.saldoVirtualC * PCT_MAX_EXPOSICION) / 100);

  return {
    version: "contexto-v1" as const,
    id: e.id,
    creado_en: iso(T),
    vigencia_min: VIGENCIA_CONTEXTO_MIN,
    estado: {
      modo_trading: e.modoTrading,
      limites: {
        nocional_por_entrada_usd: deCentavos(aCentavos(TENDENCIA_SMA_V1.nocionalUsd)),
        r3_max_nocional_pct: String(PCT_MAX_OPERACION),
        r4_max_exposicion_pct: String(PCT_MAX_EXPOSICION),
        r5_max_entradas_dia: MAX_ENTRADAS_DIA,
        r11_max_entradas_abiertas_por_activo: e.maxEntradasAbiertasPorActivo,
      },
      entradas_hoy: e.entradasHoy,
      margen_entradas_dia: Math.max(0, MAX_ENTRADAS_DIA - e.entradasHoy),
      margen_exposicion_usd: deCentavos(Math.max(0, topeExposicionC - k.exposicionC)),
    },
    cartera: {
      saldo_virtual_usd: deCentavos(k.saldoVirtualC),
      saldo_libre_usd: deCentavos(saldoLibreC),
      exposicion_total_usd: deCentavos(k.exposicionC),
      exposicion_por_activo_usd: Object.fromEntries(
        ACTIVOS.map((a) => [a, deCentavos(k.exposicionPorActivoC[a])]),
      ) as Record<Activo, string>,
      pnl_dia_usd: k.pnlDiaC === null ? null : deCentavos(k.pnlDiaC),
      faltantes: k.pnlDiaC === null ? ["pnl_dia_usd"] : [],
    },
    activos: Object.fromEntries(ACTIVOS.map((a) => [a, activo(e.activos[a], e.maxEntradasAbiertasPorActivo, T)])) as Record<
      Activo,
      ReturnType<typeof activo>
    >,
  };
}

export type ContextoV1 = ReturnType<typeof armarContexto>;

function activo(a: EntradaContexto["activos"][Activo], n: number | null, T: Date) {
  const serie = a.mercado.barras
    .filter((b: BarraMercado) => Date.parse(b.t) + 30 * 60_000 <= T.getTime())
    .sort((x, y) => Date.parse(x.t) - Date.parse(y.t))
    .slice(-SERIE_BARRAS)
    .map((b) => ({ t: b.t, c: num(b.c) }));
  const i = a.investigacion;
  const antiguedad = i ? minutosEntre(i.recibidaEn, T) : 0;
  return {
    datos: a.sinDatos === null ? ("disponibles" as const) : ("no_disponibles" as const),
    motivo_no_disponibles: a.sinDatos,
    mercado: { ...mercadoFoto(a.mercado, T), serie_30m: serie },
    investigacion:
      i && i.recibidaEn.getTime() <= T.getTime()
        ? {
            estado: "adjunta" as const,
            id: i.id,
            recibida_en: iso(i.recibidaEn),
            antiguedad_min: antiguedad,
            vigente: antiguedad < VIGENCIA_MIN,
            sentimiento: num(i.sentimiento),
            noticia_fuerte: i.noticiaFuerte,
            confianza: num(i.confianza),
            resumen: i.resumen,
            fuentes: i.fuentes,
            version_instrucciones: i.versionInstrucciones,
          }
        : { estado: "sin_investigacion" as const },
    entradas_abiertas: a.entradasAbiertas.map((x) => ({
      estado: x.estado,
      abierta_en: iso(x.abiertaEn),
      antiguedad_min: minutosEntre(x.abiertaEn, T),
      proponente: x.proponente,
      precio_entrada: x.precioEntrada === null ? null : num(x.precioEntrada),
      stop_loss: x.stopLoss === null ? null : num(x.stopLoss),
      take_profit: x.takeProfit === null ? null : num(x.takeProfit),
      pnl_no_realizado_usd: x.pnlNoRealizadoC === null ? null : deCentavos(x.pnlNoRealizadoC),
    })),
    entradas_abiertas_n: a.entradasAbiertas.length,
    margen_r11: n === null ? null : Math.max(0, n - a.entradasAbiertas.length),
    bloqueado_r9: a.bloqueadoR9,
    historial_24h: {
      entradas: a.historial.entradas.map((x) => ({ t: iso(x.t), precio_entrada: num(x.precioEntrada), proponente: x.proponente })),
      cierres: a.historial.cierres.map((x) => ({ t: iso(x.t), motivo: x.motivo, pnl_neto_usd: deCentavos(x.pnlNetoC) })),
    },
  };
}
