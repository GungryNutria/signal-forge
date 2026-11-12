import { z } from "zod";
import { pedir, TIMEOUT_MS, type Fetch } from "./http";
import {
  ErrorBroker,
  type Broker,
  type OrdenBroker,
  type PeticionOrden,
  type RespuestaEnvio,
  type Simbolo,
} from "./tipos";

export const URL_PAPER = "https://paper-api.alpaca.markets";

/** T-2: un `client_order_id` repetido da 422 con este código y no devuelve la orden existente. */
const CODIGO_ID_DUPLICADO = 42210000;

const OrdenAlpaca = z.looseObject({
  id: z.string(),
  client_order_id: z.string(),
  status: z.string(),
  filled_qty: z.string(),
  filled_avg_price: z.string().nullish(),
});

const PosicionAlpaca = z.looseObject({ qty_available: z.string() });

const aOrden = (cuerpo: unknown): OrdenBroker | null => {
  const r = OrdenAlpaca.safeParse(cuerpo);
  return r.success
    ? {
        id: r.data.id,
        clientOrderId: r.data.client_order_id,
        status: r.data.status,
        filledQty: r.data.filled_qty,
        filledAvgPrice: r.data.filled_avg_price ?? null,
        raw: cuerpo,
      }
    : null;
};

const codigoDe = (cuerpo: unknown) =>
  cuerpo !== null && typeof cuerpo === "object" ? (cuerpo as { code?: unknown }).code : undefined;

export type OpcionesAlpaca = {
  keyId: string;
  secretKey: string;
  baseUrl: string;
  fetch?: Fetch;
  timeoutMs?: number;
};

/** Trading paper de Alpaca con `fetch` + zod. Se niega a construirse si la URL no es la de paper (REQ-15). */
export class AlpacaBroker implements Broker {
  private readonly baseUrl: string;
  private readonly cabeceras: Record<string, string>;
  private readonly fetchFn: Fetch;
  private readonly timeoutMs: number;

  constructor(o: OpcionesAlpaca) {
    if (o.baseUrl !== URL_PAPER) {
      throw new Error(`AlpacaBroker solo se construye con ${URL_PAPER} (REQ-15)`);
    }
    this.baseUrl = o.baseUrl;
    this.cabeceras = {
      "APCA-API-KEY-ID": o.keyId,
      "APCA-API-SECRET-KEY": o.secretKey,
      "content-type": "application/json",
    };
    this.fetchFn = o.fetch ?? fetch;
    this.timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  }

  async enviarOrden(o: PeticionOrden): Promise<RespuestaEnvio> {
    if ((o.nocionalUsd === undefined) === (o.cantidad === undefined)) {
      throw new Error("enviarOrden necesita exactamente uno de nocionalUsd o cantidad");
    }
    const cuerpo = JSON.stringify({
      symbol: o.simbolo,
      side: o.lado,
      type: "market",
      time_in_force: "gtc",
      ...(o.nocionalUsd !== undefined ? { notional: o.nocionalUsd } : { qty: o.cantidad }),
      client_order_id: o.clientOrderId,
    });
    let r;
    try {
      r = await pedir(this.fetchFn, `${this.baseUrl}/v2/orders`, { method: "POST", headers: this.cabeceras, body: cuerpo }, this.timeoutMs);
    } catch (e) {
      if (e instanceof ErrorBroker && (e.causa === "timeout" || e.causa === "red")) {
        return { tipo: "incierta", causa: e.causa };
      }
      throw e;
    }
    if (r.status >= 500) return { tipo: "incierta", causa: "5xx" };
    if (r.status === 422 && codigoDe(r.cuerpo) === CODIGO_ID_DUPLICADO) return this.yaExiste(o.clientOrderId);
    if (r.status >= 400) return { tipo: "rechazada", status: r.status, cuerpo: r.cuerpo };
    const orden = aOrden(r.cuerpo);
    // Un 2xx que no entendemos pudo haber creado la orden: es incierto, nunca rechazo.
    return orden ? { tipo: "aceptada", orden } : { tipo: "incierta", causa: "5xx" };
  }

  /** El id ya estaba registrado (reintento o corte tras el envío): se consulta la orden existente. */
  private async yaExiste(clientOrderId: string): Promise<RespuestaEnvio> {
    try {
      const orden = await this.consultarOrden(clientOrderId);
      return orden === "no_existe" ? { tipo: "incierta", causa: "red" } : { tipo: "aceptada", orden };
    } catch (e) {
      if (e instanceof ErrorBroker && (e.causa === "timeout" || e.causa === "red" || e.causa === "5xx")) {
        return { tipo: "incierta", causa: e.causa };
      }
      return { tipo: "incierta", causa: "5xx" };
    }
  }

  async consultarOrden(clientOrderId: string): Promise<OrdenBroker | "no_existe"> {
    const url = `${this.baseUrl}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`;
    const r = await pedir(this.fetchFn, url, { method: "GET", headers: this.cabeceras }, this.timeoutMs);
    if (r.status === 404) return "no_existe";
    if (r.status >= 500) throw new ErrorBroker(`Alpaca respondió ${r.status}`, "5xx", r.status);
    if (r.status >= 400) throw new ErrorBroker(`Alpaca respondió ${r.status}`, "4xx", r.status);
    const orden = aOrden(r.cuerpo);
    if (!orden) throw new ErrorBroker("Respuesta de Alpaca con forma inesperada", "respuesta_invalida", r.status);
    return orden;
  }

  async cantidadDisponible(simbolo: Simbolo): Promise<string> {
    const url = `${this.baseUrl}/v2/positions/${simbolo.replace("/", "")}`;
    const r = await pedir(this.fetchFn, url, { method: "GET", headers: this.cabeceras }, this.timeoutMs);
    if (r.status === 404) return "0";
    if (r.status >= 500) throw new ErrorBroker(`Alpaca respondió ${r.status}`, "5xx", r.status);
    if (r.status >= 400) throw new ErrorBroker(`Alpaca respondió ${r.status}`, "4xx", r.status);
    const p = PosicionAlpaca.safeParse(r.cuerpo);
    if (!p.success) throw new ErrorBroker("Respuesta de Alpaca con forma inesperada", "respuesta_invalida", r.status);
    return p.data.qty_available;
  }
}
