import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AC-UX-6 / AC-18: contraste WCAG 2.2 de lo que dibuja S6 sobre el fondo de la gráfica (`surface`; `sunken` en el panel y
// los grupos). Los tokens salen de globals.css, no de copias: si cambian, este test lo ve.
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const token = (n: string): [number, number, number] => {
  const m = new RegExp(`--color-${n}:\\s*#([0-9a-f]{6})`, "i").exec(css);
  if (!m) throw new Error(`token ${n} no encontrado`);
  const h = m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** `frente` con opacidad `a` sobre `fondo`. */
const mezcla = (frente: number[], fondo: number[], a: number) => frente.map((v, i) => Math.round(v * a + fondo[i] * (1 - a)));

const superficie = token("surface");
const hundido = token("sunken");

describe("contraste de S6 (handoff T-2)", () => {
  const graficos: [string, string][] = [
    ["ink", "línea de precio y marcador de entrada"],
    ["muted", "línea SMA20"],
    ["neg", "stop loss y su nivel"],
    ["pos", "take profit y su nivel"],
    ["strong", "cursor y eje"],
    ["accent", "anillo de consulta y foco"],
  ];
  it.each(graficos)("%s ≥ 3:1 sobre surface (%s)", (t) => {
    expect(ratio(token(t), superficie)).toBeGreaterThanOrEqual(3);
  });
  it("los niveles atenuados al 65 % conservan 3:1 sobre surface y sunken", () => {
    for (const t of ["neg", "pos"]) {
      for (const fondo of [superficie, hundido]) expect(ratio(mezcla(token(t), fondo, 0.65), fondo)).toBeGreaterThanOrEqual(3);
    }
  });
  it("al 55 % ya no se cumple (por eso se usa 65 %)", () => {
    expect(ratio(mezcla(token("neg"), hundido, 0.55), hundido)).toBeLessThan(3.1);
  });
  const textos = ["ink", "muted", "neg", "pos", "info"];
  it.each(textos)("texto %s ≥ 4.5:1 sobre surface y sunken", (t) => {
    expect(ratio(token(t), superficie)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(token(t), hundido)).toBeGreaterThanOrEqual(4.5);
  });
  it("el texto de los chips activos (bg sobre accent) ≥ 4.5:1", () => {
    expect(ratio(token("bg"), token("accent"))).toBeGreaterThanOrEqual(4.5);
  });
  it("la rejilla es decorativa (no porta significado): su contraste se informa, no se exige", () => {
    expect(ratio(token("line"), superficie)).toBeLessThan(3);
  });
});
