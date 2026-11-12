import "server-only";
import { sql } from "drizzle-orm";
import { ACTIVOS, type Activo } from "@/core/activos";
import { type Intervalo, resolverHipotetico } from "@/core/hipotetico";
import type { Modo } from "@/core/modos";
import { ranuraDecisor } from "@/core/tiempo";
import { obtenerDb } from "@/server/db/cliente";
import { activacionDecisor } from "@/server/modos";
import type {
  ContextoVista,
  Decision,
  DecisionVista,
  DetalleDecision,
  EstadoRanura,
  FilaRanura,
  FiltroRanuras,
  HipoteticoVista,
  Pagina,
  PorcentajeRanuras,
  ResultadoDecisorActivo,
} from "./tipos";
import { fallaInyectada, fecha, filas, iso, type Marca } from "./util";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA_MS = 3_600_000;
const POR_PAGINA = 50;

// ───────────────────────────── Modos registrados ─────────────────────────────

type EventoModos = { momento: Marca; ciclo: Modo; decisor: Modo };

/** Eventos `modo_proponentes` en orden (REQ-33): pocos, solo hay uno por cambio. */
export async function eventosDeModos(): Promise<{ momento: Date; ciclo: Modo; decisor: Modo }[]> {
  const rs = await filas<EventoModos>(
    sql`SELECT momento, detalle->'ciclo'->>'efectivo' AS ciclo, detalle->'decisor'->>'efectivo' AS decisor
        FROM eventos WHERE tipo = 'modo_proponentes' ORDER BY id`,
  );
  return rs.map((r) => ({ momento: fecha(r.momento), ciclo: r.ciclo, decisor: r.decisor }));
}

/** El modo efectivo del decisor en `t`: el del último evento no posterior. `null` si aún no había ninguno. */
function modoDecisorEn(eventos: { momento: Date; decisor: Modo }[], t: Date): Modo | null {
  let modo: Modo | null = null;
  for (const e of eventos) if (e.momento.getTime() <= t.getTime()) modo = e.decisor;
  return modo;
}

// ───────────────────────────── Decisión: vista y contexto ─────────────────────────────

/** Columnas de una decisión; `d` es el alias de `decisiones`. El cuerpo crudo solo sale en las no válidas. */
export const COLUMNAS_DECISION = sql`d.id, d.recibida_en, d.ranura, d.activo, d.decision, d.confianza::text AS confianza,
  d.razonamiento, d.version_instrucciones, d.ejecucion_decisor, d.modo_efectivo, d.motivo_modo, d.estado, d.motivo,
  d.motivos, d.valida, CASE WHEN d.valida THEN NULL ELSE d.cuerpo_crudo END AS cuerpo_crudo`;

export type FilaDecisionSql = {
  id: string;
  recibida_en: Marca;
  ranura: Marca;
  activo: Activo | null;
  decision: "comprar" | "no_comprar" | null;
  confianza: string | null;
  razonamiento: string | null;
  version_instrucciones: string | null;
  ejecucion_decisor: string | null;
  modo_efectivo: Modo | null;
  motivo_modo: string | null;
  estado: "aceptada" | "rechazada";
  motivo: string | null;
  motivos: { campo: string; motivo: string }[] | null;
  valida: boolean;
  cuerpo_crudo: string | null;
};

export function decisionVista(r: FilaDecisionSql): DecisionVista {
  return {
    id: r.id,
    recibidaEn: iso(r.recibida_en),
    ranura: iso(r.ranura),
    activo: r.activo,
    decision: r.decision,
    confianza: r.confianza,
    razonamiento: r.razonamiento,
    versionInstrucciones: r.version_instrucciones,
    ejecucionDecisor: r.ejecucion_decisor,
    modoEfectivo: r.modo_efectivo,
    motivoModo: r.motivo_modo,
    estado: r.estado,
    motivo: r.motivo,
    motivos: r.motivos,
    valida: r.valida,
    cuerpoCrudo: r.cuerpo_crudo,
  };
}

/** El contexto que citó una decisión (REQ-4), con su antigüedad al recibirla. `null` si la decisión no citó uno que exista. */
export async function contextoDe(contextoId: string | null, recibidaEn: Marca): Promise<ContextoVista | null> {
  if (!contextoId) return null;
  const [c] = await filas<{ id: string; creado_en: Marca; contenido: unknown }>(
    sql`SELECT id, creado_en, contenido FROM contextos_decisor WHERE id = ${contextoId}::uuid`,
  );
  if (!c) return null;
  const edadMs = Math.max(0, fecha(recibidaEn).getTime() - fecha(c.creado_en).getTime());
  return { id: c.id, creadoEn: iso(c.creado_en), antiguedadAlRecibirMin: Math.floor(edadMs / 60_000), contenido: c.contenido };
}

// ───────────────────────────── Resultado hipotético (REQ-20) ─────────────────────────────

type OrigenHipotetico = { evaluacionId: string } | { decisionId: string };

/**
 * El resultado hipotético de una señal registrada o de una entrada evitada. Con fila en `resultados_hipoteticos` es el
 * guardado; sin ella es "pendiente" (o "sin precio de entrada", que ya se sabe) y sus huecos se calculan al vuelo con las
 * mismas muestras y la misma función que usa `seguimiento`.
 */
export async function hipoteticoDe(origen: OrigenHipotetico, ahora: Date): Promise<HipoteticoVista> {
  const donde = "evaluacionId" in origen ? sql`evaluacion_id = ${origen.evaluacionId}::uuid` : sql`decision_id = ${origen.decisionId}::uuid`;
  const [h] = await filas<{
    resultado: "take_profit" | "stop_loss" | "sin_precio_entrada";
    tocado_en: Marca | null;
    precio_entrada: string | null;
    pnl_a_nivel_usd: string | null;
    pnl_a_nivel_pct: string | null;
    huecos: { desde: string; hasta: string }[];
  }>(
    sql`SELECT resultado, tocado_en, precio_entrada::text AS precio_entrada, pnl_a_nivel_usd::text AS pnl_a_nivel_usd,
        pnl_a_nivel_pct::text AS pnl_a_nivel_pct, huecos FROM resultados_hipoteticos WHERE ${donde}`,
  );
  if (h) {
    if (h.resultado === "sin_precio_entrada") return { estado: "sin_precio_entrada" };
    return {
      estado: "resuelto",
      resultado: h.resultado,
      tocadoEn: iso(h.tocado_en as Marca),
      precioEntrada: h.precio_entrada as string,
      pnlANivelUsd: h.pnl_a_nivel_usd as string,
      pnlANivelPct: h.pnl_a_nivel_pct as string,
      huecos: h.huecos,
    };
  }

  const [origenFila] =
    "evaluacionId" in origen
      ? await filas<{ activo: Activo; t0: Marca; ask: string | null; datos: string | null }>(
          sql`SELECT e.activo, e.evaluada_en AS t0, e.foto->'mercado'->'ask'->>'valor' AS ask, NULL::text AS datos
              FROM evaluaciones e WHERE e.id = ${origen.evaluacionId}::uuid`,
        )
      : await filas<{ activo: Activo; t0: Marca; ask: string | null; datos: string | null }>(
          sql`SELECT d.activo, cx.creado_en AS t0, cx.contenido->'activos'->d.activo->'mercado'->'ask'->>'valor' AS ask,
              cx.contenido->'activos'->d.activo->>'datos' AS datos
              FROM decisiones d JOIN contextos_decisor cx ON cx.id = d.contexto_id WHERE d.id = ${origen.decisionId}::uuid`,
        );
  const precio = origenFila?.ask != null && origenFila.datos !== "no_disponibles" ? Number(origenFila.ask) : NaN;
  if (!origenFila || !(precio > 0)) return { estado: "sin_precio_entrada" };

  const t0 = fecha(origenFila.t0);
  const muestras = await filas<{ fuente_ts: Marca; bid: string }>(
    sql`SELECT fuente_ts, bid::text AS bid FROM muestras_precio
        WHERE activo = ${origenFila.activo} AND fuente_ts > ${t0.toISOString()}::timestamptz AND fuente_ts <= ${ahora.toISOString()}::timestamptz
        ORDER BY fuente_ts`,
  );
  const datos: Intervalo[] = muestras.map((m) => ({ desde: fecha(m.fuente_ts), hasta: fecha(m.fuente_ts), min: Number(m.bid), max: Number(m.bid) }));
  const { huecos } = resolverHipotetico({ t0, precioEntrada: precio }, datos, ahora);
  return {
    estado: "pendiente",
    precioEntrada: precio.toFixed(10),
    huecos: huecos.map((x) => ({ desde: x.desde.toISOString(), hasta: x.hasta.toISOString() })),
  };
}

// ───────────────────────────── Detalle de una decisión ─────────────────────────────

/** La decisión con su contexto y la propuesta que creó, si la hubo. `null` si el id no existe o no es un uuid. */
export async function decisionConContexto(
  id: string,
): Promise<{ decision: DecisionVista; contexto: ContextoVista | null; propuestaId: string | null } | null> {
  if (!UUID.test(id)) return null;
  const [r] = await filas<FilaDecisionSql & { contexto_id: string | null; propuesta_id: string | null }>(
    sql`SELECT ${COLUMNAS_DECISION}, d.contexto_id, p.id AS propuesta_id
        FROM decisiones d LEFT JOIN propuestas p ON p.decision_id = d.id AND p.es_original
        WHERE d.id = ${id}::uuid`,
  );
  if (!r) return null;
  return { decision: decisionVista(r), contexto: await contextoDe(r.contexto_id, r.recibida_en), propuestaId: r.propuesta_id };
}

/** S5 (REQ-24, REQ-29): una decisión recibida, válida o no, con su contexto y, si es una entrada evitada, su resultado hipotético. */
export async function detalleDecision(id: string, ahora: Date = new Date()): Promise<DetalleDecision | null> {
  fallaInyectada("detalleDecision");
  const base = await decisionConContexto(id);
  if (!base) return null;
  const evitada = base.decision.valida && base.decision.decision === "no_comprar";
  return { ...base, hipotetico: evitada ? await hipoteticoDe({ decisionId: id }, ahora) : null };
}

// ───────────────────────────── Ranuras (REQ-26 a REQ-28) ─────────────────────────────

type FilaEnvio = {
  id: string;
  ranura: Marca;
  activo: Activo | null;
  valida: boolean;
  decision: "comprar" | "no_comprar" | null;
  estado: "aceptada" | "rechazada";
  motivo: string | null;
  version_instrucciones: string | null;
  propuesta_id: string | null;
  propuesta_decision: Decision | null;
  regla_principal: string | null;
};

/** El resultado de un activo en una ranura, a partir de sus envíos en orden: la válida si hay, si no la última inválida. */
function resultadoActivo(envios: FilaEnvio[]): ResultadoDecisorActivo {
  const v = envios.find((e) => e.valida);
  if (v) {
    if (v.decision === "no_comprar") return { tipo: "no_comprar", decisionId: v.id };
    if (v.motivo === "datos_no_disponibles") return { tipo: "comprar_rechazada", decisionId: v.id, motivo: "datos_no_disponibles" };
    return {
      tipo: "comprar",
      decisionId: v.id,
      propuesta: v.propuesta_id
        ? {
            id: v.propuesta_id,
            decision: v.propuesta_decision as Decision,
            ...(v.propuesta_decision === "rechazada" && v.regla_principal ? { reglaPrincipal: v.regla_principal } : {}),
          }
        : null,
    };
  }
  const ultima = envios[envios.length - 1];
  return ultima ? { tipo: "invalida", decisionId: ultima.id, motivo: ultima.motivo ?? "desconocido" } : { tipo: "sin_decision" };
}

/**
 * Las ranuras del decisor desde su activación (o las de `rango`), las más recientes primero. Las terminadas salen de
 * `ranuras_decisor` (las cierra `seguimiento` cada 5 min); una con envíos que aún no se cierra, o la que sigue en curso,
 * se calcula con la misma regla. Una ranura sin envíos que no ha terminado no se lista (O-UX-4).
 */
async function cargarRanuras(ahora: Date, rango: { desde?: Date; hasta?: Date } = {}): Promise<FilaRanura[]> {
  const activacion = await activacionDecisor(obtenerDb());
  if (!activacion) return [];
  const desde = Math.max(ranuraDecisor(activacion).getTime(), rango.desde?.getTime() ?? 0);
  const hasta = Math.min(ranuraDecisor(ahora).getTime(), rango.hasta?.getTime() ?? Infinity);
  if (desde > hasta) return [];
  const [d, h] = [new Date(desde).toISOString(), new Date(hasta).toISOString()];

  const [cerradas, envios, eventos] = await Promise.all([
    filas<{ ranura: Marca; estado: EstadoRanura }>(
      sql`SELECT ranura, estado FROM ranuras_decisor WHERE ranura >= ${d}::timestamptz AND ranura <= ${h}::timestamptz`,
    ),
    filas<FilaEnvio>(
      sql`SELECT d.id, d.ranura, d.activo, d.valida, d.decision, d.estado, d.motivo, d.version_instrucciones,
          p.id AS propuesta_id, p.decision AS propuesta_decision, p.reglas_incumplidas[1] AS regla_principal
          FROM decisiones d LEFT JOIN propuestas p ON p.decision_id = d.id AND p.es_original
          WHERE d.ranura >= ${d}::timestamptz AND d.ranura <= ${h}::timestamptz
          ORDER BY d.recibida_en, d.id`,
    ),
    eventosDeModos(),
  ]);

  const estadoCerrado = new Map(cerradas.map((c) => [fecha(c.ranura).getTime(), c.estado]));
  const porRanura = new Map<number, FilaEnvio[]>();
  for (const e of envios) {
    const t = fecha(e.ranura).getTime();
    porRanura.set(t, [...(porRanura.get(t) ?? []), e]);
  }

  const tiempos = [...new Set([...estadoCerrado.keys(), ...porRanura.keys()])].sort((a, b) => b - a);
  return tiempos.map((t) => {
    const propios = porRanura.get(t) ?? [];
    const fin = t + HORA_MS;
    const modo = modoDecisorEn(eventos, new Date(Math.min(fin, ahora.getTime())));
    const porActivo = Object.fromEntries(
      ACTIVOS.map((a) => [a, resultadoActivo(propios.filter((e) => e.activo === a))]),
    ) as Record<Activo, ResultadoDecisorActivo>;
    const validas = ACTIVOS.filter((a) => propios.some((e) => e.activo === a && e.valida)).length;
    const calculado: EstadoRanura =
      validas === 2 ? "completa" : validas === 1 ? "parcial" : modo === null || modo === "apagado" ? "apagado" : "invalida";
    return {
      ranura: new Date(t).toISOString(),
      fin: new Date(fin).toISOString(),
      estado: estadoCerrado.get(t) ?? calculado,
      enCurso: fin > ahora.getTime(),
      modo,
      versionInstrucciones: (propios.find((e) => e.valida) ?? propios.find((e) => e.version_instrucciones))?.version_instrucciones ?? null,
      porActivo,
    };
  });
}

/** La ranura más reciente que se lista (REQ-27), o `null` si el decisor nunca se activó o no hay ninguna. */
export async function ultimaRanura(ahora: Date): Promise<FilaRanura | null> {
  const [{ r }] = await filas<{ r: Marca | null }>(
    sql`SELECT max(r) AS r FROM (SELECT max(ranura) AS r FROM ranuras_decisor UNION ALL SELECT max(ranura) FROM decisiones) x`,
  );
  if (!r) return null;
  const t = fecha(r);
  return (await cargarRanuras(ahora, { desde: t, hasta: t }))[0] ?? null;
}

/** Ranuras completas sobre las terminadas de la ventana, sin las apagadas (REQ-28). `pct` entero como texto; `null` sin casos. */
export function porcentajeRanuras(ranuras: readonly FilaRanura[], ahora: Date, ventanaMs: number): PorcentajeRanuras {
  const de = ranuras.filter(
    (r) => !r.enCurso && r.estado !== "apagado" && Date.parse(r.fin) > ahora.getTime() - ventanaMs && Date.parse(r.fin) <= ahora.getTime(),
  );
  const completas = de.filter((r) => r.estado === "completa").length;
  return { completas, total: de.length, pct: de.length === 0 ? null : String(Math.round((completas * 100) / de.length)) };
}

/** Cursor de S5 Decisor: `a:<ranura>` = más antiguas que esa ranura, `d:<ranura>` = más recientes. */
function leerCursorRanura(c: string | undefined): { modo: "a" | "d"; t: number } | null {
  const m = /^([ad]):(.+)$/.exec(c ?? "");
  const t = m ? Date.parse(m[2]) : NaN;
  return m && !Number.isNaN(t) ? { modo: m[1] as "a" | "d", t } : null;
}

/** S5 Decisor (REQ-28): ranuras de la más reciente a la más antigua, 50 por página. El filtro de activo acota el de resultado. */
export async function listarRanuras(
  f: FiltroRanuras,
  ahora: Date,
): Promise<Pagina<FilaRanura> & { h24: PorcentajeRanuras; d7: PorcentajeRanuras }> {
  fallaInyectada("listarRanuras");
  const todas = await cargarRanuras(ahora);
  const cuales: readonly Activo[] = f.activo ? [f.activo] : ACTIVOS;
  const filtradas = todas.filter(
    (r) => (!f.estado || r.estado === f.estado) && (!f.resultado || cuales.some((a) => r.porActivo[a].tipo === f.resultado)),
  );

  const cursor = leerCursorRanura(f.antes);
  let pagina: FilaRanura[];
  let hayMas: boolean;
  if (cursor?.modo === "d") {
    const mas = filtradas.filter((r) => Date.parse(r.ranura) > cursor.t);
    hayMas = mas.length > POR_PAGINA;
    pagina = mas.slice(-POR_PAGINA);
  } else {
    const menos = cursor ? filtradas.filter((r) => Date.parse(r.ranura) < cursor.t) : filtradas;
    hayMas = menos.length > POR_PAGINA;
    pagina = menos.slice(0, POR_PAGINA);
  }
  const primera = pagina[0]?.ranura;
  const ultima = pagina[pagina.length - 1]?.ranura;
  const [siguiente, anterior] =
    pagina.length === 0
      ? [null, null]
      : cursor?.modo === "d"
        ? [`a:${ultima}`, hayMas ? `d:${primera}` : null]
        : [hayMas ? `a:${ultima}` : null, cursor ? `d:${primera}` : null];

  return {
    filas: pagina,
    total: filtradas.length,
    siguiente,
    anterior,
    h24: porcentajeRanuras(todas, ahora, 24 * HORA_MS),
    d7: porcentajeRanuras(todas, ahora, 7 * 24 * HORA_MS),
  };
}

/** REQ-27: por activo, sin decisión válida en más de 2 h (o ninguna desde la activación). Vacío con el decisor apagado o sin activar. */
export async function alertasDecisor(
  ahora: Date,
  activacion: Date | null,
  efectivo: Modo | null,
): Promise<{ activo: Activo; desde: string | null; ultimaValida: string | null; severidad: "neg" | "warn" }[]> {
  if (!activacion || efectivo === null || efectivo === "apagado") return [];
  const ultimas = await filas<{ activo: Activo; ultima: Marca }>(
    sql`SELECT activo, max(recibida_en) AS ultima FROM decisiones WHERE valida GROUP BY activo`,
  );
  const severidad = efectivo === "ejecuta" ? "neg" : "warn";
  const alertas: Awaited<ReturnType<typeof alertasDecisor>> = [];
  for (const activo of ACTIVOS) {
    const u = ultimas.find((x) => x.activo === activo);
    if (!u) alertas.push({ activo, desde: null, ultimaValida: null, severidad });
    else if (ahora.getTime() - fecha(u.ultima).getTime() > 2 * HORA_MS)
      alertas.push({ activo, desde: iso(u.ultima), ultimaValida: iso(u.ultima), severidad });
  }
  return alertas;
}
