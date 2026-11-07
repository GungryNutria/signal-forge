import "server-only";
import { sql } from "drizzle-orm";
import { ACTIVOS, type Activo } from "@/core/activos";
import { COLUMNAS_INVESTIGACION, type FilaInvestigacion, vistaInvestigacion } from "./investigaciones";
import type {
  Decision,
  DetalleEvaluacion,
  EstadoEjecucion,
  FilaEjecucion,
  FiltroEjecuciones,
  Pagina,
  ResultadoEvaluacion,
} from "./tipos";
import { armarPagina, fallaInyectada, fecha, filas, iso, leerCursor, type Marca, POR_PAGINA, resultadosPorEjecucion } from "./util";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resultado de cada activo para filtrar en SQL. Una ejecución que murió (estado error) sin evaluación cuenta como error.
const RESULTADO_DE = (activo: Activo) =>
  sql`COALESCE((SELECT ev.resultado FROM evaluaciones ev WHERE ev.ejecucion_id = x.id AND ev.activo = ${activo}),
    CASE WHEN x.estado = 'error' THEN 'error' END)`;

const DESDE = sql`FROM (
  SELECT v.id, v.ranura, v.inicio, v.fin, v.estado, v.version_regla, v.error FROM v_ejecuciones v
) x`;

type FilaSql = {
  id: string;
  ranura: Marca;
  inicio: Marca;
  fin: Marca | null;
  estado: EstadoEjecucion;
  version_regla: string;
  error: string | null;
};

/**
 * S5: más recientes primero, 50 por página, con cursor. El filtro de activo acota el filtro de resultado (no quita
 * filas por sí solo: cada ejecución evalúa los dos activos) y las omitidas por solapamiento salen con cualquier activo.
 */
export async function listarEjecuciones(f: FiltroEjecuciones = {}): Promise<Pagina<FilaEjecucion>> {
  fallaInyectada("listarEjecuciones");
  const filtros = [sql`TRUE`];
  if (f.resultado === "omitida_solapamiento") {
    filtros.push(sql`x.estado = 'omitida_solapamiento'`);
  } else if (f.resultado) {
    const cuales: readonly Activo[] = f.activo ? [f.activo] : ACTIVOS;
    filtros.push(sql`(${sql.join(cuales.map((a) => sql`${RESULTADO_DE(a)} = ${f.resultado}`), sql` OR `)})`);
  }
  const donde = sql.join(filtros, sql` AND `);

  const cursor = leerCursor(f.antes);
  const posicion = cursor
    ? cursor.modo === "a"
      ? sql`AND (x.inicio, x.id) < (SELECT inicio, id FROM ejecuciones WHERE id = ${cursor.id}::uuid)`
      : sql`AND (x.inicio, x.id) > (SELECT inicio, id FROM ejecuciones WHERE id = ${cursor.id}::uuid)`
    : sql``;
  const orden = cursor?.modo === "d" ? sql`ASC` : sql`DESC`;

  const [lote, [{ n }]] = await Promise.all([
    filas<FilaSql>(
      sql`SELECT x.* ${DESDE} WHERE ${donde} ${posicion} ORDER BY x.inicio ${orden}, x.id ${orden} LIMIT ${POR_PAGINA + 1}`,
    ),
    filas<{ n: string }>(sql`SELECT count(*)::text AS n ${DESDE} WHERE ${donde}`),
  ]);

  const { filas: pagina, siguiente, anterior } = armarPagina(lote, cursor);
  const resultados = await resultadosPorEjecucion(pagina);
  return {
    filas: pagina.map((r) => ({
      id: r.id,
      ranura: iso(r.ranura),
      inicio: iso(r.inicio),
      fin: r.fin ? iso(r.fin) : null,
      estado: r.estado,
      versionRegla: r.version_regla,
      error: r.error,
      porActivo: resultados.get(r.id)!,
    })),
    total: Number(n),
    siguiente,
    anterior,
  };
}

/** `activo` acepta `BTC/USD` o la forma de la URL, `BTC-USD`. */
function normalizarActivo(activo: string): Activo | null {
  const a = activo.toUpperCase().replace("-", "/");
  return (ACTIVOS as readonly string[]).includes(a) ? (a as Activo) : null;
}

/** REQ-43: lo que evaluó la regla para un activo en una ejecución, con la investigación adjunta o `null`. */
export async function detalleEvaluacion(ejecucionId: string, activo: string): Promise<DetalleEvaluacion | null> {
  fallaInyectada("detalleEvaluacion");
  const a = normalizarActivo(activo);
  if (!a || !UUID.test(ejecucionId)) return null;

  const [ev] = await filas<{
    id: string;
    evaluada_en: Marca;
    resultado: ResultadoEvaluacion;
    version_regla: string;
    error_detalle: string | null;
    foto: { regla?: unknown } | null;
    investigacion_id: string | null;
    ranura: Marca;
    inicio: Marca;
    fin: Marca | null;
    estado: EstadoEjecucion;
    version_regla_ejecucion: string;
  }>(
    sql`SELECT ev.id, ev.evaluada_en, ev.resultado, ev.version_regla, ev.error_detalle, ev.foto, ev.investigacion_id,
        x.ranura, x.inicio, x.fin, x.estado, x.version_regla AS version_regla_ejecucion
        FROM evaluaciones ev
        JOIN v_ejecuciones x ON x.id = ev.ejecucion_id
        WHERE ev.ejecucion_id = ${ejecucionId}::uuid AND ev.activo = ${a}`,
  );
  if (!ev) return null;

  const [prop] = await filas<{ id: string; decision: Decision }>(
    sql`SELECT id, decision FROM propuestas WHERE evaluacion_id = ${ev.id}::uuid AND es_original LIMIT 1`,
  );
  const [inv] = ev.investigacion_id
    ? await filas<FilaInvestigacion>(
        sql`SELECT ${COLUMNAS_INVESTIGACION} FROM investigaciones i WHERE i.id = ${ev.investigacion_id}::uuid`,
      )
    : [];

  return {
    ejecucion: {
      id: ejecucionId,
      ranura: iso(ev.ranura),
      inicio: iso(ev.inicio),
      fin: ev.fin ? iso(ev.fin) : null,
      estado: ev.estado,
      versionRegla: ev.version_regla_ejecucion,
    },
    evaluacion: {
      id: ev.id,
      activo: a,
      evaluadaEn: iso(ev.evaluada_en),
      resultado: ev.resultado,
      versionRegla: ev.version_regla,
      errorDetalle: ev.error_detalle,
    },
    regla: ev.foto?.regla ?? null,
    foto: ev.foto,
    propuesta: prop ? { id: prop.id, decision: prop.decision } : null,
    investigacion: inv ? vistaInvestigacion(inv, fecha(ev.evaluada_en)) : null,
  };
}
