import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Todo timestamptz es UTC y lo fija el servidor (now()), salvo fuente_ts.
// Importes USD numeric(18,2); cantidades y precios numeric(28,10).
const ts = (nombre: string) => timestamp(nombre, { withTimezone: true });
const usd = (nombre: string) => numeric(nombre, { precision: 18, scale: 2 });
const cant = (nombre: string) => numeric(nombre, { precision: 28, scale: 10 });

const ACTIVOS = sql`('BTC/USD','SOL/USD')`;

// Las tablas de registro (todas menos lecturas_mercado) son append-only: los triggers
// sf_prohibir_cambios (migración custom) impiden UPDATE, DELETE y TRUNCATE.

export const ejecuciones = pgTable(
  "ejecuciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ranura: ts("ranura").notNull(),
    inicio: ts("inicio").notNull().defaultNow(),
    versionRegla: text("version_regla").notNull(),
  },
  (t) => [index("ejecuciones_inicio_idx").on(t.inicio.desc(), t.id.desc())],
);

export const ejecucionesCierre = pgTable(
  "ejecuciones_cierre",
  {
    ejecucionId: uuid("ejecucion_id")
      .primaryKey()
      .references(() => ejecuciones.id),
    fin: ts("fin").notNull().defaultNow(),
    estado: text("estado").notNull(),
    error: text("error"),
  },
  (t) => [
    check(
      "ejecuciones_cierre_estado_ck",
      sql`${t.estado} IN ('completada','error','omitida_solapamiento')`,
    ),
  ],
);

export const evaluaciones = pgTable(
  "evaluaciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ejecucionId: uuid("ejecucion_id")
      .notNull()
      .references(() => ejecuciones.id),
    activo: text("activo").notNull(),
    evaluadaEn: ts("evaluada_en").notNull().defaultNow(),
    resultado: text("resultado").notNull(),
    versionRegla: text("version_regla").notNull(),
    foto: jsonb("foto").notNull(),
    investigacionId: uuid("investigacion_id").references(() => investigaciones.id),
    errorDetalle: text("error_detalle"),
  },
  (t) => [
    uniqueIndex("evaluaciones_ejecucion_activo_uq").on(t.ejecucionId, t.activo),
    check("evaluaciones_activo_ck", sql`${t.activo} IN ${ACTIVOS}`),
    check(
      "evaluaciones_resultado_ck",
      sql`${t.resultado} IN ('sin_senal','propuesta','datos_no_disponibles','error')`,
    ),
    index("evaluaciones_activo_evaluada_idx").on(t.activo, t.evaluadaEn.desc()),
    index("evaluaciones_resultado_idx").on(t.resultado),
  ],
);

export const propuestas = pgTable(
  "propuestas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claveIdempotencia: text("clave_idempotencia"),
    huellaContenido: char("huella_contenido", { length: 64 }),
    esOriginal: boolean("es_original").notNull(),
    proponente: text("proponente"),
    ejecucionId: uuid("ejecucion_id"),
    evaluacionId: uuid("evaluacion_id").references(() => evaluaciones.id),
    versionRegla: text("version_regla"),
    activo: text("activo"),
    lado: text("lado"),
    nocionalUsd: usd("nocional_usd"),
    cantidad: cant("cantidad"),
    tipoOrden: text("tipo_orden"),
    justificacion: jsonb("justificacion"),
    entradaCruda: jsonb("entrada_cruda").notNull(),
    recibidaEn: ts("recibida_en").notNull().defaultNow(),
    reglas: jsonb("reglas"),
    reglasIncumplidas: text("reglas_incumplidas").array().notNull().default(sql`'{}'`),
    decision: text("decision").notNull(),
    motivo: text("motivo").notNull(),
  },
  (t) => [
    uniqueIndex("propuestas_clave_original_uq")
      .on(t.claveIdempotencia)
      .where(sql`${t.esOriginal}`),
    check(
      "propuestas_decision_ck",
      sql`${t.decision} IN ('ejecutada','rechazada','conflicto','error')`,
    ),
    index("propuestas_recibida_idx").on(t.recibidaEn.desc(), t.id.desc()),
    index("propuestas_activo_recibida_idx").on(t.activo, t.recibidaEn.desc()),
    index("propuestas_decision_idx").on(t.decision),
    index("propuestas_ejecucion_activo_idx").on(t.ejecucionId, t.activo),
  ],
);

export const ordenes = pgTable(
  "ordenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propuestaId: uuid("propuesta_id").references(() => propuestas.id),
    loteId: uuid("lote_id").references((): AnyPgColumn => lotes.id),
    tramo: text("tramo").notNull(),
    clientOrderId: text("client_order_id").notNull().unique(),
    activo: text("activo").notNull(),
    lado: text("lado").notNull(),
    nocionalUsd: usd("nocional_usd"),
    cantidad: cant("cantidad"),
    creadaEn: ts("creada_en").notNull().defaultNow(),
    // REQ-13: solo en las salidas del vigilante, el bid que disparó el nivel y la hora de su quote. Nulas en las demás.
    precioDisparo: cant("precio_disparo"),
    precioDisparoTs: ts("precio_disparo_ts"),
  },
  (t) => [
    check("ordenes_tramo_ck", sql`${t.tramo} IN ('entrada','salida')`),
    check("ordenes_client_order_id_len_ck", sql`length(${t.clientOrderId}) <= 128`),
  ],
);

export const eventosOrden = pgTable(
  "eventos_orden",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ordenId: uuid("orden_id")
      .notNull()
      .references(() => ordenes.id),
    momento: ts("momento").notNull().defaultNow(),
    estado: text("estado").notNull(),
    cantidadLlenada: cant("cantidad_llenada"),
    precioMedio: cant("precio_medio"),
    brokerOrderId: text("broker_order_id"),
    respuesta: jsonb("respuesta"),
    detalle: text("detalle"),
  },
  (t) => [
    check(
      "eventos_orden_estado_ck",
      sql`${t.estado} IN ('pendiente_envio','enviada','aceptada','parcial','llenada','cancelada','rechazada','desconocido','no_enviada')`,
    ),
    index("eventos_orden_orden_momento_idx").on(t.ordenId, t.momento.desc(), t.id.desc()),
  ],
);

export const lotes = pgTable(
  "lotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propuestaId: uuid("propuesta_id")
      .notNull()
      .unique()
      .references(() => propuestas.id),
    ordenEntradaId: uuid("orden_entrada_id")
      .notNull()
      .unique()
      .references((): AnyPgColumn => ordenes.id),
    activo: text("activo").notNull(),
    abiertoEn: ts("abierto_en").notNull().defaultNow(),
    precioEntrada: cant("precio_entrada").notNull(),
    cantidadLlenada: cant("cantidad_llenada").notNull(),
    cantidadNeta: cant("cantidad_neta").notNull(),
    nocionalEntradaUsd: usd("nocional_entrada_usd").notNull(),
    comisionBps: integer("comision_bps").notNull(),
    stopLoss: cant("stop_loss").notNull(),
    takeProfit: cant("take_profit").notNull(),
  },
  (t) => [index("lotes_activo_idx").on(t.activo)],
);

export const cierresLote = pgTable(
  "cierres_lote",
  {
    loteId: uuid("lote_id")
      .primaryKey()
      .references(() => lotes.id),
    ordenSalidaId: uuid("orden_salida_id")
      .notNull()
      .unique()
      .references(() => ordenes.id),
    cerradoEn: ts("cerrado_en").notNull().defaultNow(),
    precioSalida: cant("precio_salida").notNull(),
    motivoCierre: text("motivo_cierre").notNull(),
    pnlNetoUsd: usd("pnl_neto_usd").notNull(),
    pnlNetoPct: numeric("pnl_neto_pct", { precision: 10, scale: 6 }).notNull(),
    duracionS: integer("duracion_s").notNull(),
    etiquetaExito: smallint("etiqueta_exito").notNull(),
  },
  (t) => [
    check("cierres_lote_motivo_ck", sql`${t.motivoCierre} IN ('take_profit','stop_loss')`),
    check("cierres_lote_etiqueta_ck", sql`${t.etiquetaExito} IN (0,1)`),
    index("cierres_lote_cerrado_idx").on(t.cerradoEn),
  ],
);

export const investigaciones = pgTable(
  "investigaciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recibidaEn: ts("recibida_en").notNull().defaultNow(),
    estado: text("estado").notNull(),
    motivo: text("motivo"),
    motivos: jsonb("motivos"),
    claveIdempotencia: text("clave_idempotencia"),
    huellaContenido: char("huella_contenido", { length: 64 }),
    ejecucionInvestigador: text("ejecucion_investigador"),
    versionInstrucciones: text("version_instrucciones"),
    activo: text("activo"),
    sentimiento: numeric("sentimiento", { precision: 4, scale: 3 }),
    noticiaFuerte: boolean("noticia_fuerte"),
    confianza: numeric("confianza", { precision: 4, scale: 3 }),
    resumen: text("resumen"),
    fuentes: text("fuentes").array(),
    cuerpoCrudo: text("cuerpo_crudo"),
  },
  (t) => [
    uniqueIndex("investigaciones_clave_aceptada_uq")
      .on(t.claveIdempotencia)
      .where(sql`${t.estado} = 'aceptada'`),
    check("investigaciones_estado_ck", sql`${t.estado} IN ('aceptada','rechazada')`),
    // Una investigación aceptada tiene todos sus campos y en rango (REQ-38, REQ-39).
    check(
      "investigaciones_aceptada_ck",
      sql`${t.estado} <> 'aceptada' OR (
        ${t.claveIdempotencia} IS NOT NULL AND ${t.huellaContenido} IS NOT NULL
        AND ${t.ejecucionInvestigador} IS NOT NULL AND ${t.versionInstrucciones} IS NOT NULL
        AND ${t.activo} IN ${ACTIVOS}
        AND ${t.sentimiento} BETWEEN -1 AND 1
        AND ${t.noticiaFuerte} IS NOT NULL
        AND ${t.confianza} BETWEEN 0 AND 1
        AND char_length(${t.resumen}) BETWEEN 1 AND 600
        AND cardinality(${t.fuentes}) BETWEEN 0 AND 10
      )`,
    ),
    index("investigaciones_activo_aceptada_idx")
      .on(t.activo, t.recibidaEn.desc())
      .where(sql`${t.estado} = 'aceptada'`),
    index("investigaciones_recibida_idx").on(t.recibidaEn),
  ],
);

export const eventos = pgTable(
  "eventos",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    momento: ts("momento").notNull().defaultNow(),
    tipo: text("tipo").notNull(),
    activo: text("activo"),
    diaUtc: date("dia_utc", { mode: "string" }),
    detalle: jsonb("detalle").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    check(
      "eventos_tipo_ck",
      sql`${t.tipo} IN ('auth_fallida','pausa_automatica','entorno_no_paper','error_ciclo','error_vigilante')`,
    ),
    uniqueIndex("eventos_pausa_dia_uq")
      .on(t.diaUtc)
      .where(sql`${t.tipo} = 'pausa_automatica'`),
  ],
);

// Caché que se reescribe (upsert); única tabla sin triggers de solo inserción.
// Todo salvo `activo` admite null: el primer intento puede fallar antes de leer un precio
// y aun así debe poder registrar ultimo_error_en (AC-6).
export const lecturasMercado = pgTable("lecturas_mercado", {
  activo: text("activo").primaryKey(),
  bid: cant("bid"),
  ask: cant("ask"),
  ultimo: cant("ultimo"),
  fuenteTs: ts("fuente_ts"),
  leidoEn: ts("leido_en"),
  ultimoErrorEn: ts("ultimo_error_en"),
  ultimoError: text("ultimo_error"),
});
