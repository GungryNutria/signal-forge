import {
  ErrorBroker,
  type Barra,
  type Broker,
  type DatosMercado,
  type OrdenBroker,
  type PeticionOrden,
  type RespuestaEnvio,
  type Simbolo,
  type Snapshot,
} from "./tipos";

/** Qué responde el siguiente `enviarOrden`. `llega` indica si la orden alcanzó al broker aunque la respuesta se perdiera. */
export type GuionEnvio =
  | { tipo: "timeout" | "red" | "5xx"; llega: boolean }
  | { tipo: "rechazada"; status: number; cuerpo?: unknown };

/** Qué responde la siguiente `consultarOrden`: un error o un "no existe" forzado. */
export type GuionConsulta = "no_existe" | ErrorBroker;

type OrdenSim = { peticion: PeticionOrden; orden: OrdenBroker };

/**
 * Broker de pruebas: guarda las órdenes en memoria, las llena según `precios` y `llenado`, y deja programar
 * respuestas, timeouts, caídas y llenados parciales. Un `clientOrderId` repetido devuelve la orden existente
 * como `aceptada`, igual que `AlpacaBroker` tras su 422.
 */
export class BrokerSimulado implements Broker {
  readonly llamadas: { metodo: "enviarOrden" | "consultarOrden"; arg: PeticionOrden | string }[] = [];
  precios: Partial<Record<Simbolo, number>> = {};
  /** `total`, `parcial` (la mitad, `status: partially_filled`) o `ninguno` (queda `accepted`). */
  llenado: "total" | "parcial" | "ninguno" = "total";
  /** Si es `true`, todo falla como una caída de red. */
  caido = false;

  private readonly ordenes = new Map<string, OrdenSim>();
  private readonly guionesEnvio: GuionEnvio[] = [];
  private readonly guionesConsulta: GuionConsulta[] = [];
  private seq = 0;

  programarEnvio(...g: GuionEnvio[]): this {
    this.guionesEnvio.push(...g);
    return this;
  }

  programarConsulta(...g: GuionConsulta[]): this {
    this.guionesConsulta.push(...g);
    return this;
  }

  /** Órdenes que el broker llegó a registrar, en orden de creación. */
  get registradas(): OrdenBroker[] {
    return [...this.ordenes.values()].map((o) => o.orden);
  }

  /** Cambia el estado de una orden ya registrada (p. ej. un llenado tardío). */
  fijarEstado(clientOrderId: string, status: string, filledQty: string, filledAvgPrice: string | null): void {
    const o = this.ordenes.get(clientOrderId);
    if (!o) throw new Error(`orden simulada inexistente: ${clientOrderId}`);
    o.orden = { ...o.orden, status, filledQty, filledAvgPrice, raw: { ...(o.orden.raw as object), status } };
  }

  async enviarOrden(p: PeticionOrden): Promise<RespuestaEnvio> {
    this.llamadas.push({ metodo: "enviarOrden", arg: p });
    if (this.caido) return { tipo: "incierta", causa: "red" };
    const guion = this.guionesEnvio.shift();
    if (guion?.tipo === "rechazada") return { tipo: "rechazada", status: guion.status, cuerpo: guion.cuerpo ?? { message: "rechazada" } };
    if (guion) {
      if (guion.llega) this.registrar(p);
      return { tipo: "incierta", causa: guion.tipo };
    }
    return { tipo: "aceptada", orden: this.registrar(p) };
  }

  async consultarOrden(clientOrderId: string): Promise<OrdenBroker | "no_existe"> {
    this.llamadas.push({ metodo: "consultarOrden", arg: clientOrderId });
    if (this.caido) throw new ErrorBroker("Error de red", "red");
    const guion = this.guionesConsulta.shift();
    if (guion instanceof ErrorBroker) throw guion;
    if (guion === "no_existe") return "no_existe";
    return this.ordenes.get(clientOrderId)?.orden ?? "no_existe";
  }

  private registrar(p: PeticionOrden): OrdenBroker {
    const previa = this.ordenes.get(p.clientOrderId);
    if (previa) return previa.orden;
    const precio = this.precios[p.simbolo];
    const total = p.cantidad !== undefined ? Number(p.cantidad) : precio ? Number(p.nocionalUsd) / precio : 0;
    const llena = this.llenado === "ninguno" || !precio ? 0 : this.llenado === "parcial" ? total / 2 : total;
    const status = llena === 0 ? "accepted" : this.llenado === "parcial" ? "partially_filled" : "filled";
    const orden: OrdenBroker = {
      id: `sim-${++this.seq}`,
      clientOrderId: p.clientOrderId,
      status,
      filledQty: String(llena),
      filledAvgPrice: llena === 0 ? null : String(precio),
      raw: { id: `sim-${this.seq}`, client_order_id: p.clientOrderId, status, symbol: p.simbolo, side: p.lado },
    };
    this.ordenes.set(p.clientOrderId, { peticion: p, orden });
    return orden;
  }
}

/** Datos de mercado de pruebas: se asignan barras y snapshots por símbolo; `caido` hace fallar todo. */
export class DatosSimulados implements DatosMercado {
  barras: Partial<Record<Simbolo, Barra[]>> = {};
  instantaneas: Partial<Record<Simbolo, Snapshot>> = {};
  caido = false;

  async barras30m(simbolo: Simbolo): Promise<Barra[]> {
    if (this.caido) throw new ErrorBroker("Error de red", "red");
    return this.barras[simbolo] ?? [];
  }

  async snapshots(simbolos: readonly Simbolo[]): Promise<Partial<Record<Simbolo, Snapshot>>> {
    if (this.caido) throw new ErrorBroker("Error de red", "red");
    return Object.fromEntries(simbolos.flatMap((s) => (this.instantaneas[s] ? [[s, this.instantaneas[s]]] : [])));
  }
}
