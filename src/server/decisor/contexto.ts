import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ACTIVOS, type Activo } from "@/core/activos";
import {
  armarContexto,
  type ContextoV1,
  type EntradaAbierta,
  type EntradaContexto,
  type ProponenteVista,
} from "@/core/contexto";
import type { DatoConTs } from "@/core/foto";
import { motivoSinDatos } from "@/core/mercado";
import { pnlNetoCentavos } from "@/core/pnl";
import { diaUtc } from "@/core/tiempo";
import type { Barra, DatosMercado, Snapshot } from "@/server/broker/tipos";
import { ULTIMO_EVENTO } from "@/server/cartera";
import type { Db } from "@/server/db/cliente";
import { contextosDecisor } from "@/server/db/esquema";
import { exigirLugar } from "./frecuencia";
import { carteraParaFoto } from "@/server/foto";

const MIN = 60_000;
const comoError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

type Fila = Record<string, string | Date | null>;
const filas = async (db: Db, consulta: ReturnType<typeof sql>) => (await db.execute(consulta)).rows as Fila[];
// Drizzle devuelve los timestamptz de `execute` como texto.
const fecha = (v: string | Date | null) => new Date(v as string | Date);
const proponenteDe = (p: unknown): ProponenteVista => (p === "decisor" ? "decisor" : "ciclo");

/**
 * REQ-3 a REQ-6: arma el contexto con datos de mercado leídos ahora, lo guarda tal cual (REQ-4) y lo devuelve.
 * `T` se toma después de leer el mercado, así que todo dato es anterior o igual a `T`.
 */
export async function crearContexto(deps: {
  db: Db;
  datos: DatosMercado;
  ahora: () => Date;
  tokenHuella: string;
  /** TRADING_PAUSADO === "true". */
  pausaManual: boolean;
  /** N de R11 (`leerMaxEntradasAbiertas()`); `null` si es inválida. */
  maxEntradasAbiertasPorActivo: number | null;
}): Promise<ContextoV1> {
  const { db } = deps;
  const inicio = deps.ahora();
  const [snapshots, ...barras] = await Promise.all([
    deps.datos.snapshots(ACTIVOS).catch(comoError),
    ...ACTIVOS.map((a) => deps.datos.barras30m(a, new Date(inicio.getTime() - 25 * 60 * MIN), inicio).catch(comoError)),
  ]);
  const T = deps.ahora();
  const hasta = T.toISOString();
  const desde24h = new Date(T.getTime() - 24 * 60 * MIN).toISOString();

  const snapDe = (a: Activo): Snapshot | undefined =>
    snapshots instanceof Error ? undefined : (snapshots as Partial<Record<Activo, Snapshot>>)[a];
  const bid = Object.fromEntries(ACTIVOS.map((a) => [a, snapDe(a)?.bid ?? null])) as Record<Activo, number | null>;
  const cartera = await carteraParaFoto(db, T, bid);

  // Lotes abiertos y entradas vivas sin lote: el mismo filtro de `entradasAbiertasPorActivo` (R11).
  const lotes = await filas(
    db,
    sql`SELECT l.activo, l.abierto_en, l.precio_entrada::text AS precio, l.stop_loss::text AS sl, l.take_profit::text AS tp,
               round(l.nocional_entrada_usd * 100)::text AS nc, l.cantidad_neta::text AS cn, p.proponente
          FROM lotes l JOIN propuestas p ON p.id = l.propuesta_id
         WHERE NOT EXISTS (SELECT 1 FROM cierres_lote c WHERE c.lote_id = l.id) AND l.abierto_en <= ${hasta}::timestamptz
         ORDER BY l.abierto_en`,
  );
  const pendientes = await filas(
    db,
    sql`SELECT o.activo, o.creada_en, round(o.nocional_usd * 100)::text AS nc, p.proponente
          FROM ordenes o JOIN propuestas p ON p.id = o.propuesta_id
         WHERE o.tramo = 'entrada' AND o.creada_en <= ${hasta}::timestamptz
           AND NOT EXISTS (SELECT 1 FROM lotes l WHERE l.orden_entrada_id = o.id)
           AND ${ULTIMO_EVENTO} IN ('pendiente_envio','enviada','aceptada','parcial','desconocido')
         ORDER BY o.creada_en`,
  );
  const r9 = new Set(
    (await filas(db, sql`SELECT DISTINCT o.activo FROM ordenes o WHERE ${ULTIMO_EVENTO} = 'desconocido'`)).map((f) => f.activo),
  );
  const entradas24h = await filas(
    db,
    sql`SELECT l.activo, l.abierto_en, l.precio_entrada::text AS precio, p.proponente
          FROM lotes l JOIN propuestas p ON p.id = l.propuesta_id
         WHERE l.abierto_en > ${desde24h}::timestamptz AND l.abierto_en <= ${hasta}::timestamptz ORDER BY l.abierto_en`,
  );
  const cierres24h = await filas(
    db,
    sql`SELECT l.activo, c.cerrado_en, c.motivo_cierre, round(c.pnl_neto_usd * 100)::text AS pnl
          FROM cierres_lote c JOIN lotes l ON l.id = c.lote_id
         WHERE c.cerrado_en > ${desde24h}::timestamptz AND c.cerrado_en <= ${hasta}::timestamptz ORDER BY c.cerrado_en`,
  );
  const [{ n: pausaAuto }] = await filas(
    db,
    sql`SELECT count(*)::text AS n FROM eventos WHERE tipo = 'pausa_automatica' AND dia_utc = ${diaUtc(T)}::date`,
  );

  // `carteraParaFoto` cuenta solo lotes; R4 cuenta también las entradas vivas sin lote.
  const exposicionPorActivoC = { ...cartera.exposicionPorActivoC };
  for (const p of pendientes) exposicionPorActivoC[p.activo as Activo] += Number(p.nc);

  const activos = {} as EntradaContexto["activos"];
  ACTIVOS.forEach((activo, i) => {
    const b = barras[i];
    const snap = snapDe(activo);
    const barrasOk: Barra[] = b instanceof Error ? [] : b;
    const cerradas = barrasOk
      .filter((x) => Date.parse(x.t) + 30 * MIN <= T.getTime())
      .sort((x, y) => Date.parse(x.t) - Date.parse(y.t));
    const dato = (valor: number | undefined, ts: Date | undefined): DatoConTs | null =>
      snap && valor !== undefined && ts ? { valor, ts } : null;

    const abiertas: EntradaAbierta[] = [
      ...lotes
        .filter((l) => l.activo === activo)
        .map((l) => ({
          estado: "abierta" as const,
          abiertaEn: fecha(l.abierto_en),
          proponente: proponenteDe(l.proponente),
          precioEntrada: Number(l.precio),
          stopLoss: Number(l.sl),
          takeProfit: Number(l.tp),
          pnlNoRealizadoC: bid[activo] === null ? null : pnlNetoCentavos(Number(l.nc), Number(l.cn), bid[activo]),
        })),
      ...pendientes
        .filter((o) => o.activo === activo)
        .map((o) => ({
          estado: "pendiente_llenado" as const,
          abiertaEn: fecha(o.creada_en),
          proponente: proponenteDe(o.proponente),
          precioEntrada: null,
          stopLoss: null,
          takeProfit: null,
          pnlNoRealizadoC: null,
        })),
    ];
    activos[activo] = {
      mercado: {
        activo,
        ultimo: dato(snap?.ultimo, snap?.tsTrade),
        bid: dato(snap?.bid, snap?.tsQuote),
        ask: dato(snap?.ask, snap?.tsQuote),
        barras: barrasOk,
      },
      sinDatos: motivoSinDatos({
        errorBarras: b instanceof Error ? b.message : null,
        errorSnapshots: snapshots instanceof Error ? snapshots.message : null,
        barrasCerradas: cerradas,
        minimoBarras: 1,
        tsQuote: snap?.tsQuote ?? null,
        T,
      }),
      investigacion: null, // se completa abajo: la consulta es asíncrona
      entradasAbiertas: abiertas,
      bloqueadoR9: r9.has(activo),
      historial: {
        entradas: entradas24h
          .filter((l) => l.activo === activo)
          .map((l) => ({ t: fecha(l.abierto_en), precioEntrada: Number(l.precio), proponente: proponenteDe(l.proponente) })),
        cierres: cierres24h
          .filter((c) => c.activo === activo)
          .map((c) => ({ t: fecha(c.cerrado_en), motivo: c.motivo_cierre as "take_profit" | "stop_loss", pnlNetoC: Number(c.pnl) })),
      },
    };
  });
  for (const a of ACTIVOS) activos[a].investigacion = await ultimaInvestigacion(db, a, T);

  const contexto = armarContexto({
    id: randomUUID(),
    creadoEn: T,
    modoTrading: deps.pausaManual ? "pausa_manual" : Number(pausaAuto) > 0 ? "pausa_automatica" : "operando",
    maxEntradasAbiertasPorActivo: deps.maxEntradasAbiertasPorActivo,
    entradasHoy: cartera.entradasHoy,
    cartera: {
      saldoVirtualC: cartera.saldoVirtualC,
      exposicionC: cartera.exposicionTotalC + pendientes.reduce((s, p) => s + Number(p.nc), 0),
      exposicionPorActivoC,
      pnlDiaC: cartera.pnlDiaC,
    },
    activos,
  });
  await db.transaction(async (tx) => {
    await exigirLugar(tx, T);
    await tx
      .insert(contextosDecisor)
      .values({ id: contexto.id, creadoEn: T, tokenHuella: deps.tokenHuella, version: contexto.version, contenido: contexto });
  });
  return contexto;
}

/** La última investigación aceptada del activo, anterior o igual a `T`, aunque esté vencida (REQ-3). */
async function ultimaInvestigacion(db: Db, activo: Activo, T: Date): Promise<EntradaContexto["activos"][Activo]["investigacion"]> {
  const [f] = await filas(
    db,
    sql`SELECT id, activo, recibida_en, sentimiento::text AS sentimiento, noticia_fuerte, confianza::text AS confianza, resumen,
               fuentes, version_instrucciones
          FROM investigaciones
         WHERE estado = 'aceptada' AND activo = ${activo} AND recibida_en <= ${T.toISOString()}::timestamptz
         ORDER BY recibida_en DESC, id DESC LIMIT 1`,
  );
  if (!f) return null;
  return {
    id: f.id as string,
    activo: f.activo as string,
    estado: "aceptada",
    recibidaEn: fecha(f.recibida_en),
    sentimiento: Number(f.sentimiento),
    noticiaFuerte: f.noticia_fuerte as unknown as boolean,
    confianza: Number(f.confianza),
    resumen: f.resumen as string,
    fuentes: f.fuentes as unknown as string[],
    versionInstrucciones: f.version_instrucciones as string,
  };
}
