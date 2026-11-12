import "server-only";
import { sql } from "drizzle-orm";
import type { ResultadoRegla } from "@/core/riesgo";
import { decisionConContexto } from "./decisor";
import { COLUMNAS_INVESTIGACION, type FilaInvestigacion, vistaInvestigacion } from "./investigaciones";
import type {
  Decision,
  DetallePropuesta,
  EstadoOperacion,
  EventoOrdenVista,
  FilaPropuesta,
  FiltroPropuestas,
  OrdenVista,
  Pagina,
  Proponente,
  ReglaDetalle,
  ReglaPrincipal,
} from "./tipos";
import { armarPagina, fallaInyectada, fecha, filas, iso, leerCursor, type Marca, POR_PAGINA } from "./util";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Estado de la operación de una propuesta ejecutada (plan.md §Contratos y O-4). La orden de entrada rechazada,
// cancelada o que nunca se envió es "rechazada_broker": no abrió posición.
const ESTADO_OPERACION = sql`CASE
  WHEN p.decision <> 'ejecutada' THEN NULL
  WHEN c.lote_id IS NOT NULL THEN CASE c.motivo_cierre WHEN 'take_profit' THEN 'cerrada_tp' ELSE 'cerrada_sl' END
  WHEN l.id IS NOT NULL THEN 'abierta'
  WHEN oe.estado IN ('rechazada', 'cancelada', 'no_enviada') THEN 'rechazada_broker'
  WHEN oe.estado = 'desconocido' THEN 'desconocido'
  ELSE 'pendiente_llenado'
END`;

// El proponente de una propuesta: 'decisor' si lo dice la fila; todo lo demás es el ciclo (usa tendencia-sma-v1).
const PROPONENTE = sql`CASE WHEN p.proponente = 'decisor' THEN 'decisor' ELSE 'ciclo' END`;

const DESDE = sql`FROM propuestas p
  LEFT JOIN lotes l ON l.propuesta_id = p.id
  LEFT JOIN cierres_lote c ON c.lote_id = l.id
  LEFT JOIN v_ordenes oe ON oe.propuesta_id = p.id AND oe.tramo = 'entrada'`;

type FilaSql = {
  id: string;
  proponente: Proponente;
  recibida_en: Marca;
  activo: string | null;
  lado: string | null;
  nocional_usd: string | null;
  cantidad: string | null;
  decision: Decision;
  motivo: string;
  reglas: ResultadoRegla[] | null;
  estado: EstadoOperacion | null;
  pnl_usd: string | null;
};

function reglaPrincipal(reglas: ResultadoRegla[] | null): { principal: ReglaPrincipal | null; mas: number } {
  const incumplidas = (reglas ?? []).filter((r) => r.aplica && !r.cumple);
  if (incumplidas.length === 0) return { principal: null, mas: 0 };
  const [r] = incumplidas;
  return { principal: { regla: r.regla, observado: r.observado, limite: r.limite }, mas: incumplidas.length - 1 };
}

/** S2: más recientes primero, 50 por página, con cursor (ver `util.ts`). `total` respeta los filtros. */
export async function listarPropuestas(f: FiltroPropuestas = {}): Promise<Pagina<FilaPropuesta>> {
  fallaInyectada("listarPropuestas");
  const filtros = [sql`TRUE`];
  if (f.proponente) filtros.push(sql`${PROPONENTE} = ${f.proponente}`);
  if (f.activo) filtros.push(sql`p.activo = ${f.activo}`);
  if (f.decision) filtros.push(sql`p.decision = ${f.decision}`);
  if (f.estado) filtros.push(sql`${ESTADO_OPERACION} = ${f.estado}`);
  const donde = sql.join(filtros, sql` AND `);

  const cursor = leerCursor(f.antes);
  const posicion = cursor
    ? cursor.modo === "a"
      ? sql`AND (p.recibida_en, p.id) < (SELECT recibida_en, id FROM propuestas WHERE id = ${cursor.id}::uuid)`
      : sql`AND (p.recibida_en, p.id) > (SELECT recibida_en, id FROM propuestas WHERE id = ${cursor.id}::uuid)`
    : sql``;
  const orden = cursor?.modo === "d" ? sql`ASC` : sql`DESC`;

  const [lote, [{ n }]] = await Promise.all([
    filas<FilaSql>(
      sql`SELECT p.id, ${PROPONENTE} AS proponente, p.recibida_en, p.activo, p.lado, p.nocional_usd::text AS nocional_usd,
          p.cantidad::text AS cantidad, p.decision, p.motivo, p.reglas, ${ESTADO_OPERACION} AS estado, c.pnl_neto_usd::text AS pnl_usd
          ${DESDE}
          WHERE ${donde} ${posicion}
          ORDER BY p.recibida_en ${orden}, p.id ${orden}
          LIMIT ${POR_PAGINA + 1}`,
    ),
    filas<{ n: string }>(sql`SELECT count(*)::text AS n ${DESDE} WHERE ${donde}`),
  ]);

  const { filas: pagina, siguiente, anterior } = armarPagina(lote, cursor);
  return {
    filas: pagina.map((r) => {
      const { principal, mas } = reglaPrincipal(r.reglas);
      return {
        id: r.id,
        proponente: r.proponente,
        recibidaEn: iso(r.recibida_en),
        activo: r.activo,
        lado: r.lado,
        nocionalUsd: r.nocional_usd,
        cantidad: r.cantidad,
        decision: r.decision,
        motivo: r.motivo,
        estado: r.estado,
        pnlUsd: r.pnl_usd,
        reglaPrincipal: principal,
        masReglas: mas,
      };
    }),
    total: Number(n),
    siguiente,
    anterior,
  };
}

type FilaDetalle = FilaSql & {
  tipo_orden: string | null;
  decision_id: string | null;
  clave_idempotencia: string | null;
  version_regla: string | null;
  justificacion: unknown;
  ejecucion_id: string | null;
  evaluacion_id: string | null;
  etiqueta: "pendiente" | "cerrada" | "no_aplica";
  lote_id: string | null;
  abierto_en: Marca | null;
  precio_entrada: string | null;
  cantidad_neta: string | null;
  stop_loss: string | null;
  take_profit: string | null;
  comision_bps: number | null;
  etiqueta_exito: number | null;
  motivo_cierre: "take_profit" | "stop_loss" | null;
  cerrado_en: Marca | null;
  precio_salida: string | null;
  pnl_neto_pct: string | null;
  duracion_min: string | null;
};

/** S3 (REQ-28). `null` si el id no existe o no es un uuid. */
export async function detallePropuesta(id: string): Promise<DetallePropuesta | null> {
  fallaInyectada("detallePropuesta");
  if (!UUID.test(id)) return null;

  const [p] = await filas<FilaDetalle>(
    sql`SELECT p.id, p.recibida_en, p.activo, p.lado, p.nocional_usd::text AS nocional_usd, p.cantidad::text AS cantidad,
        p.decision, p.motivo, p.reglas, p.tipo_orden, ${PROPONENTE} AS proponente, p.decision_id, p.clave_idempotencia, p.version_regla,
        p.justificacion, p.ejecucion_id, p.evaluacion_id,
        ${ESTADO_OPERACION} AS estado, c.pnl_neto_usd::text AS pnl_usd,
        CASE
          WHEN p.decision <> 'ejecutada' THEN 'no_aplica'
          WHEN c.lote_id IS NOT NULL THEN 'cerrada'
          WHEN l.id IS NULL AND oe.estado IN ('rechazada', 'cancelada', 'no_enviada') THEN 'no_aplica'
          ELSE 'pendiente'
        END AS etiqueta,
        l.id AS lote_id, l.abierto_en, l.precio_entrada::text AS precio_entrada, l.cantidad_neta::text AS cantidad_neta,
        l.stop_loss::text AS stop_loss, l.take_profit::text AS take_profit, l.comision_bps,
        c.etiqueta_exito, c.motivo_cierre, c.cerrado_en, c.precio_salida::text AS precio_salida,
        c.pnl_neto_pct::text AS pnl_neto_pct, round(c.duracion_s / 60.0, 2)::text AS duracion_min
        ${DESDE}
        WHERE p.id = ${id}::uuid`,
  );
  if (!p) return null;

  const ordenes = await filas<{ id: string; tramo: "entrada" | "salida"; client_order_id: string }>(
    sql`SELECT o.id, o.tramo, o.client_order_id FROM ordenes o
        WHERE o.propuesta_id = ${id}::uuid OR o.lote_id = ${p.lote_id}::uuid
        ORDER BY o.creada_en, o.id`,
  );
  const eventos = ordenes.length
    ? await filas<{
        orden_id: string;
        momento: Marca;
        estado: string;
        cantidad_llenada: string | null;
        precio_medio: string | null;
        respuesta: unknown;
        detalle: string | null;
      }>(
        sql`SELECT orden_id, momento, estado, cantidad_llenada::text AS cantidad_llenada, precio_medio::text AS precio_medio,
            respuesta, detalle FROM eventos_orden
            WHERE orden_id IN (${sql.join(ordenes.map((o) => sql`${o.id}::uuid`), sql`, `)})
            ORDER BY momento, id`,
      )
    : [];

  const ordenesVista: OrdenVista[] = ordenes.map((o) => {
    const propios = eventos.filter((e) => e.orden_id === o.id);
    const vistos: EventoOrdenVista[] = propios.map((e) => ({
      momento: iso(e.momento),
      estado: e.estado,
      cantidadLlenada: e.cantidad_llenada,
      precioMedio: e.precio_medio,
      detalle: e.detalle,
    }));
    const conRespuesta = [...propios].reverse().find((e) => e.respuesta !== null);
    return {
      id: o.id,
      tramo: o.tramo,
      clientOrderId: o.client_order_id,
      estado: propios.length ? propios[propios.length - 1].estado : null,
      respuestaBroker: conRespuesta?.respuesta ?? null,
      eventos: vistos,
    };
  });

  const reglas: ReglaDetalle[] = (p.reglas ?? []).map((r) => ({
    regla: r.regla,
    estado: !r.aplica ? "no_aplica" : r.cumple ? "cumple" : "incumple",
    observado: r.observado,
    limite: r.limite,
  }));
  // D-4: el conjunto aplicado se deriva de `reglas`; las propuestas anteriores a R11 la muestran como no evaluada.
  const reglasAplicadas = p.reglas === null ? null : reglas.some((r) => r.regla === "R11") ? "R1-R11" : "R1-R10";
  if (reglasAplicadas === "R1-R10") reglas.push({ regla: "R11", estado: "no_evaluada", observado: "", limite: "" });
  reglas.sort((a, b) => Number(b.estado === "incumple") - Number(a.estado === "incumple"));

  const [cierre] = p.lote_id && p.cerrado_en
    ? await filas<{
        motivo_cierre: "stop_loss" | "take_profit";
        pnl_a_nivel_usd: string;
        pnl_a_nivel_pct: string;
        nivel: string;
        precio_disparo: string | null;
        precio_disparo_ts: Marca | null;
        precio_salida: string;
        movimiento_usd: string;
        movimiento_pct: string;
        deslizamiento_usd: string;
        deslizamiento_pct: string;
        comision_usd: string;
        comision_pct: string;
        pnl_neto_usd: string;
        pnl_neto_pct: string;
      }>(
        sql`SELECT vc.motivo_cierre, n.s::text AS nivel, vc.precio_disparo::text AS precio_disparo, vc.precio_disparo_ts,
            vc.precio_salida::text AS precio_salida, vc.movimiento_usd::text AS movimiento_usd,
            round(n.s / vc.precio_entrada - 1, 6)::text AS movimiento_pct, vc.deslizamiento_usd::text AS deslizamiento_usd,
            vc.deslizamiento_pct::text AS deslizamiento_pct, vc.comision_usd::text AS comision_usd,
            round(vc.comision_usd / vc.nocional_entrada_usd, 6)::text AS comision_pct, vc.pnl_neto_usd::text AS pnl_neto_usd,
            vc.pnl_neto_pct::text AS pnl_neto_pct,
            vc.pnl_a_nivel_usd::text AS pnl_a_nivel_usd, vc.pnl_a_nivel_pct::text AS pnl_a_nivel_pct
            FROM v_cierres vc JOIN lotes l ON l.id = vc.lote_id
            CROSS JOIN LATERAL (SELECT CASE WHEN vc.motivo_cierre = 'stop_loss' THEN l.stop_loss ELSE l.take_profit END AS s) n
            WHERE vc.lote_id = ${p.lote_id}::uuid`,
      )
    : [];

  const origen = p.decision_id ? await decisionConContexto(p.decision_id) : null;
  const [ejecucion] = p.ejecucion_id
    ? await filas<{ id: string; ranura: Marca; inicio: Marca; version_regla: string }>(
        sql`SELECT id, ranura, inicio, version_regla FROM ejecuciones WHERE id = ${p.ejecucion_id}::uuid`,
      )
    : [];
  const [inv] = p.evaluacion_id
    ? await filas<FilaInvestigacion & { evaluada_en: Marca }>(
        sql`SELECT ev.evaluada_en, ${COLUMNAS_INVESTIGACION}
            FROM evaluaciones ev JOIN investigaciones i ON i.id = ev.investigacion_id
            WHERE ev.id = ${p.evaluacion_id}::uuid`,
      )
    : [];

  return {
    id: p.id,
    recibidaEn: iso(p.recibida_en),
    activo: p.activo,
    lado: p.lado,
    nocionalUsd: p.nocional_usd,
    cantidad: p.cantidad,
    tipoOrden: p.tipo_orden,
    decision: p.decision,
    motivo: p.motivo,
    estado: p.estado,
    proponente: p.proponente,
    decisor: origen && { decision: origen.decision, contexto: origen.contexto },
    claveIdempotencia: p.clave_idempotencia,
    versionRegla: p.version_regla,
    reglaEntrada: p.justificacion,
    reglas,
    reglasAplicadas,
    salida: cierre
      ? {
          motivo: cierre.motivo_cierre,
          pnlANivelUsd: cierre.pnl_a_nivel_usd,
          pnlANivelPct: cierre.pnl_a_nivel_pct,
          nivel: cierre.nivel,
          precioDisparo: cierre.precio_disparo,
          precioDisparoEn: cierre.precio_disparo_ts ? iso(cierre.precio_disparo_ts) : null,
          precioLlenado: cierre.precio_salida,
          movimientoUsd: cierre.movimiento_usd,
          movimientoPct: cierre.movimiento_pct,
          deslizamientoUsd: cierre.deslizamiento_usd,
          deslizamientoPct: cierre.deslizamiento_pct,
          comisionUsd: cierre.comision_usd,
          comisionPct: cierre.comision_pct,
          pnlNetoUsd: cierre.pnl_neto_usd,
          pnlNetoPct: cierre.pnl_neto_pct,
        }
      : null,
    ordenes: ordenesVista,
    lote: p.lote_id
      ? {
          id: p.lote_id,
          abiertoEn: iso(p.abierto_en!),
          precioEntrada: p.precio_entrada!,
          cantidadNeta: p.cantidad_neta!,
          stopLoss: p.stop_loss!,
          takeProfit: p.take_profit!,
          comisionBps: p.comision_bps!,
        }
      : null,
    etiqueta: {
      estado: p.etiqueta,
      exito: p.etiqueta_exito === null ? null : (p.etiqueta_exito as 0 | 1),
      motivoCierre: p.motivo_cierre,
      cerradoEn: p.cerrado_en ? iso(p.cerrado_en) : null,
      precioSalida: p.precio_salida,
      pnlNetoUsd: p.pnl_usd,
      pnlNetoPct: p.pnl_neto_pct,
      duracionMin: p.duracion_min === null ? null : Number(p.duracion_min),
    },
    ejecucion: ejecucion
      ? { id: ejecucion.id, ranura: iso(ejecucion.ranura), inicio: iso(ejecucion.inicio), versionRegla: ejecucion.version_regla }
      : null,
    evaluacionId: p.evaluacion_id,
    investigacion: inv ? vistaInvestigacion(inv, fecha(inv.evaluada_en)) : null,
  };
}
