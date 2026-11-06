import { describe, expect, it } from "vitest";
import { AlpacaBroker, URL_PAPER } from "./alpaca";
import { ErrorBroker } from "./tipos";

const SECRETO = "sf-senuelo-9f8e7d6c5b4a";
const KEY = "PKSENUELO123";

type Llamada = { url: string; init: RequestInit };
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });

function broker(responder: (l: Llamada, n: number) => Response | Promise<Response>, timeoutMs = 50) {
  const llamadas: Llamada[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const l = { url, init };
    llamadas.push(l);
    return responder(l, llamadas.length);
  }) as unknown as typeof fetch;
  return { b: new AlpacaBroker({ keyId: KEY, secretKey: SECRETO, baseUrl: URL_PAPER, fetch: fetchFn, timeoutMs }), llamadas };
}

const ordenJson = (extra: object = {}) => ({
  id: "b0b6dd9d-8b9b-48a9-ba46-b9d54906e415",
  client_order_id: "sf-e-abc",
  status: "pending_new",
  filled_qty: "0",
  filled_avg_price: null,
  symbol: "BTC/USD",
  ...extra,
});

const compra = { clientOrderId: "sf-e-abc", simbolo: "BTC/USD" as const, lado: "buy" as const, nocionalUsd: "500.00" };

describe("AlpacaBroker: construcción (REQ-15)", () => {
  it.each([
    "https://api.alpaca.markets",
    "https://paper-api.alpaca.markets/v2",
    "https://paper-api.alpaca.markets.evil.com",
    "http://paper-api.alpaca.markets",
    "",
  ])("se niega con %j", (baseUrl) => {
    expect(() => new AlpacaBroker({ keyId: KEY, secretKey: SECRETO, baseUrl })).toThrow(/paper/);
  });

  it("el mensaje del rechazo no incluye las llaves", () => {
    try {
      new AlpacaBroker({ keyId: KEY, secretKey: SECRETO, baseUrl: "https://api.alpaca.markets" });
    } catch (e) {
      expect(String(e)).not.toContain(SECRETO);
      expect(String(e)).not.toContain(KEY);
    }
  });
});

describe("AlpacaBroker.enviarOrden", () => {
  it("200: aceptada, con el cuerpo exacto del plan y las cabeceras de autenticación", async () => {
    const { b, llamadas } = broker(() => json(200, ordenJson()));
    const r = await b.enviarOrden(compra);
    expect(r).toMatchObject({ tipo: "aceptada", orden: { clientOrderId: "sf-e-abc", status: "pending_new", filledQty: "0", filledAvgPrice: null } });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe(`${URL_PAPER}/v2/orders`);
    expect(llamadas[0].init.method).toBe("POST");
    expect(JSON.parse(llamadas[0].init.body as string)).toEqual({
      symbol: "BTC/USD",
      side: "buy",
      type: "market",
      time_in_force: "gtc",
      notional: "500.00",
      client_order_id: "sf-e-abc",
    });
    expect(llamadas[0].init.headers).toMatchObject({ "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRETO });
  });

  it("una venta va con qty", async () => {
    const { b, llamadas } = broker(() => json(200, ordenJson({ client_order_id: "sf-x-1" })));
    await b.enviarOrden({ clientOrderId: "sf-x-1", simbolo: "SOL/USD", lado: "sell", cantidad: "0.123456789" });
    expect(JSON.parse(llamadas[0].init.body as string)).toMatchObject({ side: "sell", qty: "0.123456789", symbol: "SOL/USD" });
    expect(JSON.parse(llamadas[0].init.body as string)).not.toHaveProperty("notional");
  });

  it("exige exactamente uno de nocionalUsd o cantidad", async () => {
    const { b, llamadas } = broker(() => json(200, ordenJson()));
    await expect(b.enviarOrden({ ...compra, nocionalUsd: undefined })).rejects.toThrow();
    await expect(b.enviarOrden({ ...compra, cantidad: "1" })).rejects.toThrow();
    expect(llamadas).toHaveLength(0);
  });

  it("4xx: rechazada con el estado y el cuerpo", async () => {
    const cuerpo = { code: 40310000, message: "insufficient balance" };
    const { b } = broker(() => json(403, cuerpo));
    expect(await b.enviarOrden(compra)).toEqual({ tipo: "rechazada", status: 403, cuerpo });
  });

  it("5xx: incierta, nunca rechazada", async () => {
    const { b } = broker(() => json(503, { message: "x" }));
    expect(await b.enviarOrden(compra)).toEqual({ tipo: "incierta", causa: "5xx" });
  });

  it("timeout: incierta/timeout (la orden pudo llegar)", async () => {
    const { b } = broker(() => new Promise<Response>(() => {}), 20);
    expect(await b.enviarOrden(compra)).toEqual({ tipo: "incierta", causa: "timeout" });
  });

  it("error de red: incierta/red", async () => {
    const { b } = broker(() => {
      throw new TypeError("fetch failed");
    });
    expect(await b.enviarOrden(compra)).toEqual({ tipo: "incierta", causa: "red" });
  });

  it("2xx con forma inesperada: incierta, no rechazada", async () => {
    const { b } = broker(() => json(200, { hola: 1 }));
    expect(await b.enviarOrden(compra)).toEqual({ tipo: "incierta", causa: "5xx" });
  });

  it("T-2: 422 de client_order_id duplicado = ya existe; consulta by_client_order_id y devuelve esa orden", async () => {
    const { b, llamadas } = broker((l, n) =>
      n === 1
        ? json(422, { code: 42210000, message: "client_order_id must be unique" })
        : json(200, ordenJson({ status: "filled", filled_qty: "0.0066", filled_avg_price: "75791.33" })),
    );
    const r = await b.enviarOrden(compra);
    expect(r).toMatchObject({ tipo: "aceptada", orden: { status: "filled", filledQty: "0.0066", filledAvgPrice: "75791.33" } });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].url).toBe(`${URL_PAPER}/v2/orders:by_client_order_id?client_order_id=sf-e-abc`);
    expect(llamadas[1].init.method).toBe("GET");
  });

  it("un 422 que no es de duplicado sí es rechazo", async () => {
    const { b, llamadas } = broker(() => json(422, { code: 42210001, message: "qty below minimum" }));
    expect(await b.enviarOrden(compra)).toMatchObject({ tipo: "rechazada", status: 422 });
    expect(llamadas).toHaveLength(1);
  });

  it("duplicado y la consulta falla: incierta, nunca rechazada", async () => {
    const { b } = broker((_, n) => (n === 1 ? json(422, { code: 42210000, message: "x" }) : json(500, {})));
    expect(await b.enviarOrden(compra)).toEqual({ tipo: "incierta", causa: "5xx" });
  });

  it("duplicado y la consulta da 404: incierta", async () => {
    const { b } = broker((_, n) => (n === 1 ? json(422, { code: 42210000, message: "x" }) : json(404, { code: 40410000 })));
    expect(await b.enviarOrden(compra)).toMatchObject({ tipo: "incierta" });
  });
});

describe("AlpacaBroker.consultarOrden", () => {
  it("200: la orden", async () => {
    const { b } = broker(() => json(200, ordenJson({ status: "filled", filled_qty: "0.000129377", filled_avg_price: "75791.33" })));
    const r = await b.consultarOrden("sf-e-abc");
    expect(r).toMatchObject({ id: ordenJson().id, status: "filled", filledQty: "0.000129377", filledAvgPrice: "75791.33" });
    expect((r as { raw: { symbol: string } }).raw.symbol).toBe("BTC/USD");
  });

  it("T-2: 404 (code 40410000) = no_existe", async () => {
    const { b } = broker(() => json(404, { code: 40410000, message: "order not found for abc" }));
    expect(await b.consultarOrden("abc")).toBe("no_existe");
  });

  it("5xx, 4xx distinto de 404, forma inválida, timeout y red lanzan ErrorBroker con su causa", async () => {
    const causas = async (responder: Parameters<typeof broker>[0]) => {
      const { b } = broker(responder, 20);
      return b.consultarOrden("x").catch((e: ErrorBroker) => e.causa);
    };
    expect(await causas(() => json(502, {}))).toBe("5xx");
    expect(await causas(() => json(401, {}))).toBe("4xx");
    expect(await causas(() => json(200, { hola: 1 }))).toBe("respuesta_invalida");
    expect(await causas(() => new Promise<Response>(() => {}))).toBe("timeout");
    expect(
      await causas(() => {
        throw new TypeError("fetch failed");
      }),
    ).toBe("red");
  });

  it("el client_order_id se codifica en la URL", async () => {
    const { b, llamadas } = broker(() => json(404, {}));
    await b.consultarOrden("a b&c");
    expect(llamadas[0].url).toContain("client_order_id=a%20b%26c");
  });
});

describe("secretos", () => {
  it("el mensaje de ningún error contiene APCA_API_SECRET_KEY ni el key id, aunque fetch los cite", async () => {
    const { b } = broker(() => {
      throw new TypeError(`fetch failed APCA-API-SECRET-KEY: ${SECRETO} id ${KEY}`);
    });
    const e = (await b.consultarOrden("x").catch((x: unknown) => x)) as ErrorBroker;
    expect(e).toBeInstanceOf(ErrorBroker);
    for (const texto of [e.message, e.stack ?? "", JSON.stringify(e), String(e)]) {
      expect(texto).not.toContain(SECRETO);
      expect(texto).not.toContain(KEY);
    }

    const r5 = broker(() => json(500, { message: "boom" }));
    const e5 = (await r5.b.consultarOrden("x").catch((x: unknown) => x)) as ErrorBroker;
    expect(e5.message).not.toContain(SECRETO);

    const salida = JSON.stringify(await broker(() => {
      throw new Error(SECRETO);
    }).b.enviarOrden(compra));
    expect(salida).not.toContain(SECRETO);
  });
});
