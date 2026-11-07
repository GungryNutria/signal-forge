const MIN = 60_000;
const MEDIA_HORA = 30 * MIN;
const HORA = 60 * MIN;

/** Ranura del ciclo: la hora truncada a 30 min en UTC. */
export function ranura30(d: Date): Date {
  return new Date(Math.floor(d.getTime() / MEDIA_HORA) * MEDIA_HORA);
}

/** Día UTC como `YYYY-MM-DD`. */
export function diaUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function inicioDiaUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 00:00 UTC del día siguiente: cuando se levanta la pausa automática. */
export function inicioDiaSiguienteUtc(d: Date): Date {
  return new Date(inicioDiaUtc(d).getTime() + 24 * HORA);
}

/** Próxima ejecución del ciclo (cada 30 min), estrictamente posterior a `ahora`. */
export function proximaEjecucion(ahora: Date): Date {
  return new Date(ranura30(ahora).getTime() + MEDIA_HORA);
}

/** Próxima investigación (`15 * * * *` UTC), estrictamente posterior a `ahora`. */
export function proximaInvestigacion(ahora: Date): Date {
  const enLaHora = new Date(Math.floor(ahora.getTime() / HORA) * HORA + 15 * MIN);
  return enLaHora.getTime() > ahora.getTime() ? enLaHora : new Date(enLaHora.getTime() + HORA);
}

/** Minutos enteros entre dos momentos (hacia abajo). */
export function minutosEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / MIN);
}
