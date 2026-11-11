import { describe, expect, it } from "vitest";
import { AlpacaDatos, URL_DATOS } from "./datos";
import { ErrorBroker } from "./tipos";

const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });

function datos(responder: (url: string, n: number) => Response | Promise<Response>, timeoutMs = 20) {
  const urls: string[] = [];
  const cabeceras: Record<string, string>[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    urls.push(url);
    cabeceras.push(init.headers as Record<string, string>);
    return responder(url, urls.length);
  }) as unknown as typeof fetch;
  return { d: new AlpacaDatos({ keyId: "id-prueba", secretKey: "secreto-prueba", fetch: fetchFn, timeoutMs }), urls, cabeceras };
}

const barra = (t: string, c: number) => ({ t, o: c, h: c, l: c, c, v: 1.5, n: 3, vw: c });

describe("AlpacaDatos.barras30m", () => {
  it("pide 30Min con la ventana y devuelve las barras del símbolo", async () => {
    const { d, urls } = datos(() =>
      json(200, { bars: { "BTC/USD": [barra("2026-11-06T18:00:00Z", 100), barra("2026-11-06T18:30:00Z", 101)] }, next_page_token: null }),
    );
    const r = await d.barras30m("BTC/USD", new Date("2026-11-05T17:00:00Z"), new Date("2026-11-06T18:31:00Z"));
    expect(r).toEqual([
      { t: "2026-11-06T18:00:00Z", o: 100, h: 100, l: 100, c: 100, v: 1.5 },
      { t: "2026-11-06T18:30:00Z", o: 101, h: 101, l: 101, c: 101, v: 1.5 },
    ]);
    const u = new URL(urls[0]);
    expect(u.origin + u.pathname).toBe(`${URL_DATOS}/bars`);
    expect(u.searchParams.get("symbols")).toBe("BTC/USD");
    expect(u.searchParams.get("timeframe")).toBe("30Min");
    expect(u.searchParams.get("start")).toBe("2026-11-05T17:00:00.000Z");
    expect(u.searchParams.get("end")).toBe("2026-11-06T18:31:00.000Z");
    expect(u.searchParams.get("limit")).toBe("60");
  });

  it("sin barras para el símbolo, lista vacía", async () => {
    const { d } = datos(() => json(200, { bars: {}, next_page_token: null }));
    expect(await d.barras30m("SOL/USD", new Date(0), new Date(1))).toEqual([]);
  });

  it("reintenta una vez ante 5xx y se recupera", async () => {
    const { d, urls } = datos((_, n) => (n === 1 ? json(503, {}) : json(200, { bars: { "BTC/USD": [barra("2026-11-06T18:00:00Z", 1)] } })));
    expect(await d.barras30m("BTC/USD", new Date(0), new Date(1))).toHaveLength(1);
    expect(urls).toHaveLength(2);
  });

  it("falla tras el reintento: 5xx, timeout y red", async () => {
    const causa = async (responder: Parameters<typeof datos>[0]) => {
      const { d, urls } = datos(responder);
      const c = await d.barras30m("BTC/USD", new Date(0), new Date(1)).catch((e: ErrorBroker) => e.causa);
      return [c, urls.length];
    };
    expect(await causa(() => json(500, {}))).toEqual(["5xx", 2]);
    expect(await causa(() => new Promise<Response>(() => {}))).toEqual(["timeout", 2]);
    expect(
      await causa(() => {
        throw new TypeError("fetch failed");
      }),
    ).toEqual(["red", 2]);
  });

  it("un 4xx no se reintenta", async () => {
    const { d, urls } = datos(() => json(400, { message: "bad" }));
    await expect(d.barras30m("BTC/USD", new Date(0), new Date(1))).rejects.toMatchObject({ causa: "4xx", status: 400 });
    expect(urls).toHaveLength(1);
  });

  it("forma inesperada lanza respuesta_invalida", async () => {
    const { d } = datos(() => json(200, { hola: 1 }));
    await expect(d.barras30m("BTC/USD", new Date(0), new Date(1))).rejects.toMatchObject({ causa: "respuesta_invalida" });
  });
});

describe("AlpacaDatos autenticación", () => {
  it("barras y snapshots llevan las dos cabeceras APCA", async () => {
    const { d, cabeceras } = datos((url) => (url.includes("/bars") ? json(200, { bars: {} }) : json(200, { snapshots: {} })));
    await d.barras30m("BTC/USD", new Date(0), new Date(1));
    await d.snapshots(["BTC/USD"]);
    expect(cabeceras).toHaveLength(2);
    for (const c of cabeceras) expect(c).toMatchObject({ "APCA-API-KEY-ID": "id-prueba", "APCA-API-SECRET-KEY": "secreto-prueba" });
  });

  it("un 429 se reintenta una vez", async () => {
    const { d, urls } = datos((_, n) => (n === 1 ? json(429, { message: "too many requests." }) : json(200, { bars: {} })));
    await expect(d.barras30m("BTC/USD", new Date(0), new Date(1))).resolves.toEqual([]);
    expect(urls).toHaveLength(2);
  });

  it("el error de un 429 persistente no contiene las llaves", async () => {
    const { d } = datos(() => json(429, { message: "id-prueba secreto-prueba" }));
    const e = await d.barras30m("BTC/USD", new Date(0), new Date(1)).catch((x: Error) => x);
    expect(e).toMatchObject({ causa: "4xx", status: 429 });
    expect((e as Error).message).not.toMatch(/id-prueba|secreto-prueba/);
  });
});

describe("AlpacaDatos.snapshots", () => {
  const snap = (bp: number, ap: number, p: number) => ({
    latestQuote: { ap, as: 1, bp, bs: 1, t: "2026-11-06T18:30:55.123456789Z" },
    latestTrade: { p, s: 0.1, t: "2026-11-06T18:30:50Z", i: 1, tks: "B" },
    dailyBar: barra("2026-11-06T00:00:00Z", p),
  });

  it("devuelve bid, ask, último y las dos marcas de tiempo; omite lo incompleto", async () => {
    const { d, urls } = datos(() =>
      json(200, { snapshots: { "BTC/USD": snap(90.15, 90.25, 90.19), "SOL/USD": { latestTrade: { p: 1, t: "2026-11-06T18:30:50Z" } } } }),
    );
    const r = await d.snapshots(["BTC/USD", "SOL/USD"]);
    expect(Object.keys(r)).toEqual(["BTC/USD"]);
    expect(r["BTC/USD"]).toMatchObject({ bid: 90.15, ask: 90.25, ultimo: 90.19 });
    expect(r["BTC/USD"]!.tsTrade.toISOString()).toBe("2026-11-06T18:30:50.000Z");
    expect(r["BTC/USD"]!.tsQuote.getTime()).toBe(Date.parse("2026-11-06T18:30:55.123Z"));
    expect(new URL(urls[0]).searchParams.get("symbols")).toBe("BTC/USD,SOL/USD");
  });

  it("caída: lanza ErrorBroker", async () => {
    const { d } = datos(() => json(500, {}));
    await expect(d.snapshots(["BTC/USD"])).rejects.toBeInstanceOf(ErrorBroker);
  });
});
