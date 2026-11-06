import "server-only";
import { sql } from "drizzle-orm";
import { ACTIVOS, type Activo } from "@/core/activos";
import { VIGENCIA_MIN } from "@/core/investigacion";
import { fallaInyectada, fecha, filas, iso, type Marca } from "./util";
import type { InvestigacionVista } from "./tipos";

/** Umbral de la alerta de REQ-41: más de 2 horas. */
export const ALERTA_INVESTIGACION_MIN = 120;

export type FilaInvestigacion = {
  id: string;
  recibida_en: Marca;
  sentimiento: string;
  noticia_fuerte: boolean;
  confianza: string;
  resumen: string;
  fuentes: string[];
  version_instrucciones: string;
};

/** Columnas de una investigación aceptada; `i` es el alias de `investigaciones`. */
export const COLUMNAS_INVESTIGACION = sql`i.id, i.recibida_en, i.sentimiento::text AS sentimiento, i.noticia_fuerte,
  i.confianza::text AS confianza, i.resumen, i.fuentes, i.version_instrucciones`;

/** Vigencia y alerta se miden contra `referencia`: ahora en el tablero, `evaluada_en` en lo adjunto a una evaluación. */
export function vistaInvestigacion(r: FilaInvestigacion, referencia: Date): InvestigacionVista {
  const edadMs = Math.max(0, referencia.getTime() - fecha(r.recibida_en).getTime());
  return {
    id: r.id,
    recibidaEn: iso(r.recibida_en),
    antiguedadMin: Math.floor(edadMs / 60_000),
    vigente: edadMs < VIGENCIA_MIN * 60_000,
    alerta: edadMs > ALERTA_INVESTIGACION_MIN * 60_000,
    sentimiento: r.sentimiento,
    noticiaFuerte: r.noticia_fuerte,
    confianza: r.confianza,
    resumen: r.resumen,
    fuentes: r.fuentes,
    versionInstrucciones: r.version_instrucciones,
  };
}

/** La última investigación aceptada de cada activo (REQ-41); `null` si no hay ninguna. */
export async function ultimasAceptadas(ahora: Date): Promise<Record<Activo, InvestigacionVista | null>> {
  const rows = await filas<FilaInvestigacion & { activo: Activo }>(
    sql`SELECT DISTINCT ON (i.activo) i.activo, ${COLUMNAS_INVESTIGACION}
        FROM investigaciones i
        WHERE i.estado = 'aceptada'
        ORDER BY i.activo, i.recibida_en DESC, i.id DESC`,
  );
  const r: Record<Activo, InvestigacionVista | null> = { "BTC/USD": null, "SOL/USD": null };
  for (const fila of rows) if ((ACTIVOS as readonly string[]).includes(fila.activo)) r[fila.activo] = vistaInvestigacion(fila, ahora);
  return r;
}

export async function ultimasInvestigaciones(ahora: Date): Promise<Record<Activo, InvestigacionVista | null>> {
  fallaInyectada("ultimasInvestigaciones");
  return ultimasAceptadas(ahora);
}
