import { and, eq, sql } from "drizzle-orm";
import type { Activo } from "@/core/activos";
import { DecisionV1, huellaDecision, propuestaDe } from "@/core/decision";
import type { Modos } from "@/core/modos";
import { ranuraDecisor } from "@/core/tiempo";
import type { Broker, DatosMercado } from "@/server/broker/tipos";
import type { Db } from "@/server/db/cliente";
import { contextosDecisor, decisiones } from "@/server/db/esquema";
import { type Env, leerMaxEntradasAbiertas } from "@/server/env";
import {
  contieneNulo,
  leerCuerpo,
  MAX_CUERPO_BYTES,
  sinNulos,
} from "@/server/investigaciones/recibir";
import { modosActuales, registrarModos } from "@/server/modos";
import { procesarPropuesta, type CtxPropuesta, type ResultadoPropuesta } from "@/server/propuestas/procesar";
import { controlarAcceso, huellaToken, json } from "./acceso";
import { crearContexto } from "./contexto";

const VIGENCIA_CONTEXTO_MS = 15 * 60_000;
const MAX_CRUDO_JSON_INVALIDO = 2_000;

export type DependenciasDecisor = {
  db: Db;
  hashes: { investigador?: string; decisor?: string };
  ahora: () => Date;
  datos: DatosMercado;
  broker: Broker;
  env: Pick<Env, "APCA_API_BASE_URL" | "TRADING_PAUSADO">;
  /** Variables de las que salen los modos y N (D-4); por defecto `process.env`. */
  fuente?: Record<string, string | undefined>;
  esperar?: CtxPropuesta["esperar"];
};

type Rechazo = Partial<typeof decisiones.$inferInsert>;

/** Los modos de esta petición, o `null` si la configuración es inválida (el 503 `configuracion_invalida`). */
function leerModos(deps: DependenciasDecisor): Modos | null {
  try {
    return modosActuales(deps.fuente);
  } catch {
    return null;
  }
}

/**
 * N de R11 para el contexto, o `null` si es inválida: el decisor queda en "solo registra" (REQ-17) y debe seguir recibiendo
 * contexto para que sus decisiones se registren; las entradas están detenidas de todos modos.
 */
function nValida(fuente: DependenciasDecisor["fuente"]): number | null {
  try {
    return leerMaxEntradasAbiertas(fuente);
  } catch {
    return null;
  }
}

/** `POST /api/v1/decisor/contextos` (plan §3.3). Orden: auth, frecuencia, modos, armar, guardar. */
export async function recibirContexto(request: Request, deps: DependenciasDecisor): Promise<Response> {
  const { db } = deps;
  try {
    const ahora = deps.ahora();
    const rechazo = await controlarAcceso(request, db, deps.hashes, ahora);
    if (rechazo) return rechazo;
    const modos = leerModos(deps);
    if (modos) await registrarModos(db, modos, ahora);
    const contexto = await crearContexto({
      db,
      datos: deps.datos,
      ahora: deps.ahora,
      tokenHuella: huellaToken(deps.hashes.decisor),
      pausaManual: deps.env.TRADING_PAUSADO === "true",
      maxEntradasAbiertasPorActivo: nValida(deps.fuente),
    });
    return json(contexto, 201);
  } catch {
    return json({ error: "error_interno" }, 500);
  }
}

type FilaDecision = typeof decisiones.$inferSelect;

const cuerpoDe = (f: Pick<FilaDecision, "id" | "estado" | "motivo" | "ranura" | "decision" | "modoEfectivo">, propuesta: ResultadoPropuesta | null) => ({
  id: f.id,
  estado: f.estado,
  motivo: f.motivo,
  ranura: f.ranura.toISOString(),
  decision: f.decision,
  modo_efectivo: f.modoEfectivo,
  propuesta: propuesta && {
    id: propuesta.propuestaId,
    decision: propuesta.decision,
    motivo: propuesta.motivo,
    reglas_incumplidas: (propuesta.reglas ?? []).filter((r) => !r.cumple).map((r) => r.regla),
  },
});

/**
 * `POST /api/v1/decisor/decisiones` (plan §3.4). Orden: auth, frecuencia, tamaño, JSON, modos, esquema, idempotencia y
 * conflicto, contexto, datos no disponibles, inserción y, solo si es `comprar` en `ejecuta`, `procesarPropuesta`.
 * El texto del decisor solo se valida y se guarda; nunca se interpreta (REQ-13).
 */
export async function recibirDecision(request: Request, deps: DependenciasDecisor): Promise<Response> {
  const { db } = deps;
  try {
    const ahora = deps.ahora();
    const acceso = await controlarAcceso(request, db, deps.hashes, ahora);
    if (acceso) return acceso;

    const ranura = ranuraDecisor(ahora);
    const modos = leerModos(deps);
    if (modos) await registrarModos(db, modos, ahora);
    // Toda fila guarda hora, ranura y modos (REQ-14, REQ-29); `valida` y `es_original` solo las pone la inserción del paso 11.
    const registrar = async (datos: Rechazo): Promise<string> => {
      const [fila] = await db
        .insert(decisiones)
        .values({
          recibidaEn: ahora,
          ranura,
          estado: "rechazada",
          valida: false,
          esOriginal: false,
          modoConfigurado: modos?.decisor.configurado ?? null,
          modoEfectivo: modos?.decisor.efectivo ?? null,
          motivoModo: modos?.decisor.motivo ?? null,
          ...datos,
        })
        .returning({ id: decisiones.id });
      return fila.id;
    };

    // 3. tamaño
    const texto = await leerCuerpo(request, MAX_CUERPO_BYTES);
    if (texto === null) {
      await registrar({ motivo: "cuerpo_demasiado_grande" });
      return json({ error: "cuerpo_demasiado_grande" }, 413);
    }

    // 4. JSON
    let crudo: unknown;
    try {
      crudo = JSON.parse(texto);
    } catch {
      const id = await registrar({ motivo: "json_invalido", cuerpoCrudo: sinNulos(texto.slice(0, MAX_CRUDO_JSON_INVALIDO)) });
      return json({ error: "json_invalido", id }, 400);
    }

    // 5. modos
    if (!modos || modos.decisor.efectivo === "apagado") {
      const motivo = modos ? "decisor_apagado" : "configuracion_invalida";
      const id = await registrar({ motivo, cuerpoCrudo: sinNulos(texto) });
      return json({ error: motivo, id }, 503);
    }

    // 6. esquema (estricto). U+0000 se rechaza porque la base no lo puede guardar.
    const parsed = DecisionV1.safeParse(crudo);
    const tieneNulos = contieneNulo(crudo);
    if (!parsed.success || tieneNulos) {
      const motivos = tieneNulos
        ? [{ campo: "(cuerpo)", motivo: "carácter nulo no permitido" }]
        : parsed.error!.issues.flatMap((i) =>
            i.code === "unrecognized_keys"
              ? i.keys.map((k) => ({ campo: sinNulos(k), motivo: "campo desconocido" }))
              : [{ campo: i.path.join(".") || "(cuerpo)", motivo: i.message }],
          );
      const id = await registrar({ motivo: "decision_invalida", motivos, cuerpoCrudo: sinNulos(texto) });
      return json({ error: "decision_invalida", id, motivos }, 422);
    }
    const d = parsed.data;
    const huella = huellaDecision(d);

    // 8 a 11. Un candado de transacción corto serializa idempotencia, conflicto de ranura y la inserción (RK-7).
    const resultado = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sf:decisor'))`);
      const [contexto] = await tx.select().from(contextosDecisor).where(eq(contextosDecisor.id, d.contexto_id));
      const rechazar = async (motivo: string, status: number, error: string, motivos?: { campo: string; motivo: string }[]) => {
        const [fila] = await tx
          .insert(decisiones)
          .values({
            recibidaEn: ahora,
            ranura,
            estado: "rechazada",
            motivo,
            valida: false,
            esOriginal: false,
            claveIdempotencia: d.clave_idempotencia,
            huellaContenido: huella,
            ejecucionDecisor: d.ejecucion_id,
            versionInstrucciones: d.version_instrucciones,
            contextoId: contexto?.id ?? null,
            motivos,
            activo: d.activo,
            decision: d.decision,
            confianza: String(d.confianza),
            razonamiento: d.razonamiento,
            cuerpoCrudo: sinNulos(texto),
            modoConfigurado: modos.decisor.configurado,
            modoEfectivo: modos.decisor.efectivo,
            motivoModo: modos.decisor.motivo,
          })
          .returning({ id: decisiones.id });
        return { tipo: "respuesta" as const, status, cuerpo: { error, ...(status === 409 && { motivo }), id: fila.id, ...(motivos && { motivos }) } };
      };

      const [original] = await tx
        .select()
        .from(decisiones)
        .where(and(eq(decisiones.claveIdempotencia, d.clave_idempotencia), eq(decisiones.esOriginal, true)));
      if (original) {
        if (original.huellaContenido === huella) return { tipo: "repetida" as const, original };
        return rechazar("conflicto_idempotencia", 409, "conflicto");
      }
      const [enRanura] = await tx
        .select({ id: decisiones.id })
        .from(decisiones)
        .where(and(eq(decisiones.ranura, ranura), eq(decisiones.activo, d.activo), eq(decisiones.valida, true)));
      if (enRanura) return rechazar("conflicto_ranura", 409, "conflicto");

      // 9. contexto (REQ-9): existe, se entregó a este token y tiene 15 min o menos.
      const edadMs = contexto ? ahora.getTime() - contexto.creadoEn.getTime() : 0;
      const motivoContexto = !contexto
        ? "el contexto no existe"
        : contexto.tokenHuella !== huellaToken(deps.hashes.decisor)
          ? "el contexto no se entregó a este token"
          : edadMs > VIGENCIA_CONTEXTO_MS
            ? `contexto de hace ${Math.floor(edadMs / 60_000)} min, máximo 15`
            : null;
      if (motivoContexto) {
        return rechazar("contexto_vencido", 422, "contexto_vencido", [{ campo: "contexto_id", motivo: motivoContexto }]);
      }

      // 10 y 11. REQ-6: `comprar` de un activo sin datos es válida y no crea propuesta. El resto, aceptada.
      const sinDatos =
        d.decision === "comprar" &&
        (contexto.contenido as { activos: Record<string, { datos: string }> }).activos[d.activo]?.datos === "no_disponibles";
      const [fila] = await tx
        .insert(decisiones)
        .values({
          recibidaEn: ahora,
          ranura,
          estado: sinDatos ? "rechazada" : "aceptada",
          motivo: sinDatos ? "datos_no_disponibles" : null,
          valida: true,
          esOriginal: true,
          claveIdempotencia: d.clave_idempotencia,
          huellaContenido: huella,
          ejecucionDecisor: d.ejecucion_id,
          versionInstrucciones: d.version_instrucciones,
          contextoId: d.contexto_id,
          activo: d.activo,
          decision: d.decision,
          confianza: String(d.confianza),
          razonamiento: d.razonamiento,
          cuerpoCrudo: sinNulos(texto),
          modoConfigurado: modos.decisor.configurado,
          modoEfectivo: modos.decisor.efectivo,
          motivoModo: modos.decisor.motivo,
        })
        .returning();
      return { tipo: "nueva" as const, fila };
    });

    if (resultado.tipo === "respuesta") return json(resultado.cuerpo, resultado.status);
    const fila = resultado.tipo === "nueva" ? resultado.fila : resultado.original;

    // 12. Después del commit. `no_comprar`, "solo registra" y "datos no disponibles" terminan aquí. La repetida de una
    // `comprar` vuelve a llamar al camino común con la misma propuesta: es idempotente y recupera una caída entre la
    // decisión y la orden. Con modo efectivo `ejecuta` en la decisión y ahora (si cambió, no se ejecuta nada nuevo).
    let propuesta: ResultadoPropuesta | null = null;
    if (fila.decision === "comprar" && fila.motivo === null && fila.modoEfectivo === "ejecuta" && modos.decisor.efectivo === "ejecuta") {
      propuesta = await procesarPropuesta(
        propuestaDe({
          id: fila.id,
          ranura: fila.ranura,
          activo: fila.activo as Activo,
          versionInstrucciones: fila.versionInstrucciones as string,
          contextoId: fila.contextoId as string,
          confianza: Number(fila.confianza),
        }),
        {
          db,
          broker: deps.broker,
          ahora: deps.ahora,
          env: deps.env,
          maxEntradasAbiertasPorActivo: leerMaxEntradasAbiertas(deps.fuente),
          decisionId: fila.id,
          esperar: deps.esperar,
        },
      );
    }
    return json(cuerpoDe(fila, propuesta), resultado.tipo === "nueva" ? 201 : 200);
  } catch {
    return json({ error: "error_interno" }, 500);
  }
}
