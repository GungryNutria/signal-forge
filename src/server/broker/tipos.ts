import type { Activo } from "@/core/activos";

export type Simbolo = Activo;

export type OrdenBroker = {
  id: string;
  clientOrderId: string;
  status: string;
  filledQty: string;
  filledAvgPrice: string | null;
  raw: unknown;
};

export type PeticionOrden = {
  clientOrderId: string;
  simbolo: Simbolo;
  lado: "buy" | "sell";
  /** Exactamente uno de los dos: compras por `nocionalUsd`, ventas por `cantidad`. */
  nocionalUsd?: string;
  cantidad?: string;
};

export type RespuestaEnvio =
  | { tipo: "aceptada"; orden: OrdenBroker }
  | { tipo: "rechazada"; status: number; cuerpo: unknown }
  | { tipo: "incierta"; causa: "timeout" | "red" | "5xx" };

/** Orden a mercado, `gtc`. Nunca reenvía por su cuenta: el reintento lo decide quien llama. */
export interface Broker {
  /** Un `client_order_id` ya usado devuelve la orden existente como `aceptada` (nunca como rechazada). */
  enviarOrden(o: PeticionOrden): Promise<RespuestaEnvio>;
  /** `"no_existe"` solo si el broker contesta 404. Cualquier otro fallo lanza `ErrorBroker`. */
  consultarOrden(clientOrderId: string): Promise<OrdenBroker | "no_existe">;
  /** Cantidad del activo que el broker deja vender ahora (`qty_available`), en decimal como cadena. `"0"` si contesta 404 (sin posición). Otro fallo lanza `ErrorBroker`. */
  cantidadDisponible(simbolo: Simbolo): Promise<string>;
}

export type Barra = { t: string; o: number; h: number; l: number; c: number; v: number };

export type Snapshot = { bid: number; ask: number; ultimo: number; tsQuote: Date; tsTrade: Date };

export interface DatosMercado {
  /** Barras de 30 min (incluida la que aún no cierra) en orden cronológico. */
  barras30m(simbolo: Simbolo, desde: Date, hasta: Date): Promise<Barra[]>;
  /** Los símbolos sin quote o sin trade no aparecen en el resultado. */
  snapshots(simbolos: readonly Simbolo[]): Promise<Partial<Record<Simbolo, Snapshot>>>;
}

/** Fallo del broker o de los datos. El mensaje nunca incluye cabeceras ni llaves. */
export class ErrorBroker extends Error {
  constructor(
    mensaje: string,
    readonly causa: "timeout" | "red" | "5xx" | "4xx" | "respuesta_invalida",
    readonly status?: number,
  ) {
    super(mensaje);
    this.name = "ErrorBroker";
  }
}
