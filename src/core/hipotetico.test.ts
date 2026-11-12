import { describe, expect, it } from "vitest";
import { aplicarTope, HUECO_MAX_MS, pnlANivel, resolverHipotetico, type Intervalo } from "./hipotetico";

// AC-16, AC-17 (parte unitaria) y AC-18.
const T0 = new Date("2026-11-12T12:00:00Z");
const P = 100_000; // stop 98 000, take profit 104 000
const en = (s: number) => new Date(T0.getTime() + s * 1000);
const punto = (s: number, bid: number): Intervalo => ({ desde: en(s), hasta: en(s), min: bid, max: bid });
/** Una muestra por minuto con el precio dado, desde el segundo 60. */
const serie = (...bids: number[]) => bids.map((b, i) => punto(60 * (i + 1), b));
const ahora = en(600);

describe("resolverHipotetico (AC-16)", () => {
  it("toca el take profit antes que el stop", () => {
    const r = resolverHipotetico({ t0: T0, precioEntrada: P }, serie(100_500, 103_000, 104_000, 97_000), ahora);
    expect(r).toMatchObject({ resultado: "take_profit", precioToque: 104_000, huecos: [] });
    expect(r.tocadoEn).toEqual(en(180));
  });

  it("toca el stop antes que el take profit", () => {
    const r = resolverHipotetico({ t0: T0, precioEntrada: P }, serie(99_000, 98_000, 105_000), ahora);
    expect(r).toMatchObject({ resultado: "stop_loss", precioToque: 98_000 });
    expect(r.tocadoEn).toEqual(en(120));
  });

  it("con los dos niveles en el mismo intervalo cuenta como stop_loss", () => {
    const d: Intervalo = { desde: en(60), hasta: en(120), min: 97_500, max: 104_500 };
    expect(resolverHipotetico({ t0: T0, precioEntrada: P }, [d], ahora)).toMatchObject({ resultado: "stop_loss", precioToque: 97_500 });
  });

  it("sin tocar ninguno queda pendiente", () => {
    const r = resolverHipotetico({ t0: T0, precioEntrada: P }, serie(99_000, 101_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000), ahora);
    expect(r).toMatchObject({ resultado: "pendiente", tocadoEn: null, precioToque: null, huecos: [] });
  });

  it("marca el hueco de más de 180 s entre dos muestras, sin inventar precios, y aun así resuelve", () => {
    const datos = [punto(60, 100_000), punto(400, 98_000)];
    const r = resolverHipotetico({ t0: T0, precioEntrada: P }, datos, en(500));
    expect(r.resultado).toBe("stop_loss");
    expect(r.huecos).toEqual([{ desde: en(60), hasta: en(400) }]);
  });

  it("marca el hueco entre t0 y la primera muestra, y entre la última y ahora si sigue pendiente", () => {
    const r = resolverHipotetico({ t0: T0, precioEntrada: P }, [punto(300, 100_000)], en(600));
    expect(r.huecos).toEqual([{ desde: T0, hasta: en(300) }, { desde: en(300), hasta: en(600) }]);
  });

  it("exactamente 180 s no es hueco", () => {
    const r = resolverHipotetico({ t0: T0, precioEntrada: P }, [punto(HUECO_MAX_MS / 1000, 100_000)], en(HUECO_MAX_MS / 1000 + 60));
    expect(r.huecos).toEqual([]);
  });

  it("sin ninguna muestra queda pendiente con todo el tramo como hueco", () => {
    expect(resolverHipotetico({ t0: T0, precioEntrada: P }, [], ahora).huecos).toEqual([{ desde: T0, hasta: ahora }]);
  });
});

describe("pnlANivel (AC-17)", () => {
  it("en el stop exacto da -2.49 % y en el take profit exacto +3.48 %, con 25 bps por lado", () => {
    expect(pnlANivel(P, 98_000, 500)).toEqual({ usd: "-12.45", pct: "-0.024900" });
    expect(pnlANivel(P, 104_000, 500)).toEqual({ usd: "17.40", pct: "0.034800" });
  });

  it("no depende del precio de entrada, solo de la proporción del nivel", () => {
    expect(pnlANivel(200, 196, 500).usd).toBe("-12.45");
  });
});

describe("aplicarTope (AC-18)", () => {
  const s = (activo: string, min: number, tocado: number | null) => ({
    activo,
    t0: new Date(T0.getTime() + min * 60_000),
    tocadoEn: tocado === null ? null : new Date(T0.getTime() + tocado * 60_000),
  });

  it("con N = 1 y 4 señales seguidas cuya primera sigue pendiente, solo cuenta la primera", () => {
    const r = aplicarTope([s("BTC/USD", 0, null), s("BTC/USD", 30, null), s("BTC/USD", 60, null), s("BTC/USD", 90, null)], 1);
    expect(r.map((x) => x.cuenta)).toEqual([true, false, false, false]);
  });

  it("una señal vuelve a contar cuando la anterior ya se resolvió antes de su t0", () => {
    const r = aplicarTope([s("BTC/USD", 0, 45), s("BTC/USD", 30, null), s("BTC/USD", 60, null)], 1);
    expect(r.map((x) => x.cuenta)).toEqual([true, false, true]);
  });

  it("el tope es por activo", () => {
    const r = aplicarTope([s("BTC/USD", 0, null), s("SOL/USD", 30, null), s("BTC/USD", 60, null)], 1);
    expect(r.map((x) => x.cuenta)).toEqual([true, true, false]);
  });

  it("con N = 2 caben dos abiertas; una bloqueada no ocupa lugar", () => {
    const r = aplicarTope([s("BTC/USD", 0, null), s("BTC/USD", 30, null), s("BTC/USD", 60, null), s("BTC/USD", 90, null)], 2);
    expect(r.map((x) => x.cuenta)).toEqual([true, true, false, false]);
  });

  it("devuelve las señales en el orden recibido aunque lleguen desordenadas", () => {
    const r = aplicarTope([s("BTC/USD", 30, null), s("BTC/USD", 0, null)], 1);
    expect(r.map((x) => x.cuenta)).toEqual([false, true]);
  });
});
