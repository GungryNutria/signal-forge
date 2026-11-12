import type { Activo } from "@/core/activos";
import type { Modo } from "@/core/modos";

// Contrato del read model del dashboard (plan.md §Contratos). Importes y cantidades como string decimal;
// fechas como ISO UTC. Solo tipos: sin `server-only`.

export type { Activo };
export type Decision = "ejecutada" | "rechazada" | "conflicto" | "error";
export type Proponente = "ciclo" | "decisor";
export type ModoVista = {
  configurado: Modo;
  efectivo: Modo;
  motivo: "dos_proponentes_en_ejecuta" | "r11_no_vigente" | null;
};
export type ResultadoEvaluacion = "sin_senal" | "propuesta" | "datos_no_disponibles" | "error" | "senal_registrada";
export type EstadoEjecucion = "completada" | "error" | "omitida_solapamiento" | "en_curso";
export type EstadoOperacion =
  | "pendiente_llenado"
  | "abierta"
  | "cerrada_tp"
  | "cerrada_sl"
  | "desconocido"
  | "rechazada_broker";

/** REQ-23. `reglaPrincipal` solo en `decision === "rechazada"` con reglas incumplidas: la de número menor (p. ej. "R11"). */
export type ResultadoActivo = {
  resultado: ResultadoEvaluacion;
  decision?: Decision;
  propuestaId?: string;
  reglaPrincipal?: string;
};
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

export type ResultadoDecisorActivo =
  | { tipo: "comprar"; decisionId: string; propuesta: null | { id: string; decision: Decision; reglaPrincipal?: string } } // null = solo registro
  | { tipo: "comprar_rechazada"; decisionId: string; motivo: "datos_no_disponibles" }
  | { tipo: "no_comprar"; decisionId: string }
  | { tipo: "invalida"; decisionId: string; motivo: string } // última no válida de la ranura
  | { tipo: "sin_decision" };
export type EstadoRanura = "completa" | "parcial" | "invalida" | "sin_llegar" | "apagado";

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
  /** `null` = variables de modo inválidas (error del bloque). */
  modos: null | { ciclo: ModoVista; decisor: ModoVista };
  /** Inicio de la última ejecución con más de 45 min (REQ-44); null si no hay ejecuciones. También `null` con el ciclo apagado. */
  cicloDetenido: null | { desde: string; severidad: "neg" | "warn" };
  decisor: {
    /** `null` = nunca activado. */
    activacion: string | null;
    proximaRanura: string;
    ultimaRanura: null | {
      ranura: string;
      fin: string;
      estado: EstadoRanura;
      enCurso: boolean;
      modo: Modo | null;
      porActivo: Record<Activo, ResultadoDecisorActivo>;
    };
    /** REQ-27. Vacío con el decisor apagado. `desde` null = "desde su activación". */
    alertas: { activo: Activo; desde: string | null; ultimaValida: string | null; severidad: "neg" | "warn" }[];
  };
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
  proponente: Proponente;
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
  /** REQ-22. Solo activos con ≥ 1 entrada abierta (REQ-2), en el orden de ACTIVOS. */
  entradasAbiertas: { activo: Activo; n: number }[];
  /** N vigente leído del entorno en este render; `null` si `MAX_ENTRADAS_ABIERTAS_POR_ACTIVO` es inválida. */
  topeEntradasPorActivo: number | null;
};

export type ReglaPrincipal = { regla: string; observado: string; limite: string };

export type FiltroPropuestas = {
  proponente?: Proponente;
  activo?: Activo;
  decision?: Decision;
  estado?: EstadoOperacion;
  antes?: string;
  limite?: 50;
};
export type FilaPropuesta = {
  proponente: Proponente;
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
  estado: "cumple" | "incumple" | "no_aplica" | "no_evaluada";
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
  proponente: Proponente;
  decisor: null | { decision: DecisionVista; contexto: ContextoVista | null };
  claveIdempotencia: string | null;
  versionRegla: string | null;
  /** `justificacion` de la regla: `{ entradas, resultado }`. */
  reglaEntrada: unknown;
  /** Las reglas guardadas, las incumplidas primero. Con "R1-R10" se agrega al final R11 como `no_evaluada`. Vacío si la propuesta fue inválida. */
  reglas: ReglaDetalle[];
  /** Conjunto de reglas con que se evaluó (D-4). `null` si la propuesta no llegó al riesgo (inválida, conflicto, entorno). */
  reglasAplicadas: "R1-R10" | "R1-R11" | null;
  /** REQ-19. Solo si el lote se cerró; `null` en abiertas, pendientes, rechazadas por el broker y desconocidas. */
  salida: null | {
    motivo: "stop_loss" | "take_profit";
    /** REQ-21: PnL si la salida se hubiera llenado exactamente en el nivel. */
    pnlANivelUsd: string;
    pnlANivelPct: string;
    /** Precio del nivel tocado (`stop_loss` o `take_profit` del lote). */
    nivel: string;
    /** Bid que disparó y hora ISO UTC de su quote; `null` = el cierre es anterior a esta medición. */
    precioDisparo: string | null;
    precioDisparoEn: string | null;
    precioLlenado: string;
    movimientoUsd: string;
    movimientoPct: string; // nivel / entrada − 1
    deslizamientoUsd: string;
    deslizamientoPct: string; // llenado / nivel − 1
    comisionUsd: string;
    comisionPct: string; // comisión / nocional de entrada
    pnlNetoUsd: string;
    pnlNetoPct: string;
  };
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
  /** La foto completa (`foto-v2`; las evaluaciones anteriores a la spec 003 traen `foto-v1`). */
  foto: unknown;
  propuesta: null | { id: string; decision: Decision };
  investigacion: InvestigacionVista | null;
  /** Modo del ciclo al evaluar; `null` = anterior a los modos. */
  modo: Modo | null;
  /** Solo en `senal_registrada`. */
  hipotetico: HipoteticoVista | null;
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
  /** Propuestas (con el filtro de activo) que traen R11 en sus `reglas`. 0 → "No evaluada en este periodo". */
  r11Evaluadas: number;
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
    proponente: Proponente;
    /** Confianza de la decisión (REQ-32); `null` en las entradas del ciclo. */
    confianza: string | null;
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

// ───────────────────────────── Decisor (spec 004) ─────────────────────────────

export type FiltroRanuras = {
  activo?: Activo;
  estado?: EstadoRanura;
  resultado?: ResultadoDecisorActivo["tipo"];
  antes?: string;
  limite?: 50;
};
export type FilaRanura = {
  ranura: string;
  fin: string;
  estado: EstadoRanura;
  enCurso: boolean;
  modo: Modo | null;
  versionInstrucciones: string | null;
  porActivo: Record<Activo, ResultadoDecisorActivo>;
  /** Envíos inválidos sin activo (no caben en `porActivo`), en orden de llegada. */
  sinActivo: { decisionId: string; motivo: string }[];
};
/** `total` sin las ranuras "apagado". */
export type PorcentajeRanuras = { completas: number; total: number; pct: string | null };

export type DecisionVista = {
  id: string;
  recibidaEn: string;
  ranura: string;
  activo: Activo | null;
  decision: "comprar" | "no_comprar" | null;
  confianza: string | null;
  razonamiento: string | null;
  versionInstrucciones: string | null;
  ejecucionDecisor: string | null;
  modoEfectivo: Modo | null;
  motivoModo: string | null;
  estado: "aceptada" | "rechazada";
  motivo: string | null;
  motivos: { campo: string; motivo: string }[] | null;
  valida: boolean;
  /** Solo en no válidas. */
  cuerpoCrudo: string | null;
};
/** `contenido` es el `contexto-v1` tal como se guardó. */
export type ContextoVista = { id: string; creadoEn: string; antiguedadAlRecibirMin: number; contenido: unknown };
export type HipoteticoVista =
  | {
      estado: "resuelto";
      resultado: "take_profit" | "stop_loss";
      tocadoEn: string;
      precioEntrada: string;
      pnlANivelUsd: string;
      pnlANivelPct: string;
      huecos: { desde: string; hasta: string }[];
    }
  | { estado: "pendiente"; precioEntrada: string; huecos: { desde: string; hasta: string }[] }
  | { estado: "sin_precio_entrada" };
export type DetalleDecision = {
  decision: DecisionVista;
  contexto: ContextoVista | null;
  hipotetico: HipoteticoVista | null;
  /** Con `propuestaId` la UI va directo a S3 (AC-UX-12). */
  propuestaId: string | null;
};

export type FiltroComparacion = { activo?: Activo; periodo?: "activacion" | "7d" | "30d" };
/** Número de casos de cada cifra. */
export type Caso = { n: number };
/** `null` = "—". */
export type Tasa = null | { pct: string; aciertos: number; cerradas: number };
export type Comparacion = {
  /** Periodo real. */
  activacion: string | null;
  desde: string | null;
  hasta: string;
  topeN: number;
  /** Estado "sin serie de la regla". */
  cicloApagadoDesde: string | null;
  decisor: {
    entradas: number;
    cerradas: number;
    tasa: Tasa;
    pnlANivelUsd: string;
    pnlNetoRealUsd: string;
    evitadas: { total: number; stopLoss: number; takeProfit: number; pendientes: number; sinPrecio: number };
    /** Por regla principal (D-11). */
    rechazadasPorRegla: { regla: string; n: number }[];
  };
  /** Todo hipotético. */
  regla: {
    senales: number;
    cuentan: number;
    bloqueadasPorTope: number;
    cerradas: number;
    tasa: Tasa;
    pnlANivelUsd: string;
    pendientes: number;
  };
  coincidencia: { senalCompro: number; senalNoCompro: number; sinSenalCompro: number; sinSenalNoCompro: number };
};
export type FilaEvitadaORechazada = {
  decisionId: string;
  propuestaId: string | null;
  recibidaEn: string;
  activo: Activo;
  confianza: string;
  primeraLinea: string;
  tipo: "evitada" | "rechazada";
  hipotetico?: HipoteticoVista["estado"] | "take_profit" | "stop_loss";
  reglaPrincipal?: string;
};
