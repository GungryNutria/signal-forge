import { ACTIVOS, type Activo } from "@/core/activos";
import {
  type OperacionGrafica,
  type PuntoPrecio,
  RANGO_MS,
  RANGOS,
  type Rango,
} from "@/server/consultas/tipos";
import { dia, horaCorta, pct, zona } from "./formato";

// Lógica pura de S6 Precio (spec 002): sin `server-only`, sin base y sin React, para probarla con vitest.
// RANGOS y RANGO_MS viven en `consultas/tipos.ts` (desviación 1 de T-1) y se reexportan aquí.
export { RANGO_MS, RANGOS };
export type { Rango };

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export const NOMBRE_RANGO: Record<Rango, string> = { "24h": "24 h", "7d": "7 días", "30d": "30 días", todo: "Todo" };
/** Complemento de frases: "No hay precios de BTC/USD en las últimas 24 h". */
export const FRASE_RANGO: Record<Rango, string> = {
  "24h": "las últimas 24 h",
  "7d": "los últimos 7 días",
  "30d": "los últimos 30 días",
  todo: "todo el historial",
};

// ───────────────────────────── URL ─────────────────────────────

type Params = Record<string, string | string[] | undefined>;
const uno = (p: Params, k: string): string | undefined => {
  const v = p[k];
  return Array.isArray(v) ? v[0] : v;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ValoresPrecio = { activo: Activo; rango: Rango; op: string | null; de: "propuesta" | null };

/** Lo inválido se ignora: BTC/USD, 24 h, sin operación (Q-2, Q-4). `de` solo cuenta si hay `op`. */
export function leerPrecio(p: Params): ValoresPrecio {
  const activo = ACTIVOS.find((a) => a === uno(p, "activo")) ?? "BTC/USD";
  const rango = RANGOS.find((r) => r === uno(p, "rango")) ?? "24h";
  const o = uno(p, "op");
  const op = o && UUID.test(o) ? o.toLowerCase() : null;
  return { activo, rango, op, de: op && uno(p, "de") === "propuesta" ? "propuesta" : null };
}

/** `/precio?activo=BTC%2FUSD&rango=24h&op=…&de=propuesta` (solo lo que se pasa). */
export function hrefPrecio(v: { activo?: Activo; rango?: Rango; op?: string; de?: "propuesta" }): string {
  const q = new URLSearchParams();
  for (const [k, valor] of Object.entries(v)) if (valor) q.set(k, valor);
  const s = q.toString();
  return s ? `/precio?${s}` : "/precio";
}

/** `activo`, `rango` y `op` en forma de consulta (con `?`), revalidados: lo que `v=` trae de S6 nunca se refleja tal cual. */
export function consultaDePrecio(v: string | undefined): string {
  const { activo, rango, op } = leerPrecio(Object.fromEntries(new URLSearchParams(v ?? "")));
  const q = new URLSearchParams({ activo, rango });
  if (op) q.set("op", op);
  return `?${q.toString()}`;
}

/** S6 → S3: `/propuestas/<id>?de=precio&v=activo=…&rango=…&op=…`. */
export function hrefOperacion(propuestaId: string, activo: Activo, rango: Rango): string {
  const v = new URLSearchParams({ activo, rango, op: propuestaId }).toString();
  return `/propuestas/${propuestaId}?${new URLSearchParams({ de: "precio", v }).toString()}`;
}

/** El rango más corto (24 h, 7 d, 30 d) que incluye la hora de entrada; si ninguno, "todo" (REQ-19). */
export function rangoQueIncluye(abiertoEn: string, ahora: Date): Rango {
  const t = new Date(abiertoEn).getTime();
  for (const r of ["24h", "7d", "30d"] as const) if (t >= ahora.getTime() - (RANGO_MS[r] as number)) return r;
  return "todo";
}

// ───────────────────────────── Serie ─────────────────────────────

/** Parte la serie en cada hueco (REQ-4, AC-3). */
export function tramos(puntos: PuntoPrecio[]): PuntoPrecio[][] {
  const salida: PuntoPrecio[][] = [];
  for (const p of puntos) {
    if (salida.length === 0 || p.hueco) salida.push([p]);
    else salida[salida.length - 1].push(p);
  }
  return salida;
}

export type ResumenSerie = {
  n: number;
  primero: PuntoPrecio | null;
  ultimo: PuntoPrecio | null;
  minimo: number | null;
  maximo: number | null;
  /** Intervalos de 30 min sin punto: de la primera ranura que falta a la última (horas de cierre, ISO). */
  huecos: { desde: string; hasta: string }[];
};

export function resumenSerie(puntos: PuntoPrecio[]): ResumenSerie {
  const cierres = puntos.map((p) => Number(p.cierre));
  const huecos: ResumenSerie["huecos"] = [];
  puntos.forEach((p, i) => {
    if (!p.hueco || i === 0) return;
    const desde = new Date(puntos[i - 1].t).getTime() + 30 * MIN;
    const hasta = new Date(p.t).getTime() - 30 * MIN;
    huecos.push({ desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() });
  });
  return {
    n: puntos.length,
    primero: puntos[0] ?? null,
    ultimo: puntos[puntos.length - 1] ?? null,
    minimo: cierres.length ? Math.min(...cierres) : null,
    maximo: cierres.length ? Math.max(...cierres) : null,
    huecos,
  };
}

// ───────────────────────────── Marcas, grupos y rótulos ─────────────────────────────

export type TipoMarca = "entrada" | "stop_loss" | "take_profit";
export type Marca = { clave: string; tipo: TipoMarca; t: string; precio: string; op: OperacionGrafica };

/** Una marca por entrada y por salida dentro del rango, en orden cronológico (REQ-6, REQ-7). */
export function marcas(filas: OperacionGrafica[]): Marca[] {
  const lista: Marca[] = [];
  for (const op of filas) {
    if (op.entrada.enRango) lista.push({ clave: `e:${op.propuestaId}`, tipo: "entrada", t: op.entrada.t, precio: op.entrada.precio, op });
    if (op.salida?.enRango) {
      lista.push({ clave: `s:${op.propuestaId}`, tipo: op.salida.motivo, t: op.salida.t, precio: op.salida.precio, op });
    }
  }
  return lista.sort((a, b) => a.t.localeCompare(b.t) || a.clave.localeCompare(b.clave));
}

export type Grupo<T> = { x: number; y: number; items: T[] };

/**
 * Junta los marcadores cuyo centro queda a menos de `umbralPx` (distancia euclidiana) del centro del grupo anterior
 * (AC-UX-9). La suma de `items` siempre es igual al número de entradas. Se espera orden por x.
 */
export function agruparMarcadores<T extends { x: number; y: number }>(items: T[], umbralPx: number): Grupo<T>[] {
  const grupos: Grupo<T>[] = [];
  for (const it of items) {
    const g = grupos[grupos.length - 1];
    if (g && Math.hypot(it.x - g.x, it.y - g.y) < umbralPx) {
      g.items.push(it);
      g.x = g.items.reduce((s, i) => s + i.x, 0) / g.items.length;
      g.y = g.items.reduce((s, i) => s + i.y, 0) / g.items.length;
    } else grupos.push({ x: it.x, y: it.y, items: [it] });
  }
  return grupos;
}

/**
 * Rótulos de nivel sin choques (AC-UX-8): los que quedan a menos de `alto` px entre sí se juntan en uno, en la media
 * de sus `y`. Se repite hasta que ninguno de los resultantes se toque.
 */
export function colocarRotulos<T extends { y: number }>(niveles: T[], alto: number): Grupo<T>[] {
  let grupos: { y: number; items: T[] }[] = [...niveles].sort((a, b) => a.y - b.y).map((n) => ({ y: n.y, items: [n] }));
  for (let cambio = true; cambio; ) {
    cambio = false;
    const siguiente: typeof grupos = [];
    for (const g of grupos) {
      const previo = siguiente[siguiente.length - 1];
      if (previo && g.y - previo.y < alto) {
        previo.items.push(...g.items);
        previo.y = previo.items.reduce((s, i) => s + i.y, 0) / previo.items.length;
        cambio = true;
      } else siguiente.push({ ...g, items: [...g.items] });
    }
    grupos = siguiente;
  }
  return grupos.map((g) => ({ x: 0, ...g }));
}

// ───────────────────────────── Ejes ─────────────────────────────

/** Marcas "bonitas" de un eje numérico: entre `n` y `n + 3` valores dentro de [min, max]. */
export function ticksY(min: number, max: number, n = 5): number[] {
  const bruto = (max - min) / n;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const paso = ([1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto) as number) ?? pot * 10;
  const lista: number[] = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + paso * 1e-9; v += paso) lista.push(Number(v.toFixed(8)));
  return lista;
}

/** Desfase de Torreón respecto de UTC en ms, leído de la misma zona que muestra el tablero. */
function desfaseMs(t: number): number {
  const m = /UTC([−+-])(\d+)(?::(\d+))?/.exec(zona(new Date(t)));
  if (!m) return 0;
  return (m[1] === "+" ? 1 : -1) * (Number(m[2]) * HORA + Number(m[3] ?? 0) * MIN);
}

export type MarcaEje = { t: number; etiqueta: string };

/** Marcas del eje X en hora de Torreón: horas en 24 h (o si el periodo cabe en 36 h) y días en los demás (AC-UX-15). */
export function ticksX(x0: number, x1: number, rango: Rango, anchoPx: number): MarcaEje[] {
  const span = x1 - x0;
  if (span <= 0 || anchoPx <= 0) return [];
  const off = desfaseMs(x1);
  const enHoras = rango === "24h" || span <= 36 * HORA;
  const unidad = enHoras ? HORA : DIA;
  const pxPorUnidad = (anchoPx * unidad) / span;
  const minPx = enHoras ? 86 : 56;
  const pasos = enHoras ? [1, 2, 3, 4, 6, 12] : [1, 2, 5, 7, 14, 30];
  const paso = pasos.find((p) => p * pxPorUnidad >= minPx) ?? pasos[pasos.length - 1];
  const salto = paso * unidad;
  const lista: MarcaEje[] = [];
  for (let t = Math.ceil((x0 + off) / salto) * salto - off; t <= x1; t += salto) {
    const iso = new Date(t).toISOString();
    const esMedianoche = (t + off) % DIA === 0;
    lista.push({ t, etiqueta: enHoras ? (esMedianoche ? `${horaCorta(iso)} · ${dia(iso)}` : horaCorta(iso)) : dia(iso) });
  }
  return lista;
}

// ───────────────────────────── Textos ─────────────────────────────

/** `1 h 30 min`, `45 min`, `2 d 1 h`. */
export function duracionTexto(segundos: number): string {
  const m = Math.max(0, Math.round(segundos / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}

/** `2.6 % sobre el SL · 3.5 % bajo el TP`: distancia de la última vela a cada nivel (F-UX-B). */
export function distanciaANiveles(cierre: string, stopLoss: string, takeProfit: string): string {
  const [c, sl, tp] = [Number(cierre), Number(stopLoss), Number(takeProfit)];
  const alSl = ((c - sl) / sl) * 100;
  const alTp = ((tp - c) / c) * 100;
  return `${pct(Math.abs(alSl), 1, false)} ${alSl >= 0 ? "sobre" : "bajo"} el SL · ${pct(Math.abs(alTp), 1, false)} ${alTp >= 0 ? "bajo" : "sobre"} el TP`;
}
