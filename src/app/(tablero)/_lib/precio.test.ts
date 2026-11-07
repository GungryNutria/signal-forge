import { describe, expect, it } from "vitest";
import type { OperacionGrafica, PuntoPrecio } from "@/server/consultas/tipos";
import { volverAPrecio } from "./params";
import {
  agruparMarcadores,
  colocarRotulos,
  consultaDePrecio,
  distanciaANiveles,
  duracionTexto,
  hrefOperacion,
  hrefPrecio,
  leerPrecio,
  marcas,
  rangoQueIncluye,
  resumenSerie,
  ticksX,
  ticksY,
  tramos,
} from "./precio";

const punto = (min: number, hueco = false, cierre = "100"): PuntoPrecio => ({
  evaluacionId: `e${min}`,
  t: new Date(Date.UTC(2026, 10, 7, 0, min)).toISOString(),
  inicioVela: "",
  cierre,
  sma20: "99",
  cierrePrevio: "98",
  resultado: "sin_senal",
  hueco,
});

describe("leerPrecio / hrefPrecio", () => {
  it("usa BTC/USD y 24 h por defecto e ignora lo inválido", () => {
    expect(leerPrecio({})).toEqual({ activo: "BTC/USD", rango: "24h", op: null, de: null });
    expect(leerPrecio({ activo: "ETH/USD", rango: "1y", op: "x", de: "propuesta" })).toEqual({
      activo: "BTC/USD",
      rango: "24h",
      op: null,
      de: null,
    });
  });
  it("lee activo, rango, op y de válidos", () => {
    const op = "0198c0de-0000-7000-8000-000000000001";
    expect(leerPrecio({ activo: "SOL/USD", rango: "7d", op, de: "propuesta" })).toEqual({ activo: "SOL/USD", rango: "7d", op, de: "propuesta" });
  });
  it("hrefPrecio codifica el activo", () => {
    expect(hrefPrecio({ activo: "BTC/USD", rango: "24h" })).toBe("/precio?activo=BTC%2FUSD&rango=24h");
    expect(hrefPrecio({})).toBe("/precio");
  });
  it("volverAPrecio revalida y nunca refleja texto libre", () => {
    expect(volverAPrecio("activo=SOL%2FUSD&rango=30d&xss=%3Cb%3E")).toBe("?activo=SOL%2FUSD&rango=30d");
    expect(consultaDePrecio(undefined)).toBe("?activo=BTC%2FUSD&rango=24h");
  });
  it("hrefOperacion lleva de=precio y v", () => {
    const id = "0198c0de-0000-7000-8000-000000000001";
    const h = hrefOperacion(id, "BTC/USD", "7d");
    expect(h.startsWith(`/propuestas/${id}?de=precio&v=`)).toBe(true);
    expect(volverAPrecio(new URL(h, "http://x").searchParams.get("v") ?? "")).toBe(`?activo=BTC%2FUSD&rango=7d&op=${id}`);
  });
});

describe("rangoQueIncluye (AC-UX-11)", () => {
  const ahora = new Date("2026-11-07T20:00:00Z");
  const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();
  it("elige el rango más corto que incluye la entrada", () => {
    expect(rangoQueIncluye(hace(3), ahora)).toBe("24h");
    expect(rangoQueIncluye(hace(5), ahora)).toBe("24h");
    expect(rangoQueIncluye(hace(72), ahora)).toBe("7d");
    expect(rangoQueIncluye(hace(24 * 20), ahora)).toBe("30d");
    expect(rangoQueIncluye(hace(24 * 40), ahora)).toBe("todo");
  });
});

describe("tramos / resumenSerie (AC-3)", () => {
  const serie = [punto(0), punto(30), punto(90, true), punto(120), punto(240, true), punto(270)];
  it("corta en cada hueco", () => {
    expect(tramos(serie).map((t) => t.length)).toEqual([2, 2, 2]);
    expect(tramos([])).toEqual([]);
  });
  it("cuenta huecos con su intervalo y el mínimo y máximo", () => {
    const r = resumenSerie([punto(0, false, "101"), punto(30, false, "99"), punto(90, true, "105")]);
    expect(r.huecos).toEqual([{ desde: punto(60).t, hasta: punto(60).t }]);
    expect([r.minimo, r.maximo, r.n]).toEqual([99, 105, 3]);
  });
});

describe("agruparMarcadores (AC-UX-9)", () => {
  it("conserva la suma y agrupa por distancia euclidiana", () => {
    const items = [{ x: 10, y: 50 }, { x: 25, y: 50 }, { x: 60, y: 50 }, { x: 62, y: 120 }, { x: 200, y: 10 }];
    const g = agruparMarcadores(items, 20);
    expect(g.map((x) => x.items.length)).toEqual([2, 1, 1, 1]);
    expect(g.reduce((s, x) => s + x.items.length, 0)).toBe(items.length);
  });
  it("48 marcadores muy juntos suman 48", () => {
    const items = Array.from({ length: 48 }, (_, i) => ({ x: i * 6, y: 100 }));
    const g = agruparMarcadores(items, 20);
    expect(g.reduce((s, x) => s + x.items.length, 0)).toBe(48);
    expect(g.length).toBeLessThan(48);
  });
});

describe("colocarRotulos (AC-UX-8)", () => {
  it("separa los rótulos que no se tapan y junta los que sí", () => {
    const r = colocarRotulos([{ y: 10 }, { y: 100 }, { y: 108 }, { y: 300 }], 22);
    expect(r.map((g) => g.items.length)).toEqual([1, 2, 1]);
    for (let i = 1; i < r.length; i++) expect(r[i].y - r[i - 1].y).toBeGreaterThanOrEqual(22);
  });
  it("con 20 niveles juntos ningún resultado se toca", () => {
    const r = colocarRotulos(Array.from({ length: 20 }, (_, i) => ({ y: 100 + i * 3 })), 22);
    expect(r.reduce((s, g) => s + g.items.length, 0)).toBe(20);
    for (let i = 1; i < r.length; i++) expect(r[i].y - r[i - 1].y).toBeGreaterThanOrEqual(22);
  });
});

describe("ejes y textos", () => {
  it("ticksY da valores redondos dentro del dominio", () => {
    const t = ticksY(95_000, 104_000, 5);
    expect(t.every((v) => v >= 95_000 && v <= 104_000)).toBe(true);
    expect(t[0] % 1000).toBe(0);
  });
  it("ticksX da horas de Torreón en 24 h y días en 7 d", () => {
    const x1 = Date.UTC(2026, 10, 7, 20, 42);
    const h = ticksX(x1 - 24 * 3_600_000, x1, "24h", 860);
    expect(h.map((m) => m.etiqueta)).toContain("00:00 · 7 nov");
    expect(h[0].etiqueta).toMatch(/^\d\d:00$/);
    const d = ticksX(x1 - 7 * 86_400_000, x1, "7d", 860);
    expect(d.every((m) => /^\d+ [a-z]{3}$/.test(m.etiqueta))).toBe(true);
  });
  it("duración y distancia a niveles", () => {
    expect(duracionTexto(90 * 60)).toBe("1 h 30 min");
    expect(duracionTexto(45 * 60)).toBe("45 min");
    expect(distanciaANiveles("100", "98", "104")).toBe("2.0 % sobre el SL · 4.0 % bajo el TP");
  });
  it("marcas: una por entrada y por salida dentro del rango", () => {
    const op = (id: string, eIn: boolean, sal: boolean): OperacionGrafica => ({
      propuestaId: id,
      numero: null,
      entrada: { t: "2026-11-07T10:00:00Z", precio: "1", nocionalUsd: "1", cantidad: "1", cierre: "1", cierrePrevio: "1", sma20: "1", enRango: eIn },
      salida: sal
        ? { t: "2026-11-07T11:00:00Z", precio: "1", motivo: "stop_loss", nivel: "1", pnlNetoUsd: "1", pnlNetoPct: "1", duracionS: 1, enRango: true }
        : null,
      niveles: null,
    });
    expect(marcas([op("a", true, true), op("b", false, true)]).map((m) => m.clave)).toEqual(["e:a", "s:a", "s:b"]);
  });
});
