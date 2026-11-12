import { describe, expect, it } from "vitest";
import { armarContexto, type EntradaContexto } from "./contexto";
import { tsPosteriores } from "./foto";

const T = new Date("2026-11-12T17:46:03Z");
const MEDIA_HORA = 30 * 60_000;
// 60 barras cerradas que terminan a las 17:30 y una abierta (17:30).
const barras = (base: number) =>
  Array.from({ length: 61 }, (_, i) => ({
    t: new Date(Date.parse("2026-11-12T17:30:00Z") - (60 - i) * MEDIA_HORA).toISOString(),
    c: base + i,
    v: 2,
  }));

const activo = (a: "BTC/USD" | "SOL/USD", base: number): EntradaContexto["activos"]["BTC/USD"] => ({
  mercado: {
    activo: a,
    ultimo: { valor: base + 0.5, ts: new Date("2026-11-12T17:45:50Z") },
    bid: { valor: base + 0.4, ts: new Date("2026-11-12T17:45:55Z") },
    ask: { valor: base + 0.6, ts: new Date("2026-11-12T17:45:55Z") },
    barras: barras(base),
  },
  sinDatos: null,
  investigacion: null,
  entradasAbiertas: [],
  bloqueadoR9: false,
  historial: { entradas: [], cierres: [] },
});

const entrada = (): EntradaContexto => ({
  id: "6b1f5c9e-3a47-4b0e-9a56-1f2d3c4b5a69",
  creadoEn: T,
  modoTrading: "operando",
  maxEntradasAbiertasPorActivo: 1,
  entradasHoy: 3,
  cartera: {
    saldoVirtualC: 967_835,
    exposicionC: 100_000,
    exposicionPorActivoC: { "BTC/USD": 50_000, "SOL/USD": 50_000 },
    pnlDiaC: -410,
  },
  activos: { "BTC/USD": activo("BTC/USD", 1000), "SOL/USD": activo("SOL/USD", 100) },
});

describe("armarContexto (REQ-3 a REQ-6)", () => {
  it("trae el estado, la cartera y los campos de mercado por activo, distintos por activo", () => {
    const c = armarContexto(entrada());
    expect(c).toMatchObject({
      version: "contexto-v1",
      id: "6b1f5c9e-3a47-4b0e-9a56-1f2d3c4b5a69",
      creado_en: "2026-11-12T17:46:03.000Z",
      vigencia_min: 15,
      estado: {
        modo_trading: "operando",
        limites: {
          nocional_por_entrada_usd: "500.00",
          r3_max_nocional_pct: "10",
          r4_max_exposicion_pct: "50",
          r5_max_entradas_dia: 48,
          r11_max_entradas_abiertas_por_activo: 1,
        },
        entradas_hoy: 3,
        margen_entradas_dia: 45,
        margen_exposicion_usd: "3839.17", // 50 % de 9678.35 = 4839.17, menos 1000.00
      },
      cartera: {
        saldo_virtual_usd: "9678.35",
        saldo_libre_usd: "8678.35",
        exposicion_total_usd: "1000.00",
        exposicion_por_activo_usd: { "BTC/USD": "500.00", "SOL/USD": "500.00" },
        pnl_dia_usd: "-4.10",
        faltantes: [],
      },
    });
    const btc = c.activos["BTC/USD"];
    const sol = c.activos["SOL/USD"];
    expect(btc.datos).toBe("disponibles");
    expect(btc.mercado.ultimo_precio?.valor).toBe("1000.5");
    expect(sol.mercado.ultimo_precio?.valor).toBe("100.5");
    for (const campo of ["bid", "ask", "spread_bps", "variacion_1h", "variacion_24h", "volumen_24h", "volatilidad_24h", "ts_ultima_barra"] as const) {
      expect(btc.mercado[campo], campo).not.toBeNull();
    }
    expect(btc.mercado.serie_30m).toHaveLength(48);
    expect(btc.mercado.serie_30m.at(-1)).toEqual({ t: "2026-11-12T17:00:00.000Z", c: "1059" });
    expect(btc.investigacion).toEqual({ estado: "sin_investigacion" });
    expect(btc).toMatchObject({ entradas_abiertas: [], entradas_abiertas_n: 0, margen_r11: 1, bloqueado_r9: false });
  });

  it("todo dato con hora es anterior o igual a la del contexto (REQ-4)", () => {
    expect(tsPosteriores(armarContexto(entrada()), T)).toEqual([]);
    // Un quote posterior se descarta como faltante, no se inventa.
    const e = entrada();
    e.activos["SOL/USD"].mercado.bid = { valor: 1, ts: new Date(T.getTime() + 1000) };
    const sol = armarContexto(e).activos["SOL/USD"].mercado;
    expect(sol.bid).toBeNull();
    expect(sol.faltantes).toContain("bid");
  });

  it("no incluye la regla fija ni razonamientos previos (REQ-5)", () => {
    const texto = JSON.stringify(armarContexto(entrada()));
    for (const prohibido of ["regla", "sma20", "razonamiento", "motivos", "APCA", "token"]) {
      expect(texto, prohibido).not.toContain(prohibido);
    }
  });

  it("marca datos no disponibles con su motivo y conserva el resto", () => {
    const e = entrada();
    e.activos["SOL/USD"].sinDatos = "sin quote para el activo";
    const c = armarContexto(e);
    expect(c.activos["SOL/USD"]).toMatchObject({ datos: "no_disponibles", motivo_no_disponibles: "sin quote para el activo" });
    expect(c.activos["BTC/USD"]).toMatchObject({ datos: "disponibles", motivo_no_disponibles: null });
  });

  it("la investigación lleva antigüedad y vigencia; vencida sigue apareciendo", () => {
    const e = entrada();
    const inv = (min: number) => ({
      id: "i1",
      activo: "BTC/USD",
      estado: "aceptada" as const,
      recibidaEn: new Date(T.getTime() - min * 60_000),
      sentimiento: 0.42,
      noticiaFuerte: false,
      confianza: 0.8,
      resumen: "Texto.",
      fuentes: ["https://example.com"],
      versionInstrucciones: "investigacion-v1",
    });
    e.activos["BTC/USD"].investigacion = inv(31);
    e.activos["SOL/USD"].investigacion = inv(95);
    const c = armarContexto(e);
    expect(c.activos["BTC/USD"].investigacion).toMatchObject({ estado: "adjunta", antiguedad_min: 31, vigente: true, sentimiento: "0.42" });
    expect(c.activos["SOL/USD"].investigacion).toMatchObject({ estado: "adjunta", antiguedad_min: 95, vigente: false });
  });

  it("entradas abiertas, pendientes de llenado, historial y R11", () => {
    const e = entrada();
    e.activos["BTC/USD"].entradasAbiertas = [
      { estado: "abierta", abiertaEn: new Date(T.getTime() - 95 * 60_000), proponente: "ciclo", precioEntrada: 1000, stopLoss: 980, takeProfit: 1040, pnlNoRealizadoC: -310 },
      { estado: "pendiente_llenado", abiertaEn: new Date(T.getTime() - 60_000), proponente: "decisor", precioEntrada: null, stopLoss: null, takeProfit: null, pnlNoRealizadoC: null },
    ];
    e.activos["BTC/USD"].historial = {
      entradas: [{ t: new Date(T.getTime() - 3600_000), precioEntrada: 990, proponente: "decisor" }],
      cierres: [{ t: new Date(T.getTime() - 1800_000), motivo: "stop_loss", pnlNetoC: -1260 }],
    };
    e.maxEntradasAbiertasPorActivo = 3;
    const btc = armarContexto(e).activos["BTC/USD"];
    expect(btc.entradas_abiertas[0]).toEqual({
      estado: "abierta",
      abierta_en: "2026-11-12T16:11:03.000Z",
      antiguedad_min: 95,
      proponente: "ciclo",
      precio_entrada: "1000",
      stop_loss: "980",
      take_profit: "1040",
      pnl_no_realizado_usd: "-3.10",
    });
    expect(btc.entradas_abiertas[1]).toMatchObject({ estado: "pendiente_llenado", precio_entrada: null, stop_loss: null, pnl_no_realizado_usd: null });
    expect(btc).toMatchObject({ entradas_abiertas_n: 2, margen_r11: 1 });
    expect(btc.historial_24h.cierres).toEqual([{ t: "2026-11-12T17:16:03.000Z", motivo: "stop_loss", pnl_neto_usd: "-12.60" }]);
    expect(btc.historial_24h.entradas[0]).toMatchObject({ precio_entrada: "990", proponente: "decisor" });
  });

  it("el PnL del día faltante va null y nombrado", () => {
    const e = entrada();
    e.cartera.pnlDiaC = null;
    expect(armarContexto(e).cartera).toMatchObject({ pnl_dia_usd: null, faltantes: ["pnl_dia_usd"] });
  });
});
