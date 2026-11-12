import type { Activo } from "./activos";
import { deCentavos } from "./dinero";
import type { InvestigacionGuardada } from "./investigacion";
import type { ResultadoTendenciaSma } from "./regla/tendencia-sma-v1";
import { minutosEntre } from "./tiempo";

const MEDIA_HORA_MS = 30 * 60_000;

/** Barra de 30 min de Alpaca: `t` es su inicio. */
export type BarraMercado = { t: string; c: number; v: number };
export type DatoConTs = { valor: number; ts: Date };

export type InvestigacionAdjunta = InvestigacionGuardada & {
  sentimiento: number;
  noticiaFuerte: boolean;
  confianza: number;
  resumen: string;
  fuentes: string[];
  versionInstrucciones: string;
};

export type EntradaFoto = {
  evaluadaEn: Date;
  cartera: {
    saldoVirtualC: number;
    valorCarteraC: number | null;
    exposicionTotalC: number;
    exposicionPorActivoC: Record<Activo, number>;
    lotesAbiertos: number;
    /** REQ-11: entradas abiertas por activo (REQ-2); 0 si no hay. */
    entradasAbiertasPorActivo: Record<Activo, number>;
    entradasHoy: number;
    pnlDiaC: number | null;
  };
  mercado: {
    activo: Activo;
    ultimo: DatoConTs | null;
    bid: DatoConTs | null;
    ask: DatoConTs | null;
    barras: readonly BarraMercado[];
  };
  /** `null` cuando no hubo datos para evaluar la regla. */
  regla: { version: string; closes: readonly number[]; resultado: ResultadoTendenciaSma } | null;
  investigacion: InvestigacionAdjunta | null;
};

const num = (n: number) => String(n);
const iso = (d: Date) => d.toISOString();

/**
 * Arma `foto-v2` (REQ-23, REQ-24). Todo dato con `ts` posterior a `evaluadaEn` se descarta como faltante,
 * y todo lo que no se puede calcular va `null` y nombrado en `faltantes`: nunca se inventa un valor.
 */
export function armarFoto(e: EntradaFoto) {
  const T = e.evaluadaEn;
  const mercado = mercadoFoto(e.mercado, T);
  const carteraFaltantes = [
    ...(e.cartera.valorCarteraC === null ? ["valor_cartera_usd"] : []),
    ...(e.cartera.pnlDiaC === null ? ["pnl_dia_usd"] : []),
  ];
  const { cartera: k, regla, investigacion: i } = e;

  return {
    version: "foto-v2" as const,
    momento: { evaluada_en: iso(T), dia_semana_utc: T.getUTCDay(), hora_utc: T.getUTCHours() },
    cartera: {
      saldo_virtual_usd: deCentavos(k.saldoVirtualC),
      valor_cartera_usd: k.valorCarteraC === null ? null : deCentavos(k.valorCarteraC),
      exposicion_total_usd: deCentavos(k.exposicionTotalC),
      exposicion_por_activo_usd: Object.fromEntries(
        Object.entries(k.exposicionPorActivoC).map(([a, v]) => [a, deCentavos(v)]),
      ),
      lotes_abiertos: k.lotesAbiertos,
      entradas_abiertas_por_activo: k.entradasAbiertasPorActivo,
      entradas_hoy: k.entradasHoy,
      pnl_dia_usd: k.pnlDiaC === null ? null : deCentavos(k.pnlDiaC),
      faltantes: carteraFaltantes,
    },
    mercado,
    regla: regla
      ? {
          version: regla.version,
          entradas: { closes: regla.closes.map(num) },
          resultado: {
            senal: regla.resultado.senal,
            close_ultimo: num(regla.resultado.closeUltimo),
            close_previo: num(regla.resultado.closePrevio),
            sma20: num(regla.resultado.sma20),
          },
        }
      : { version: null, entradas: null, resultado: null },
    investigacion:
      i && i.recibidaEn.getTime() <= T.getTime()
        ? {
            estado: "adjunta" as const,
            id: i.id,
            recibida_en: iso(i.recibidaEn),
            antiguedad_min: minutosEntre(i.recibidaEn, T),
            sentimiento: num(i.sentimiento),
            noticia_fuerte: i.noticiaFuerte,
            confianza: num(i.confianza),
            resumen: i.resumen,
            fuentes: i.fuentes,
            version_instrucciones: i.versionInstrucciones,
          }
        : { estado: "sin_investigacion" as const },
  };
}

/** Los campos de mercado de `foto-v2`; el contexto del decisor los reutiliza tal cual. Todo dato posterior a `T` se descarta. */
export function mercadoFoto(m: EntradaFoto["mercado"], T: Date) {
  const hasta = (d: DatoConTs | null) => (d && d.ts.getTime() <= T.getTime() ? d : null);
  const conTs = (d: DatoConTs | null) => (d ? { valor: num(d.valor), ts: iso(d.ts) } : null);

  const cerradas = m.barras
    .filter((b) => Date.parse(b.t) + MEDIA_HORA_MS <= T.getTime())
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const c = cerradas.map((b) => b.c);
  const n = c.length;

  const ultimo = hasta(m.ultimo);
  const bid = hasta(m.bid);
  const ask = hasta(m.ask);

  const u = c.slice(-49);
  const logRet = u.slice(1).map((x, i) => Math.log(x / u[i]));
  const media = logRet.reduce((a, r) => a + r, 0) / logRet.length;
  const desvio = Math.sqrt(logRet.reduce((a, r) => a + (r - media) ** 2, 0) / (logRet.length - 1));

  const mercado = {
    activo: m.activo,
    ultimo_precio: conTs(ultimo),
    bid: conTs(bid),
    ask: conTs(ask),
    spread_bps: bid && ask ? ((ask.valor - bid.valor) / ((ask.valor + bid.valor) / 2) * 1e4).toFixed(2) : null,
    variacion_1h: n >= 3 ? num(c[n - 1] / c[n - 3] - 1) : null,
    variacion_24h: n >= 49 ? num(c[n - 1] / c[n - 49] - 1) : null,
    volumen_24h: n >= 48 ? num(cerradas.slice(-48).reduce((a, b) => a + b.v, 0)) : null,
    volatilidad_24h: n >= 49 ? num(desvio) : null,
    ts_ultima_barra: n > 0 ? cerradas[n - 1].t : null,
  };
  return {
    ...mercado,
    faltantes: Object.entries(mercado)
      .filter(([, v]) => v === null)
      .map(([campo]) => campo),
  };
}

export type FotoV2 = ReturnType<typeof armarFoto>;

const CLAVES_TS = new Set(["ts", "ts_ultima_barra", "recibida_en"]);

/** REQ-24: rutas de todo dato de la foto con marca de tiempo posterior a `evaluada_en`. Vacío = foto válida. */
export function tsPosteriores(foto: unknown, evaluadaEn: Date, ruta = "foto"): string[] {
  if (Array.isArray(foto)) return foto.flatMap((x, i) => tsPosteriores(x, evaluadaEn, `${ruta}[${i}]`));
  if (foto === null || typeof foto !== "object") return [];
  return Object.entries(foto).flatMap(([k, v]) =>
    CLAVES_TS.has(k) && typeof v === "string"
      ? Date.parse(v) > evaluadaEn.getTime()
        ? [`${ruta}.${k}`]
        : []
      : tsPosteriores(v, evaluadaEn, `${ruta}.${k}`),
  );
}
