import "server-only";
import { sql } from "drizzle-orm";
import { ACTIVOS, type Activo } from "@/core/activos";
import { obtenerDb } from "@/server/db/cliente";
import type { PorActivo, ResultadoActivo } from "./tipos";

export type Fila = Record<string, unknown>;

/** Ejecuta SQL de solo lectura y devuelve las filas tal como las entrega `pg` (numeric y timestamptz llegan como texto, ver `Marca`). */
export async function filas<T = Fila>(consulta: ReturnType<typeof sql>): Promise<T[]> {
  return (await obtenerDb().execute(consulta)).rows as T[];
}

/** drizzle entrega los timestamptz de `execute` como texto ("2026-11-06 12:00:00.123456+00"); V8 los interpreta bien. */
export type Marca = Date | string;
export const fecha = (d: Marca): Date => (d instanceof Date ? d : new Date(d));
export const iso = (d: Marca): string => fecha(d).toISOString();

/**
 * AC-UX-9: con `SF_FALLA_INYECTADA=<consulta>[,<consulta>]` esa consulta falla a propósito.
 * Solo se lee en `test` y `desarrollo`: en producción la variable no hace nada.
 */
export function fallaInyectada(consulta: string): void {
  const entorno = process.env.APP_ENV;
  if (entorno !== "test" && entorno !== "desarrollo") return;
  const lista = (process.env.SF_FALLA_INYECTADA ?? "").split(",").map((s) => s.trim());
  if (lista.includes(consulta)) throw new Error(`Falla inyectada en ${consulta}`);
}

type FilaEvaluacion = {
  ejecucion_id: string;
  activo: Activo;
  resultado: ResultadoActivo["resultado"];
  propuesta_id: string | null;
  decision: ResultadoActivo["decision"] | null;
};

/** Resultado por activo de varias ejecuciones. Una ejecución en `error` sin evaluación de un activo cuenta como error de ese activo. */
export async function resultadosPorEjecucion(
  ejecuciones: readonly { id: string; estado: string }[],
): Promise<Map<string, PorActivo>> {
  const mapa = new Map<string, PorActivo>();
  for (const e of ejecuciones) {
    const caida: ResultadoActivo | null = e.estado === "error" ? { resultado: "error" } : null;
    mapa.set(e.id, { "BTC/USD": caida, "SOL/USD": caida });
  }
  if (ejecuciones.length === 0) return mapa;
  const ids = sql.join(
    ejecuciones.map((e) => sql`${e.id}::uuid`),
    sql`, `,
  );
  const evaluaciones = await filas<FilaEvaluacion>(
    sql`SELECT ev.ejecucion_id, ev.activo, ev.resultado, p.id AS propuesta_id, p.decision
        FROM evaluaciones ev
        LEFT JOIN propuestas p ON p.evaluacion_id = ev.id AND p.es_original
        WHERE ev.ejecucion_id IN (${ids})`,
  );
  for (const ev of evaluaciones) {
    const r: ResultadoActivo = { resultado: ev.resultado };
    if (ev.decision) r.decision = ev.decision;
    if (ev.propuesta_id) r.propuestaId = ev.propuesta_id;
    const fila = mapa.get(ev.ejecucion_id);
    if (fila && (ACTIVOS as readonly string[]).includes(ev.activo)) fila[ev.activo] = r;
  }
  return mapa;
}

// Paginación por cursor (keyset). El cursor es opaco para el frontend: "a:<id>" = más antiguas que esa fila,
// "d:<id>" = más recientes que esa fila. Se pagina por el id de la fila, así no se pierde la precisión de µs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const POR_PAGINA = 50;

export type Cursor = { modo: "a" | "d"; id: string };

export function leerCursor(c: string | undefined): Cursor | null {
  const m = /^([ad]):(.+)$/.exec(c ?? "");
  return m && UUID.test(m[2]) ? { modo: m[1] as "a" | "d", id: m[2] } : null;
}

/** `lote` trae una fila de más (límite + 1) y, en modo "d", viene en orden ascendente. */
export function armarPagina<F extends { id: string }>(
  lote: F[],
  cursor: Cursor | null,
): { filas: F[]; siguiente: string | null; anterior: string | null } {
  const hayMas = lote.length > POR_PAGINA;
  const pagina = lote.slice(0, POR_PAGINA);
  if (cursor?.modo === "d") pagina.reverse();
  if (pagina.length === 0) return { filas: pagina, siguiente: null, anterior: null };
  const primera = pagina[0].id;
  const ultima = pagina[pagina.length - 1].id;
  if (cursor?.modo === "d") return { filas: pagina, siguiente: `a:${ultima}`, anterior: hayMas ? `d:${primera}` : null };
  return { filas: pagina, siguiente: hayMas ? `a:${ultima}` : null, anterior: cursor ? `d:${primera}` : null };
}
