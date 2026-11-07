import "server-only";
import { sql } from "drizzle-orm";
import { ACTIVOS, type Activo } from "@/core/activos";
import { deCentavos } from "@/core/dinero";
import { diaUtc, inicioDiaSiguienteUtc, proximaEjecucion, proximaInvestigacion } from "@/core/tiempo";
import { esquemaEnv } from "@/server/env";
import { PRECIO_FRESCO_MS, leerBase, pnlDiaConUltimoBid } from "./cartera";
import { ultimasAceptadas } from "./investigaciones";
import type { EstadoEjecucion, EstadoSistema } from "./tipos";
import { fallaInyectada, fecha, filas, iso, type Marca, resultadosPorEjecucion } from "./util";

/** REQ-44: más de 45 min (un intervalo y medio) desde el inicio de la última ejecución. */
export const CICLO_DETENIDO_MS = 45 * 60_000;

export async function estadoSistema(ahora: Date): Promise<EstadoSistema> {
  fallaInyectada("estadoSistema");
  const { TRADING_PAUSADO } = esquemaEnv.pick({ TRADING_PAUSADO: true }).parse(process.env);

  const [ultimas, investigaciones, desconocidas, eventos, base] = await Promise.all([
    filas<{ id: string; inicio: Marca; fin: Marca | null; estado: EstadoEjecucion; version_regla: string }>(
      sql`SELECT id, inicio, fin, estado, version_regla FROM v_ejecuciones ORDER BY inicio DESC, id DESC LIMIT 1`,
    ),
    ultimasAceptadas(ahora),
    filas<{ activo: string; id: string; propuesta_id: string | null }>(
      sql`SELECT activo, id, propuesta_id FROM v_ordenes WHERE estado = 'desconocido' ORDER BY estado_en, id`,
    ),
    filas<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM eventos WHERE tipo = 'pausa_automatica' AND dia_utc = ${diaUtc(ahora)}::date`,
    ),
    leerBase(ahora),
  ]);

  const ult = ultimas[0] ?? null;
  const porActivo = ult ? (await resultadosPorEjecucion([ult])).get(ult.id)! : null;

  const pausaAuto = Number(eventos[0].n) > 0;
  let pausaAutomatica: EstadoSistema["pausaAutomatica"] = null;
  if (pausaAuto) {
    const pnlC = pnlDiaConUltimoBid(base);
    pausaAutomatica = {
      pnlDiaUsd: deCentavos(pnlC),
      pnlDiaPct: base.saldoInicioDiaC > 0 ? ((pnlC / base.saldoInicioDiaC) * 100).toFixed(2) : "0.00",
      limiteUsd: deCentavos(-Math.round((base.saldoInicioDiaC * 3) / 100)),
      limitePct: "-3",
      seLevantaEn: iso(inicioDiaSiguienteUtc(ahora)),
    };
  }

  const investigacionPorActivo = {} as EstadoSistema["investigacionPorActivo"];
  for (const a of ACTIVOS as readonly Activo[]) {
    const i = investigaciones[a];
    investigacionPorActivo[a] = i
      ? { recibidaEn: i.recibidaEn, antiguedadMin: i.antiguedadMin, vigente: i.vigente, alerta: i.alerta }
      : null;
  }

  // Broker (REQ-6): sin ninguna lectura ni error es el estado vacío, no una alerta.
  const leidas = base.lecturas.filter((l) => l.leido_en !== null);
  const masVieja = leidas.length ? Math.min(...leidas.map((l) => fecha(l.leido_en!).getTime())) : null;
  const masNueva = leidas.length ? Math.max(...leidas.map((l) => fecha(l.leido_en!).getTime())) : null;
  const conError = base.lecturas.some(
    (l) => l.ultimo_error_en !== null && (l.leido_en === null || fecha(l.ultimo_error_en).getTime() > fecha(l.leido_en).getTime()),
  );
  const desactualizado = conError || (masVieja !== null && ahora.getTime() - masVieja > PRECIO_FRESCO_MS);

  return {
    modo: TRADING_PAUSADO === "true" ? "pausa_manual" : pausaAuto ? "pausa_automatica" : "operando",
    pausaAutomatica,
    ultimaEjecucion: ult
      ? {
          id: ult.id,
          inicio: iso(ult.inicio),
          fin: ult.fin ? iso(ult.fin) : null,
          estado: ult.estado,
          versionRegla: ult.version_regla,
          porActivo: porActivo!,
        }
      : null,
    cicloDetenido:
      ult && ahora.getTime() - fecha(ult.inicio).getTime() > CICLO_DETENIDO_MS ? { desde: iso(ult.inicio) } : null,
    investigacionPorActivo,
    broker: { ok: !desactualizado, leidoEn: masVieja === null ? null : iso(new Date(masVieja)), desactualizado },
    ordenesDesconocidas: desconocidas.map((o) => ({ activo: o.activo, ordenId: o.id, propuestaId: o.propuesta_id })),
    proximaEjecucion: iso(proximaEjecucion(ahora)),
    proximaInvestigacion: iso(proximaInvestigacion(ahora)),
    horaDatos: masNueva === null ? null : iso(new Date(masNueva)),
  };
}
