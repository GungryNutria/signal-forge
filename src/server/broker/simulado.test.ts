import { describe, expect, it } from "vitest";
import { BrokerSimulado, DatosSimulados } from "./simulado";
import { ErrorBroker, type PeticionOrden } from "./tipos";

const compra: PeticionOrden = { clientOrderId: "sf-e-1", simbolo: "BTC/USD", lado: "buy", nocionalUsd: "500.00" };

describe("BrokerSimulado", () => {
  it("llena a mercado al precio programado", async () => {
    const b = new BrokerSimulado();
    b.precios["BTC/USD"] = 100;
    const r = await b.enviarOrden(compra);
    expect(r).toMatchObject({ tipo: "aceptada", orden: { status: "filled", filledQty: "5", filledAvgPrice: "100" } });
  });

  it("llenado parcial y sin llenar", async () => {
    const b = new BrokerSimulado();
    b.precios["BTC/USD"] = 100;
    b.llenado = "parcial";
    expect(await b.consultarOrden("x")).toBe("no_existe");
    await b.enviarOrden(compra);
    expect(await b.consultarOrden("sf-e-1")).toMatchObject({ status: "partially_filled", filledQty: "2.5" });
    const c = new BrokerSimulado();
    c.llenado = "ninguno";
    expect(await c.enviarOrden(compra)).toMatchObject({ orden: { status: "accepted", filledQty: "0", filledAvgPrice: null } });
  });

  it("un client_order_id repetido no duplica la orden", async () => {
    const b = new BrokerSimulado();
    b.precios["BTC/USD"] = 100;
    const a = await b.enviarOrden(compra);
    const c = await b.enviarOrden(compra);
    expect(c).toEqual(a);
    expect(b.registradas).toHaveLength(1);
    expect(b.llamadas.filter((l) => l.metodo === "enviarOrden")).toHaveLength(2);
  });

  it("timeout con y sin llegada al broker", async () => {
    const b = new BrokerSimulado();
    b.precios["BTC/USD"] = 100;
    b.programarEnvio({ tipo: "timeout", llega: true }, { tipo: "timeout", llega: false });
    expect(await b.enviarOrden(compra)).toEqual({ tipo: "incierta", causa: "timeout" });
    expect(b.registradas).toHaveLength(1);
    expect(await b.enviarOrden({ ...compra, clientOrderId: "sf-e-2" })).toEqual({ tipo: "incierta", causa: "timeout" });
    expect(b.registradas).toHaveLength(1);
  });

  it("rechazo programado, consulta programada y caída", async () => {
    const b = new BrokerSimulado();
    b.programarEnvio({ tipo: "rechazada", status: 403 });
    expect(await b.enviarOrden(compra)).toMatchObject({ tipo: "rechazada", status: 403 });
    b.programarConsulta("no_existe", new ErrorBroker("x", "5xx"));
    expect(await b.consultarOrden("sf-e-1")).toBe("no_existe");
    await expect(b.consultarOrden("sf-e-1")).rejects.toBeInstanceOf(ErrorBroker);
    b.caido = true;
    expect(await b.enviarOrden(compra)).toMatchObject({ tipo: "incierta" });
    await expect(b.consultarOrden("sf-e-1")).rejects.toBeInstanceOf(ErrorBroker);
  });

  it("fijarEstado simula un llenado tardío", async () => {
    const b = new BrokerSimulado();
    b.llenado = "ninguno";
    await b.enviarOrden(compra);
    b.fijarEstado("sf-e-1", "filled", "5", "100");
    expect(await b.consultarOrden("sf-e-1")).toMatchObject({ status: "filled", filledQty: "5" });
  });
});

describe("DatosSimulados", () => {
  it("devuelve lo asignado y falla si está caído", async () => {
    const d = new DatosSimulados();
    d.barras["BTC/USD"] = [{ t: "2026-11-06T18:00:00Z", o: 1, h: 1, l: 1, c: 1, v: 1 }];
    expect(await d.barras30m("BTC/USD")).toHaveLength(1);
    expect(await d.barras30m("SOL/USD")).toEqual([]);
    expect(await d.snapshots(["BTC/USD"])).toEqual({});
    d.caido = true;
    await expect(d.snapshots(["BTC/USD"])).rejects.toBeInstanceOf(ErrorBroker);
  });
});
