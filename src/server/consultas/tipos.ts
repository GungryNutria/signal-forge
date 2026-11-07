import type { Activo } from "@/core/activos";

// Contrato del read model del dashboard (plan.md §Contratos). Importes y cantidades como string decimal;
// fechas como ISO UTC. Solo tipos: sin `server-only`.

export type { Activo };
export type Decision = "ejecutada" | "rechazada" | "conflicto" | "error";
export type ResultadoEvaluacion = "sin_senal" | "propuesta" | "datos_no_disponibles" | "error";
export type EstadoEjecucion = "completada" | "error" | "omitida_solapamiento" | "en_curso";
export type EstadoOperacion =
  | "pendiente_llenado"
  | "abierta"
  | "cerrada_tp"
  | "cerrada_sl"
  | "desconocido"
  | "rechazada_broker";

export type ResultadoActivo = { resultado: ResultadoEvaluacion; decision?: Decision; propuestaId?: string };
/** `null`: el activo no tiene evaluación (ejecución omitida o todavía en curso). */
export type PorActivo = Record<Activo, ResultadoActivo | null>;

export type InvestigacionVista = {
  id: string;
  recibidaEn: string;
  /** Minutos enteros entre su recepción y la referencia (ahora, o `evaluada_en` si va adjunta). */
  antiguedadMin: number;
  /** Menos de 60 min respecto a la referencia. */
  vigente: boolean;
  /** Más de 120 min respecto a la referencia. */
  alerta: boolean;
  sentimiento: string;
  noticiaFuerte: boolean;
  confianza: string;
  resumen: string;
  fuentes: string[];
  versionInstrucciones: string;
};

export type EstadoSistema = {
  /** `pausa_manual` gana si ambas pausas están activas; `pausaAutomatica` se rellena igual. */
  modo: "operando" | "pausa_manual" | "pausa_automatica";
  pausaAutomatica: null | {
    pnlDiaUsd: string;
    pnlDiaPct: string;
    limiteUsd: string;
    limitePct: "-3";
    seLevantaEn: string;
  };
  ultimaEjecucion: null | {
    id: string;
    inicio: string;
    fin: string | null;
    estado: EstadoEjecucion;
    versionRegla: string;
    porActivo: PorActivo;
  };
  /** Inicio de la última ejecución con más de 45 min (REQ-44); null si no hay ejecuciones. */
  cicloDetenido: null | { desde: string };
  /** `null` = ninguna aceptada (también es alerta). */
  investigacionPorActivo: Record<
    Activo,
    null | { recibidaEn: string; antiguedadMin: number; vigente: boolean; alerta: boolean }
  >;
  /** `leidoEn`: la lectura más vieja de `lecturas_mercado` (null si nunca hubo). Sin lecturas ni errores, `ok` es true. */
  broker: { ok: boolean; leidoEn: string | null; desactualizado: boolean };
  /** `propuestaId` es null en una orden de salida. */
  ordenesDesconocidas: { activo: string; ordenId: string; propuestaId: string | null }[];
  proximaEjecucion: string;
  proximaInvestigacion: string;
  /** La lectura más reciente de `lecturas_mercado`; null si nunca hubo. */
  horaDatos: string | null;
};

export type LoteAbierto = {
  loteId: string;
  propuestaId: string;
  activo: string;
  abiertoEn: string;
  nocionalEntradaUsd: string;
  /** `cantidad_neta` (la que se vende). */
  cantidad: string;
  precioEntrada: string;
  stopLoss: string;
  takeProfit: string;
  /** null si no hay un bid fresco (REQ-6). */
  precioActual: string | null;
  pnlNoRealizadoUsd: string | null;
};

export type ResumenCartera = {
  saldoVirtualUsd: string;
  /** null si algún lote abierto no tiene bid fresco. */
  valorCarteraUsd: string | null;
  pnlDiaUsd: string | null;
  pnlNoRealizadoUsd: string | null;
  /** Realizado acumulado (suma de `cierres_lote`). */
  pnlAcumuladoUsd: string;
  lotesAbiertos: LoteAbierto[];
  /** true si nunca se ha registrado una ejecución. */
  vacio: boolean;
};

export type ReglaPrincipal = { regla: string; observado: string; limite: string };

export type FiltroPropuestas = {
  activo?: Activo;
  decision?: Decision;
  estado?: EstadoOperacion;
  antes?: string;
  limite?: 50;
};
export type FilaPropuesta = {
  id: string;
  recibidaEn: string;
  activo: string | null;
  lado: string | null;
  nocionalUsd: string | null;
  cantidad: string | null;
  decision: Decision;
  motivo: string;
  /** Solo en propuestas ejecutadas. */
  estado: EstadoOperacion | null;
  /** PnL neto del lote cerrado. */
  pnlUsd: string | null;
  reglaPrincipal: ReglaPrincipal | null;
  masReglas: number;
};
export type Pagina<F> = { filas: F[]; total: number; siguiente: string | null; anterior: string | null };

export type ReglaDetalle = {
  regla: string;
  estado: "cumple" | "incumple" | "no_aplica";
  observado: string;
  limite: string;
};
export type EventoOrdenVista = {
  momento: string;
  estado: string;
  cantidadLlenada: string | null;
  precioMedio: string | null;
  detalle: string | null;
};
export type OrdenVista = {
  id: string;
  tramo: "entrada" | "salida";
  clientOrderId: string;
  /** Último evento. */
  estado: string | null;
  /** Respuesta cruda del broker en el último evento que la trae. */
  respuestaBroker: unknown;
  eventos: EventoOrdenVista[];
};
export type DetallePropuesta = {
  id: string;
  recibidaEn: string;
  activo: string | null;
  lado: string | null;
  nocionalUsd: string | null;
  cantidad: string | null;
  tipoOrden: string | null;
  decision: Decision;
  motivo: string;
  estado: EstadoOperacion | null;
  proponente: string | null;
  claveIdempotencia: string | null;
  versionRegla: string | null;
  /** `justificacion` de la regla: `{ entradas, resultado }`. */
  reglaEntrada: unknown;
  /** R1 a R10, las incumplidas primero. Vacío si la propuesta fue inválida. */
  reglas: ReglaDetalle[];
  /** Órdenes de la propuesta (entrada y salida). Vacío = nunca llegó al broker. */
  ordenes: OrdenVista[];
  lote: null | {
    id: string;
    abiertoEn: string;
    precioEntrada: string;
    cantidadNeta: string;
    stopLoss: string;
    takeProfit: string;
    comisionBps: number;
  };
  etiqueta: {
    estado: "pendiente" | "cerrada" | "no_aplica";
    exito: 0 | 1 | null;
    motivoCierre: "take_profit" | "stop_loss" | null;
    cerradoEn: string | null;
    precioSalida: string | null;
    pnlNetoUsd: string | null;
    pnlNetoPct: string | null;
    duracionMin: number | null;
  };
  ejecucion: null | { id: string; ranura: string; inicio: string; versionRegla: string };
  evaluacionId: string | null;
  /** La adjunta a la evaluación; `antiguedadMin` respecto a `evaluada_en`. Null = "Sin investigación". */
  investigacion: InvestigacionVista | null;
};

export type ResultadoFiltroEjecuciones = ResultadoEvaluacion | "omitida_solapamiento";
export type FiltroEjecuciones = {
  activo?: Activo;
  resultado?: ResultadoFiltroEjecuciones;
  antes?: string;
  limite?: 50;
};
export type FilaEjecucion = {
  id: string;
  ranura: string;
  inicio: string;
  fin: string | null;
  estado: EstadoEjecucion;
  versionRegla: string;
  error: string | null;
  porActivo: PorActivo;
};
export type DetalleEvaluacion = {
  ejecucion: {
    id: string;
    ranura: string;
    inicio: string;
    fin: string | null;
    estado: EstadoEjecucion;
    versionRegla: string;
  };
  evaluacion: {
    id: string;
    activo: Activo;
    evaluadaEn: string;
    resultado: ResultadoEvaluacion;
    versionRegla: string;
    errorDetalle: string | null;
  };
  /** `foto.regla`: `{ version, entradas, resultado }` (version null si no hubo datos para evaluarla). */
  regla: unknown;
  /** `foto-v1` completa. */
  foto: unknown;
  propuesta: null | { id: string; decision: Decision };
  investigacion: InvestigacionVista | null;
};

export type Metricas = {
  /** Cartera global (no cambia con el filtro de activo). */
  curvaSaldo: { t: string; saldoUsd: string }[];
  /** Global. null = sin cierres. `desde`/`hasta` null si la curva nunca cayó bajo su pico (pct "0.00"). */
  drawdownMax: null | { pct: string; desde: string | null; hasta: string | null };
  /** Por día UTC, ascendente. */
  pnlDiario: { diaUtc: string; pnlUsd: string }[];
  pnlAcumuladoUsd: string;
  /** `pct` con un decimal. null = 0 entradas cerradas. */
  tasaAciertos: null | { pct: string; aciertos: number; cerradas: number };
  /** Rechazadas agrupadas por la primera regla incumplida o, si no hubo reglas, por el motivo. */
  porMotivo: { motivo: string; n: number }[];
  aprobadas: number;
  rechazadas: number;
};

// ───────────────────────────── S6 Precio (spec 002) ─────────────────────────────

export const RANGOS = ["24h", "7d", "30d", "todo"] as const;
export type Rango = (typeof RANGOS)[number];
/** Duración de cada rango en ms; `todo` no tiene límite. */
export const RANGO_MS: Record<Rango, number | null> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  todo: null,
};

export type PuntoPrecio = {
  evaluacionId: string;
  /** Cierre de la vela (= ts_ultima_barra + 30 min). Es la x del punto (Q-10). */
  t: string;
  /** Inicio de la vela (ts_ultima_barra). */
  inicioVela: string;
  cierre: string; // foto.regla.resultado.close_ultimo
  sma20: string; // foto.regla.resultado.sma20
  cierrePrevio: string; // foto.regla.resultado.close_previo
  resultado: "sin_senal" | "propuesta";
  /** true si el punto anterior de la lista no está exactamente 30 min antes (REQ-4). */
  hueco: boolean;
};

export type SeriePrecio = {
  activo: Activo;
  rango: Rango;
  /** ahora − rango; null en "todo". */
  desde: string | null;
  hasta: string;
  /** Cierre de vela del primer y del último punto del activo en TODA la historia; null si no hay ninguno. */
  primerPunto: string | null;
  ultimoPunto: string | null;
  /** En el rango, deduplicados por vela y en orden ascendente. */
  puntos: PuntoPrecio[];
};

export type OperacionGrafica = {
  propuestaId: string;
  /** #n entre las abiertas del activo (1 = la más antigua); null si está cerrada. */
  numero: number | null;
  entrada: {
    t: string; // lotes.abierto_en
    precio: string;
    nocionalUsd: string;
    cantidad: string;
    /** null si la propuesta no es de la regla y no trae sus valores (R-3): la UI muestra "—". */
    cierre: string | null;
    cierrePrevio: string | null;
    sma20: string | null; // propuestas.justificacion.resultado
    enRango: boolean;
  };
  salida: null | {
    t: string; // cierres_lote.cerrado_en
    precio: string;
    motivo: "take_profit" | "stop_loss";
    /** stop_loss o take_profit del lote, según el motivo. */
    nivel: string;
    pnlNetoUsd: string;
    pnlNetoPct: string;
    duracionS: number;
    enRango: boolean;
  };
  /** Solo si sigue abierta (REQ-13, REQ-15). */
  niveles: null | { stopLoss: string; takeProfit: string };
};

export type OperacionesPrecio = {
  /** Orden ascendente por entrada. */
  filas: OperacionGrafica[];
  /** Para el selector (REQ-16, Q-4). */
  abiertasPorActivo: Record<Activo, number>;
};
