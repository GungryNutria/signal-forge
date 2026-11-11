// Formato es-MX del tablero (AC-UX-22, AC-UX-23). Las horas se muestran en America/Monterrey (Torreón) con la zona
// visible; el detalle agrega además la hora UTC. Todas las funciones reciben los strings ISO / decimales del read model.

const ZONA = "America/Monterrey";
const MENOS = "−"; // signo menos tipográfico
const NBSP = " ";

const horaMin = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const horaSeg = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const diaMes = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, day: "numeric", month: "short" });
const horaUtc = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const offset = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, timeZoneName: "shortOffset" });

/** `UTC−6`: la zona de Torreón en ese instante ("GMT-6" en Intl). */
export function zona(d: Date): string {
  const nombre = offset.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return nombre.replace("GMT", "UTC").replace("-", MENOS);
}

/** `14:30`: solo la hora, para columnas cuyo encabezado ya dice la zona. */
export const horaCorta = (iso: string): string => horaMin.format(new Date(iso));
/** `14:30 (UTC−6)`. */
export const hora = (iso: string): string => `${horaMin.format(new Date(iso))} (${zona(new Date(iso))})`;
/** `14:42:05 (UTC−6)`. */
export const horaConSegundos = (iso: string): string => `${horaSeg.format(new Date(iso))} (${zona(new Date(iso))})`;
/** `20:42 UTC`, para el detalle. */
export const enUtc = (iso: string): string => `${horaUtc.format(new Date(iso))} UTC`;
/** `6 nov`. */
export const dia = (iso: string): string => diaMes.format(new Date(iso)).replace(/\./g, "");

/** `hace 12 min`, `hace 2 h 1 min`. */
export function relativo(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos));
  if (m < 1) return "hace menos de 1 min";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto === 0 ? `hace ${h} h` : `hace ${h} h ${resto} min`;
}

export const minutosDesde = (iso: string, ahora: Date): number => Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60_000);

function numero(valor: number, min: number, max: number): string {
  return new Intl.NumberFormat("es-MX", { minimumFractionDigits: min, maximumFractionDigits: max }).format(valor);
}

const esCero = (n: number, decimales: number) => Number(Math.abs(n).toFixed(decimales)) === 0;

/** `10,184.20 USD` (sin signo; si es negativo lleva el signo menos). */
export function usd(valor: string | number): string {
  const n = Number(valor);
  return `${n < 0 && !esCero(n, 2) ? MENOS : ""}${numero(Math.abs(n), 2, 2)} USD`;
}

/** `+17.06 USD`, `−312.40 USD`; el cero va sin signo (DESIGN: "Signo antes que color"). */
export function usdConSigno(valor: string | number): string {
  const n = Number(valor);
  return `${esCero(n, 2) ? "" : n < 0 ? MENOS : "+"}${numero(Math.abs(n), 2, 2)} USD`;
}

/** Signo del importe, para elegir el color (solo dinero): -1, 0 o 1. */
export function signo(valor: string | number): -1 | 0 | 1 {
  const n = Number(valor);
  if (esCero(n, 2)) return 0;
  return n < 0 ? -1 : 1;
}

/** `−3.12 %` con espacio (sin corte) antes del signo de porcentaje. */
export function pct(valor: string | number, decimales: number, conSigno = true): string {
  const n = Number(valor);
  const cero = esCero(n, decimales);
  const s = cero ? "" : n < 0 ? MENOS : conSigno ? "+" : "";
  return `${s}${numero(Math.abs(n), decimales, decimales)}${NBSP}%`;
}

/** Cantidad de cripto: hasta 8 decimales sin ceros sobrantes, nunca redondeada a cero. */
export function cripto(valor: string | number, unidadActivo: string): string {
  const n = Number(valor);
  const texto = numero(Math.abs(n), 0, 8);
  const redondeadoACero = n !== 0 && Number(texto.replace(/,/g, "")) === 0;
  return `${n < 0 ? MENOS : ""}${redondeadoACero ? "<0.00000001" : texto} ${unidadActivo}`;
}

/** Sentimiento: `+0.42 en escala −1 a 1`. */
export function sentimiento(valor: string): string {
  const n = Number(valor);
  return `${esCero(n, 2) ? "" : n < 0 ? MENOS : "+"}${numero(Math.abs(n), 2, 2)} en escala ${MENOS}1 a 1`;
}

/** Confianza: `0.80 en escala 0 a 1`. */
export const confianza = (valor: string): string => `${numero(Number(valor), 2, 2)} en escala 0 a 1`;

/** Dominio real de una fuente. Solo http(s) es enlazable; lo demás se muestra como texto. */
export function dominio(url: string): { dominio: string; enlazable: boolean } {
  try {
    const u = new URL(url);
    const enlazable = u.protocol === "http:" || u.protocol === "https:";
    return { dominio: enlazable ? u.hostname : "(no es un enlace http o https)", enlazable };
  } catch {
    return { dominio: "(no es un enlace http o https)", enlazable: false };
  }
}

/** `BTC/USD` → `BTC`. */
export const unidad = (activo: string): string => activo.split("/")[0];

// Reglas de riesgo (REQ-9): nombre corto para "R3 tamaño: 1,001.00 USD > límite 1,000.00 USD".
export const NOMBRE_REGLA: Record<string, string> = {
  R1: "activo",
  R2: "venta",
  R3: "tamaño",
  R4: "exposición",
  R5: "entradas del día",
  R6: "pausa automática",
  R7: "saldo libre",
  R8: "pausa manual",
  R9: "orden desconocida",
  R10: "tipo de orden",
  R11: "entradas abiertas por activo",
};
const SUPERA = new Set(["R3", "R4", "R5", "R7", "R11"]);

/** Nombre corto de la banda y de S5 (AC-UX-5): `R8 pausa manual`, `R11 entradas abiertas`. */
export function nombreCorto(regla: string): string {
  if (regla === "R11") return "R11 entradas abiertas";
  return NOMBRE_REGLA[regla] ? `${regla} ${NOMBRE_REGLA[regla]}` : regla;
}

/** Desglose de R11 en S3 (AC-UX-2): `1 abierta + esta propuesta = 2 · límite 1`. `observado` ya incluye la propuesta. */
export function desgloseR11(observado: string, limite: string): string {
  const abiertas = Number(observado) - 1;
  return `${abiertas} ${abiertas === 1 ? "abierta" : "abiertas"} + esta propuesta = ${observado} · límite ${limite}`;
}

/** Valores monetarios del motor (`1001.00 USD`) con el formato del tablero. */
export const valorRegla = (v: string): string => {
  const m = /^(-?\d+(?:\.\d+)?) USD$/.exec(v);
  return m ? usd(m[1]) : v;
};

/** `R3 tamaño: 1,001.00 USD > límite 1,000.00 USD`; R11 lleva el activo: `R11 entradas abiertas de BTC/USD: 2 > límite 1`. */
export function reglaPrincipal(r: { regla: string; observado: string; limite: string }, activo?: string | null): string {
  const nombre = r.regla === "R11" && activo ? `entradas abiertas de ${activo}` : NOMBRE_REGLA[r.regla];
  const cabeza = nombre ? `${r.regla} ${nombre}` : r.regla;
  const observado = valorRegla(r.observado);
  const limite = valorRegla(r.limite);
  return SUPERA.has(r.regla) ? `${cabeza}: ${observado} > límite ${limite}` : `${cabeza}: ${observado} (límite: ${limite})`;
}

const MOTIVO: Record<string, string> = {
  propuesta_invalida: "Propuesta inválida",
  segunda_propuesta_misma_ejecucion: "Segunda propuesta en la misma ejecución",
  clave_con_otro_contenido: "Clave repetida con otro contenido",
  entorno_no_paper: "El entorno no es paper",
  reglas_incumplidas: "Reglas de riesgo incumplidas",
  venta_no_habilitada: "Venta no habilitada en esta etapa",
  pausado: "Pausado",
  aprobada: "Aprobada",
};
export const motivo = (m: string): string => MOTIVO[m] ?? m;

const diaHoraSeg = new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const diaHoraSegZona = new Intl.DateTimeFormat("es-MX", {
  timeZone: ZONA,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const quitar = (s: string) => s.replace(/\./g, "");

/** `6 nov, 14:30:04 (UTC−6)`: fecha y hora de Torreón con su zona. */
export const momento = (iso: string): string =>
  `${quitar(diaHoraSegZona.format(new Date(iso)))} (${zona(new Date(iso))})`;
/** `6 nov, 20:30:04 UTC`. */
export const momentoUtc = (iso: string): string => `${quitar(diaHoraSeg.format(new Date(iso)))} UTC`;
/** `6 nov, 14:30` (hora de Torreón; el encabezado de la columna dice la zona). */
export const diaYHora = (iso: string): string => `${dia(iso)}, ${horaCorta(iso)}`;
