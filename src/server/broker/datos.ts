import { z } from "zod";
import { pedir, TIMEOUT_MS, type Fetch } from "./http";
import { ErrorBroker, type Barra, type DatosMercado, type Simbolo, type Snapshot } from "./tipos";

export const URL_DATOS = "https://data.alpaca.markets/v1beta3/crypto/us";

const RespuestaBarras = z.looseObject({
  bars: z.record(
    z.string(),
    z.array(z.looseObject({ t: z.string(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number() })),
  ),
});

const RespuestaSnapshots = z.looseObject({
  snapshots: z.record(
    z.string(),
    z.looseObject({
      latestQuote: z.looseObject({ ap: z.number(), bp: z.number(), t: z.string() }).nullish(),
      latestTrade: z.looseObject({ p: z.number(), t: z.string() }).nullish(),
    }),
  ),
});

/** Datos de mercado públicos de Alpaca (sin autenticación): 10 s de timeout y 1 reintento ante fallos transitorios. */
export class AlpacaDatos implements DatosMercado {
  private readonly fetchFn: Fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(o: { fetch?: Fetch; timeoutMs?: number; baseUrl?: string } = {}) {
    this.fetchFn = o.fetch ?? fetch;
    this.timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
    this.baseUrl = o.baseUrl ?? URL_DATOS;
  }

  private async obtener(ruta: string, params: Record<string, string>): Promise<unknown> {
    const url = `${this.baseUrl}/${ruta}?${new URLSearchParams(params)}`;
    let ultimo: ErrorBroker | undefined;
    for (let intento = 0; intento < 2; intento++) {
      try {
        const r = await pedir(this.fetchFn, url, { method: "GET", headers: { accept: "application/json" } }, this.timeoutMs);
        if (r.status < 400) return r.cuerpo;
        ultimo = new ErrorBroker(`Datos de mercado respondieron ${r.status}`, r.status >= 500 ? "5xx" : "4xx", r.status);
        if (r.status < 500) break; // un 4xx no se arregla reintentando
      } catch (e) {
        if (!(e instanceof ErrorBroker)) throw e;
        ultimo = e;
      }
    }
    throw ultimo!;
  }

  async barras30m(simbolo: Simbolo, desde: Date, hasta: Date): Promise<Barra[]> {
    const cuerpo = await this.obtener("bars", {
      symbols: simbolo,
      timeframe: "30Min",
      start: desde.toISOString(),
      end: hasta.toISOString(),
      limit: "60",
      sort: "asc",
    });
    const r = RespuestaBarras.safeParse(cuerpo);
    if (!r.success) throw new ErrorBroker("Respuesta de barras con forma inesperada", "respuesta_invalida");
    return (r.data.bars[simbolo] ?? []).map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }));
  }

  async snapshots(simbolos: readonly Simbolo[]): Promise<Partial<Record<Simbolo, Snapshot>>> {
    const cuerpo = await this.obtener("snapshots", { symbols: simbolos.join(",") });
    const r = RespuestaSnapshots.safeParse(cuerpo);
    if (!r.success) throw new ErrorBroker("Respuesta de snapshots con forma inesperada", "respuesta_invalida");
    const salida: Partial<Record<Simbolo, Snapshot>> = {};
    for (const s of simbolos) {
      const { latestQuote: q, latestTrade: t } = r.data.snapshots[s] ?? {};
      if (q && t) {
        salida[s] = { bid: q.bp, ask: q.ap, ultimo: t.p, tsQuote: new Date(q.t), tsTrade: new Date(t.t) };
      }
    }
    return salida;
  }
}
