import "server-only";
import { sql } from "drizzle-orm";
import { aCentavos, deCentavos } from "@/core/dinero";
import { aplicarTope } from "@/core/hipotetico";
import { obtenerDb } from "@/server/db/cliente";
import { leerMaxEntradasAbiertas } from "@/server/env";
import { activacionDecisor } from "@/server/modos";
import { eventosDeModos } from "./decisor";
import type { Activo, Comparacion, FilaEvitadaORechazada, FiltroComparacion, HipoteticoVista, Pagina, Tasa } from "./tipos";
import { armarPagina, fallaInyectada, fecha, filas, iso, leerCursor, type Marca, POR_PAGINA } from "./util";

const DIA_MS = 24 * 3_600_000;

/** `[desde, ahora]` del periodo: nunca antes de la activación (REQ-23). `null` si el decisor nunca se activó. */
async function periodoReal(f: FiltroComparacion, ahora: Date): Promise<{ activacion: Date | null; desde: Date | null }> {
  const activacion = await activacionDecisor(obtenerDb());
  if (!activacion) return { activacion: null, desde: null };
  const inicio = f.periodo === "7d" ? ahora.getTime() - 7 * DIA_MS : f.periodo === "30d" ? ahora.getTime() - 30 * DIA_MS : 0;
  return { activacion, desde: new Date(Math.max(inicio, activacion.getTime())) };
}

const tasa = (aciertos: number, cerradas: number): Tasa =>
  cerradas === 0 ? null : { pct: ((aciertos * 100) / cerradas).toFixed(1), aciertos, cerradas };
const sumaUsd = (valores: (string | null)[]): string => deCentavos(valores.reduce((s, v) => s + (v === null ? 0 : aCentavos(Number(v))), 0));

type FilaDecisor = {
  decision: "comprar" | "no_comprar";
  propuesta_decision: string | null;
  regla: string | null;
  propuesta_motivo: string | null;
  etiqueta_estado: string;
  etiqueta_exito: number | null;
  pnl_neto_usd: string | null;
  pnl_a_nivel_usd: string | null;
  hip_resultado: string | null;
  senal: boolean | null;
};

type FilaSenal = {
  evaluacion_id: string;
  activo: Activo;
  t0: Marca;
  hip_resultado: string | null;
  tocado_en: Marca | null;
  hip_etiqueta_exito: number | null;
  hip_pnl_a_nivel_usd: string | null;
};

/**
 * S4 Decisor frente a regla (REQ-23, REQ-25). Todo sale de `v_dataset_decisor` y `v_dataset`, las mismas vistas de la
 * extracción, y el tope de REQ-22 de `aplicarTope` con todas las señales (como `dist/dataset.mjs`): las cifras coinciden.
 */
export async function comparacion(f: FiltroComparacion, ahora: Date): Promise<Comparacion> {
  fallaInyectada("comparacion");
  const topeN = leerMaxEntradasAbiertas();
  const { activacion, desde } = await periodoReal(f, ahora);
  const eventos = await eventosDeModos();
  let cicloApagadoDesde: Date | null = null;
  for (let i = eventos.length - 1; i >= 0 && eventos[i].ciclo === "apagado"; i--) cicloApagadoDesde = eventos[i].momento;

  const base = {
    activacion: activacion ? iso(activacion) : null,
    desde: desde ? iso(desde) : null,
    hasta: iso(ahora),
    topeN,
    cicloApagadoDesde: cicloApagadoDesde ? iso(cicloApagadoDesde) : null,
  };
  if (!desde) {
    return {
      ...base,
      decisor: {
        entradas: 0,
        cerradas: 0,
        tasa: null,
        pnlANivelUsd: "0.00",
        pnlNetoRealUsd: "0.00",
        evitadas: { total: 0, stopLoss: 0, takeProfit: 0, pendientes: 0, sinPrecio: 0 },
        rechazadasPorRegla: [],
      },
      regla: { senales: 0, cuentan: 0, bloqueadasPorTope: 0, cerradas: 0, tasa: null, pnlANivelUsd: "0.00", pendientes: 0 },
      coincidencia: { senalCompro: 0, senalNoCompro: 0, sinSenalCompro: 0, sinSenalNoCompro: 0 },
    };
  }

  const de = desde.toISOString();
  const hasta = ahora.toISOString();
  const deActivo = f.activo ? sql`AND d.activo = ${f.activo}` : sql``;
  const [decisiones, senales] = await Promise.all([
    filas<FilaDecisor>(
      sql`SELECT d.decision, d.propuesta_decision, d.reglas_incumplidas[1] AS regla, d.propuesta_motivo, d.etiqueta_estado,
          d.etiqueta_exito, d.pnl_neto_usd::text AS pnl_neto_usd, d.pnl_a_nivel_usd::text AS pnl_a_nivel_usd, d.hip_resultado,
          coalesce(ev.resultado IN ('senal_registrada', 'propuesta'), false) AS senal
          FROM v_dataset_decisor d
          LEFT JOIN LATERAL (
            SELECT e.resultado FROM evaluaciones e
            WHERE e.activo = d.activo AND e.evaluada_en < d.recibida_en
            ORDER BY e.evaluada_en DESC, e.id DESC LIMIT 1
          ) ev ON TRUE
          WHERE d.valida AND d.recibida_en >= ${de}::timestamptz AND d.recibida_en <= ${hasta}::timestamptz ${deActivo}`,
    ),
    filas<FilaSenal>(
      sql`SELECT evaluacion_id, activo, evaluada_en AS t0, hip_resultado, hip_tocado_en AS tocado_en, hip_etiqueta_exito,
          hip_pnl_a_nivel_usd::text AS hip_pnl_a_nivel_usd
          FROM v_dataset WHERE resultado = 'senal_registrada' ORDER BY evaluada_en, evaluacion_id`,
    ),
  ]);

  const entradas = decisiones.filter((d) => d.propuesta_decision === "ejecutada");
  const cerradas = entradas.filter((d) => d.etiqueta_estado === "cerrada");
  const evitadas = decisiones.filter((d) => d.decision === "no_comprar");
  const cuenta = (r: string) => evitadas.filter((d) => d.hip_resultado === r).length;
  const rechazos = new Map<string, number>();
  for (const d of decisiones.filter((x) => x.propuesta_decision === "rechazada")) {
    const regla = d.regla ?? d.propuesta_motivo ?? "desconocida";
    rechazos.set(regla, (rechazos.get(regla) ?? 0) + 1);
  }

  const conTope = aplicarTope(
    senales.map((s) => ({ ...s, t0: fecha(s.t0), tocadoEn: s.tocado_en ? fecha(s.tocado_en) : null })),
    topeN,
  ).filter((s) => (!f.activo || s.activo === f.activo) && s.t0.getTime() >= desde.getTime() && s.t0.getTime() <= ahora.getTime());
  const cuentan = conTope.filter((s) => s.cuenta);
  const cerradasRegla = cuentan.filter((s) => s.hip_resultado === "take_profit" || s.hip_resultado === "stop_loss");

  const compro = (d: FilaDecisor) => d.decision === "comprar";
  return {
    ...base,
    decisor: {
      entradas: entradas.length,
      cerradas: cerradas.length,
      tasa: tasa(cerradas.filter((d) => d.etiqueta_exito === 1).length, cerradas.length),
      pnlANivelUsd: sumaUsd(cerradas.map((d) => d.pnl_a_nivel_usd)),
      pnlNetoRealUsd: sumaUsd(cerradas.map((d) => d.pnl_neto_usd)),
      evitadas: {
        total: evitadas.length,
        stopLoss: cuenta("stop_loss"),
        takeProfit: cuenta("take_profit"),
        pendientes: cuenta("pendiente"),
        sinPrecio: cuenta("sin_precio_entrada"),
      },
      rechazadasPorRegla: [...rechazos].map(([regla, n]) => ({ regla, n })).sort((a, b) => b.n - a.n || a.regla.localeCompare(b.regla)),
    },
    regla: {
      senales: conTope.length,
      cuentan: cuentan.length,
      bloqueadasPorTope: conTope.length - cuentan.length,
      cerradas: cerradasRegla.length,
      tasa: tasa(cerradasRegla.filter((s) => s.hip_etiqueta_exito === 1).length, cerradasRegla.length),
      pnlANivelUsd: sumaUsd(cerradasRegla.map((s) => s.hip_pnl_a_nivel_usd)),
      pendientes: cuentan.filter((s) => s.hip_resultado === "pendiente").length,
    },
    coincidencia: {
      senalCompro: decisiones.filter((d) => d.senal && compro(d)).length,
      senalNoCompro: decisiones.filter((d) => d.senal && !compro(d)).length,
      sinSenalCompro: decisiones.filter((d) => !d.senal && compro(d)).length,
      sinSenalNoCompro: decisiones.filter((d) => !d.senal && !compro(d)).length,
    },
  };
}

type FilaLista = {
  id: string;
  propuesta_id: string | null;
  recibida_en: Marca;
  activo: Activo;
  confianza: string;
  primera_linea: string;
  tipo: "evitada" | "rechazada";
  hipotetico: string | null;
  regla: string | null;
};

/**
 * REQ-24: las entradas evitadas (`no_comprar` válidas) y las propuestas `comprar` rechazadas por el riesgo, las más
 * recientes primero y con el mismo periodo de la comparación. Las `comprar` sin datos no son propuestas y no se listan.
 */
export async function listarEvitadasYRechazadas(
  f: FiltroComparacion & { tipo?: "evitada" | "rechazada"; hipotetico?: "take_profit" | "stop_loss" | "pendiente" | "sin_precio_entrada"; antes?: string },
  ahora: Date,
): Promise<Pagina<FilaEvitadaORechazada>> {
  fallaInyectada("comparacion");
  const { desde } = await periodoReal(f, ahora);
  if (!desde) return { filas: [], total: 0, siguiente: null, anterior: null };

  const tipo = f.hipotetico ? "evitada" : f.tipo;
  const filtros = [
    sql`d.valida`,
    sql`d.recibida_en >= ${desde.toISOString()}::timestamptz`,
    sql`d.recibida_en <= ${ahora.toISOString()}::timestamptz`,
    sql`(d.decision = 'no_comprar' OR d.propuesta_decision = 'rechazada')`,
  ];
  if (f.activo) filtros.push(sql`d.activo = ${f.activo}`);
  if (tipo === "evitada") filtros.push(sql`d.decision = 'no_comprar'`);
  if (tipo === "rechazada") filtros.push(sql`d.propuesta_decision = 'rechazada'`);
  if (f.hipotetico) filtros.push(sql`d.hip_resultado = ${f.hipotetico}`);
  const donde = sql.join(filtros, sql` AND `);

  const cursor = leerCursor(f.antes);
  const posicion = cursor
    ? cursor.modo === "a"
      ? sql`AND (d.recibida_en, d.decision_id) < (SELECT recibida_en, id FROM decisiones WHERE id = ${cursor.id}::uuid)`
      : sql`AND (d.recibida_en, d.decision_id) > (SELECT recibida_en, id FROM decisiones WHERE id = ${cursor.id}::uuid)`
    : sql``;
  const orden = cursor?.modo === "d" ? sql`ASC` : sql`DESC`;

  const [lote, [{ n }]] = await Promise.all([
    filas<FilaLista>(
      sql`SELECT d.decision_id AS id, d.propuesta_id, d.recibida_en, d.activo, d.confianza::text AS confianza,
          split_part(d.razonamiento, E'\n', 1) AS primera_linea,
          CASE WHEN d.decision = 'no_comprar' THEN 'evitada' ELSE 'rechazada' END AS tipo,
          d.hip_resultado AS hipotetico, d.reglas_incumplidas[1] AS regla
          FROM v_dataset_decisor d
          WHERE ${donde} ${posicion}
          ORDER BY d.recibida_en ${orden}, d.decision_id ${orden}
          LIMIT ${POR_PAGINA + 1}`,
    ),
    filas<{ n: string }>(sql`SELECT count(*)::text AS n FROM v_dataset_decisor d WHERE ${donde}`),
  ]);

  const { filas: pagina, siguiente, anterior } = armarPagina(lote, cursor);
  return {
    filas: pagina.map((r) => ({
      decisionId: r.id,
      propuestaId: r.propuesta_id,
      recibidaEn: iso(r.recibida_en),
      activo: r.activo,
      confianza: r.confianza,
      primeraLinea: r.primera_linea,
      tipo: r.tipo,
      ...(r.tipo === "evitada" && r.hipotetico ? { hipotetico: r.hipotetico as HipoteticoVista["estado"] | "take_profit" | "stop_loss" } : {}),
      ...(r.tipo === "rechazada" && r.regla ? { reglaPrincipal: r.regla } : {}),
    })),
    total: Number(n),
    siguiente,
    anterior,
  };
}
