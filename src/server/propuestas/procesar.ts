import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { esActivo } from "@/core/activos";
import { aCentavos, deCentavos } from "@/core/dinero";
import { cantidadNeta, COMISION_BPS, nivelesLote } from "@/core/pnl";
import { huellaPropuesta, PropuestaV1 } from "@/core/propuesta";
import { evaluarRiesgo, type ResultadoRegla } from "@/core/riesgo";
import type { Broker, OrdenBroker, PeticionOrden } from "@/server/broker/tipos";
import { calcularCartera } from "@/server/cartera";
import { eventos, eventosOrden, lotes, ordenes, propuestas } from "@/server/db/esquema";
import type { Env } from "@/server/env";

export const URL_PAPER = "https://paper-api.alpaca.markets";
const LLENADO_INTENTOS = 10;
const LLENADO_INTERVALO_MS = 1000;

export type MotivoPropuesta =
  | "aprobada"
  | "propuesta_invalida"
  | "segunda_propuesta_misma_ejecucion"
  | "clave_con_otro_contenido"
  | "entorno_no_paper"
  | "reglas_incumplidas"
  | "venta_no_habilitada";

export type ResultadoPropuesta = {
  propuestaId: string;
  decision: "ejecutada" | "rechazada" | "conflicto" | "error";
  motivo: MotivoPropuesta;
  reglas: ResultadoRegla[] | null;
  ordenId: string | null;
  repetida: boolean;
};

export type CtxPropuesta = {
  db: NodePgDatabase;
  broker: Broker;
  ahora: () => Date;
  env: Pick<Env, "APCA_API_BASE_URL" | "TRADING_PAUSADO">;
  /** Evaluación del ciclo que originó la propuesta (la liga T-6; `v_dataset` la une por aquí). */
  evaluacionId?: string;
  /** Pausa entre consultas de llenado; los tests la sustituyen. */
  esperar?: (ms: number) => Promise<void>;
};

type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
type Envio = { ordenId: string; peticion: PeticionOrden };

export function clientOrderIdEntrada(clave: string): string {
  return `sf-e-${createHash("sha256").update(clave).digest("hex").slice(0, 32)}`;
}

const bloquearDecisiones = (tx: Tx) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sf:decision'))`);

/** Camino común de toda propuesta (plan.md §Camino común). Las fases 1 a 5 corren bajo un candado global. */
export async function procesarPropuesta(entrada: unknown, ctx: CtxPropuesta): Promise<ResultadoPropuesta> {
  const { resultado, envio } = await ctx.db.transaction((tx) => decidir(tx, entrada, ctx));
  if (envio) await enviarYEsperar(ctx, envio);
  return resultado;
}

async function decidir(
  tx: Tx,
  entrada: unknown,
  ctx: CtxPropuesta,
): Promise<{ resultado: ResultadoPropuesta; envio?: Envio }> {
  const ahora = ctx.ahora();
  await bloquearDecisiones(tx);

  const insertar = async (
    valores: Pick<typeof propuestas.$inferInsert, "decision" | "motivo"> & Partial<typeof propuestas.$inferInsert>,
    p?: PropuestaV1,
  ) => {
    const [fila] = await tx
      .insert(propuestas)
      .values({
        esOriginal: false,
        entradaCruda: entrada ?? null,
        recibidaEn: ahora,
        evaluacionId: ctx.evaluacionId,
        ...(p && {
          claveIdempotencia: p.clave_idempotencia,
          huellaContenido: huellaPropuesta(p),
          proponente: p.proponente,
          ejecucionId: p.ejecucion_id,
          versionRegla: p.version_regla,
          activo: p.activo,
          lado: p.lado,
          nocionalUsd: p.nocional_usd == null ? null : deCentavos(aCentavos(p.nocional_usd)),
          cantidad: p.cantidad == null ? null : String(p.cantidad),
          tipoOrden: p.tipo_orden,
          justificacion: p.justificacion,
        }),
        ...valores,
      })
      .returning({ id: propuestas.id });
    return fila.id;
  };
  const sinOrden = (
    propuestaId: string,
    decision: ResultadoPropuesta["decision"],
    motivo: MotivoPropuesta,
    reglas: ResultadoRegla[] | null = null,
  ): { resultado: ResultadoPropuesta } => ({
    resultado: { propuestaId, decision, motivo, reglas, ordenId: null, repetida: false },
  });

  // 1. Esquema (REQ-8).
  const parsed = PropuestaV1.safeParse(entrada);
  if (!parsed.success) {
    const id = await insertar({ decision: "rechazada", motivo: "propuesta_invalida" });
    return sinOrden(id, "rechazada", "propuesta_invalida");
  }
  const p = parsed.data;
  const huella = huellaPropuesta(p);

  // 3. Idempotencia (REQ-12, REQ-13). Va antes que la regla de una por ejecución para que el reintento de la
  // misma propuesta devuelva su resultado original y no un "segunda propuesta".
  const [original] = await tx
    .select()
    .from(propuestas)
    .where(and(eq(propuestas.claveIdempotencia, p.clave_idempotencia), eq(propuestas.esOriginal, true)));
  if (original) {
    if (original.huellaContenido === huella) {
      const [orden] = await tx.select({ id: ordenes.id }).from(ordenes).where(eq(ordenes.propuestaId, original.id));
      return {
        resultado: {
          propuestaId: original.id,
          decision: original.decision as ResultadoPropuesta["decision"],
          motivo: original.motivo as MotivoPropuesta,
          reglas: (original.reglas as ResultadoRegla[] | null) ?? null,
          ordenId: orden?.id ?? null,
          repetida: true,
        },
      };
    }
    const id = await insertar({ decision: "conflicto", motivo: "clave_con_otro_contenido" }, p);
    return sinOrden(id, "conflicto", "clave_con_otro_contenido");
  }

  // 2. Una propuesta por activo y ejecución (REQ-7).
  const [previa] = await tx
    .select({ id: propuestas.id })
    .from(propuestas)
    .where(
      and(
        eq(propuestas.ejecucionId, p.ejecucion_id),
        eq(propuestas.activo, p.activo),
        eq(propuestas.esOriginal, true),
      ),
    )
    .limit(1);
  if (previa) {
    const id = await insertar({ decision: "error", motivo: "segunda_propuesta_misma_ejecucion" }, p);
    return sinOrden(id, "error", "segunda_propuesta_misma_ejecucion");
  }

  // 4. Entorno (REQ-15).
  if (ctx.env.APCA_API_BASE_URL !== URL_PAPER) {
    const id = await insertar({ esOriginal: true, decision: "error", motivo: "entorno_no_paper" }, p);
    await tx.insert(eventos).values({
      momento: ahora,
      tipo: "entorno_no_paper",
      activo: esActivo(p.activo) ? p.activo : null,
      detalle: { propuestaId: id },
    });
    return sinOrden(id, "error", "entorno_no_paper");
  }

  // 5. Riesgo (REQ-9, REQ-10).
  const estado = await calcularCartera(tx, ahora, ctx.env.TRADING_PAUSADO === "true");
  const { aprobada, reglas } = evaluarRiesgo(p, estado);
  if (!aprobada) {
    const id = await insertar(
      {
        esOriginal: true,
        decision: "rechazada",
        motivo: "reglas_incumplidas",
        reglas,
        reglasIncumplidas: reglas.filter((r) => !r.cumple).map((r) => r.regla),
      },
      p,
    );
    return sinOrden(id, "rechazada", "reglas_incumplidas", reglas);
  }
  if (p.lado === "sell") {
    const id = await insertar({ esOriginal: true, decision: "error", motivo: "venta_no_habilitada", reglas }, p);
    return sinOrden(id, "error", "venta_no_habilitada", reglas);
  }

  // Compra aprobada: propuesta, orden y evento pendiente_envio en la misma transacción (outbox, ADR 0005).
  const id = await insertar({ esOriginal: true, decision: "ejecutada", motivo: "aprobada", reglas }, p);
  const nocional = deCentavos(aCentavos(p.nocional_usd ?? 0));
  const clientOrderId = clientOrderIdEntrada(p.clave_idempotencia);
  const [orden] = await tx
    .insert(ordenes)
    .values({
      propuestaId: id,
      tramo: "entrada",
      clientOrderId,
      activo: p.activo,
      lado: "buy",
      nocionalUsd: nocional,
      creadaEn: ahora,
    })
    .returning({ id: ordenes.id });
  await tx.insert(eventosOrden).values({ ordenId: orden.id, momento: ahora, estado: "pendiente_envio" });
  return {
    resultado: { propuestaId: id, decision: "ejecutada", motivo: "aprobada", reglas, ordenId: orden.id, repetida: false },
    envio: {
      ordenId: orden.id,
      peticion: { clientOrderId, simbolo: p.activo as PeticionOrden["simbolo"], lado: "buy", nocionalUsd: nocional },
    },
  };
}

function estadoDe(status: string): "aceptada" | "parcial" | "llenada" | "cancelada" | "rechazada" {
  switch (status) {
    case "filled":
      return "llenada";
    case "partially_filled":
      return "parcial";
    case "canceled":
    case "expired":
    case "done_for_day":
      return "cancelada";
    case "rejected":
      return "rechazada";
    default:
      return "aceptada";
  }
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pasos 6 y 7: envío fuera de la transacción y espera de llenado de hasta 10 s. */
async function enviarYEsperar(ctx: CtxPropuesta, { ordenId, peticion }: Envio): Promise<void> {
  const evento = (e: Partial<typeof eventosOrden.$inferInsert> & Pick<typeof eventosOrden.$inferInsert, "estado">) =>
    ctx.db.insert(eventosOrden).values({ ordenId, momento: ctx.ahora(), ...e });

  const r = await ctx.broker.enviarOrden(peticion);
  if (r.tipo === "incierta") {
    await evento({ estado: "desconocido", detalle: r.causa });
    return;
  }
  if (r.tipo === "rechazada") {
    await evento({ estado: "rechazada", respuesta: { status: r.status, cuerpo: r.cuerpo }, detalle: `HTTP ${r.status}` });
    return;
  }
  await evento({
    estado: "enviada",
    brokerOrderId: r.orden.id,
    respuesta: r.orden.raw,
    cantidadLlenada: r.orden.filledQty,
    precioMedio: r.orden.filledAvgPrice,
  });

  const esperar = ctx.esperar ?? dormir;
  let orden: OrdenBroker = r.orden;
  try {
    for (let i = 0; i < LLENADO_INTENTOS && estadoDe(orden.status) === "aceptada"; i++) {
      await esperar(LLENADO_INTERVALO_MS);
      const c = await ctx.broker.consultarOrden(peticion.clientOrderId);
      if (c !== "no_existe") orden = c;
    }
  } catch {
    return; // la consulta falló: el vigilante termina el trabajo
  }

  const estado = estadoDe(orden.status);
  if (estado === "llenada") {
    await registrarLlenadoEntrada(ctx.db, ordenId, orden, ctx.ahora());
  } else if (estado !== "aceptada") {
    await evento({
      estado,
      brokerOrderId: orden.id,
      respuesta: orden.raw,
      cantidadLlenada: orden.filledQty,
      precioMedio: orden.filledAvgPrice,
    });
  }
}

/**
 * Evento `llenada` y apertura del lote (plan.md §Lotes y protecciones). Idempotente: bajo el candado de
 * decisiones, si el lote de la orden ya existe no hace nada, así que el vigilante puede llamarla sin duplicar.
 */
export async function registrarLlenadoEntrada(
  db: NodePgDatabase,
  ordenId: string,
  llena: OrdenBroker,
  ahora: Date,
): Promise<void> {
  const precio = Number(llena.filledAvgPrice);
  const cantidadLlenada = Number(llena.filledQty);
  if (!(precio > 0) || !(cantidadLlenada > 0)) throw new Error("orden llenada sin precio o cantidad válidos");

  await db.transaction(async (tx) => {
    await bloquearDecisiones(tx);
    const [orden] = await tx.select().from(ordenes).where(eq(ordenes.id, ordenId));
    const [existente] = await tx.select({ id: lotes.id }).from(lotes).where(eq(lotes.ordenEntradaId, ordenId));
    if (existente || !orden?.propuestaId) return;

    await tx.insert(eventosOrden).values({
      ordenId,
      momento: ahora,
      estado: "llenada",
      brokerOrderId: llena.id,
      respuesta: llena.raw,
      cantidadLlenada: llena.filledQty,
      precioMedio: llena.filledAvgPrice,
    });
    const { stopLoss, takeProfit } = nivelesLote(precio);
    await tx.insert(lotes).values({
      propuestaId: orden.propuestaId,
      ordenEntradaId: ordenId,
      activo: orden.activo,
      abiertoEn: ahora,
      precioEntrada: String(precio),
      cantidadLlenada: llena.filledQty,
      cantidadNeta: cantidadNeta(cantidadLlenada).toFixed(9),
      nocionalEntradaUsd: deCentavos(aCentavos(cantidadLlenada * precio)),
      comisionBps: COMISION_BPS,
      stopLoss: stopLoss.toFixed(10),
      takeProfit: takeProfit.toFixed(10),
    });
  });
}
