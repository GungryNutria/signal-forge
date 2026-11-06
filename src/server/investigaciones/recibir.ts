import { createHash } from "node:crypto";
import { and, count, eq, gt, min, sql } from "drizzle-orm";
import { InvestigacionV1 } from "@/core/investigacion";
import { jsonCanonico } from "@/core/propuesta";
import { type Db, obtenerDb } from "@/server/db/cliente";
import { eventos, investigaciones } from "@/server/db/esquema";
import { tokenValido } from "./auth";

export const MAX_CUERPO_BYTES = 16 * 1024;
export const MAX_PETICIONES = 20;
export const VENTANA_MIN = 60;
const MAX_CRUDO_JSON_INVALIDO = 2_000;

export type Dependencias = { db: Db; tokenSha256: string | undefined };

type Rechazo = Partial<typeof investigaciones.$inferInsert>;

const json = (cuerpo: unknown, status: number, headers?: HeadersInit) =>
  Response.json(cuerpo, { status, headers });

// Postgres no admite U+0000 en text ni en jsonb.
const sinNulos = (s: string) => s.replaceAll("\u0000", "");

const contieneNulo = (v: unknown): boolean =>
  typeof v === "string"
    ? v.includes("\u0000")
    : Array.isArray(v)
      ? v.some(contieneNulo)
      : v !== null && typeof v === "object"
        ? Object.entries(v).some(([k, x]) => contieneNulo(k) || contieneNulo(x))
        : false;

function ipDe(request: Request): string | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip");
  return ip ? ip.slice(0, 64) : null;
}

/** Lee el cuerpo sin pasar de `max` bytes: no bufferiza lo que no se va a aceptar. */
async function leerCuerpo(request: Request, max: number): Promise<string | null> {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > max) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function registrarRechazo(db: Db, datos: Rechazo): Promise<string> {
  const [fila] = await db
    .insert(investigaciones)
    .values({ ...datos, estado: "rechazada" })
    .returning({ id: investigaciones.id });
  return fila.id;
}

/** Huella de contenido: SHA-256 del JSON canónico de los campos, sin la clave. */
function huella(datos: InvestigacionV1): string {
  const resto: Record<string, unknown> = { ...datos };
  delete resto.clave_idempotencia;
  return createHash("sha256").update(jsonCanonico(resto)).digest("hex");
}

/**
 * POST /api/v1/investigaciones. Orden (plan.md): auth, límite, tamaño, JSON, esquema,
 * idempotencia, inserción. El texto recibido solo se valida y se guarda; nunca se interpreta.
 */
export async function recibirInvestigacion(request: Request, dep: Dependencias): Promise<Response> {
  const { db } = dep;
  try {
    // 1. auth: sin contenido en el evento (REQ-21)
    if (!tokenValido(request.headers.get("authorization"), dep.tokenSha256)) {
      await db
        .insert(eventos)
        .values({
          tipo: "auth_fallida",
          detalle: { ruta: new URL(request.url).pathname, ip: ipDe(request) },
        })
        .catch(() => console.error("auth_fallida: no se pudo registrar el evento")); // el 401 sale igual
      return json({ error: "no_autorizado" }, 401);
    }

    // 2. límite de frecuencia (RNF-8): solo hay un token, así que se cuentan las filas de la ventana
    const [{ n, primera }] = await db
      .select({ n: count(), primera: min(investigaciones.recibidaEn) })
      .from(investigaciones)
      .where(gt(investigaciones.recibidaEn, sql`now() - make_interval(mins => ${VENTANA_MIN})`));
    if (n >= MAX_PETICIONES) {
      const venceEnS = primera ? VENTANA_MIN * 60 - (Date.now() - primera.getTime()) / 1000 : 60;
      return json({ error: "limite_frecuencia" }, 429, {
        "Retry-After": String(Math.max(1, Math.ceil(venceEnS))),
      });
    }

    // 3. tamaño
    const texto = await leerCuerpo(request, MAX_CUERPO_BYTES);
    if (texto === null) {
      await registrarRechazo(db, { motivo: "cuerpo_demasiado_grande" });
      return json({ error: "cuerpo_demasiado_grande" }, 413);
    }

    // 4. JSON
    let crudo: unknown;
    try {
      crudo = JSON.parse(texto);
    } catch {
      const id = await registrarRechazo(db, {
        motivo: "json_invalido",
        cuerpoCrudo: sinNulos(texto.slice(0, MAX_CRUDO_JSON_INVALIDO)),
      });
      return json({ error: "json_invalido", id }, 400);
    }

    // 5. esquema (estricto). U+0000 se rechaza porque la base no lo puede guardar.
    const parsed = InvestigacionV1.safeParse(crudo);
    const tieneNulos = contieneNulo(crudo);
    if (!parsed.success || tieneNulos) {
      const motivos = tieneNulos
        ? [{ campo: "(cuerpo)", motivo: "carácter nulo no permitido" }]
        : parsed.error!.issues.flatMap((i) =>
            i.code === "unrecognized_keys"
              ? i.keys.map((k) => ({ campo: sinNulos(k), motivo: "campo desconocido" }))
              : [{ campo: i.path.join(".") || "(cuerpo)", motivo: i.message }],
          );
      const id = await registrarRechazo(db, {
        motivo: "investigacion_invalida",
        motivos,
        cuerpoCrudo: sinNulos(texto),
      });
      return json({ error: "investigacion_invalida", id, motivos }, 422);
    }
    const d = parsed.data;
    const h = huella(d);

    // 6. idempotencia y 7. inserción: el índice único parcial resuelve la carrera entre dos iguales
    const campos = {
      claveIdempotencia: d.clave_idempotencia,
      huellaContenido: h,
      ejecucionInvestigador: d.ejecucion_id,
      versionInstrucciones: d.version_instrucciones,
      activo: d.activo,
      sentimiento: String(d.sentimiento),
      noticiaFuerte: d.noticia_fuerte,
      confianza: String(d.confianza),
      resumen: d.resumen,
      fuentes: d.fuentes,
    };
    const [nueva] = await db
      .insert(investigaciones)
      .values({ ...campos, estado: "aceptada" })
      .onConflictDoNothing({
        target: investigaciones.claveIdempotencia,
        where: sql`${investigaciones.estado} = 'aceptada'`,
      })
      .returning({ id: investigaciones.id, recibida_en: investigaciones.recibidaEn });
    if (nueva) {
      return json({ id: nueva.id, estado: "aceptada", recibida_en: nueva.recibida_en }, 201);
    }

    const [original] = await db
      .select({
        id: investigaciones.id,
        recibida_en: investigaciones.recibidaEn,
        huella: investigaciones.huellaContenido,
      })
      .from(investigaciones)
      .where(
        and(
          eq(investigaciones.claveIdempotencia, d.clave_idempotencia),
          eq(investigaciones.estado, "aceptada"),
        ),
      );
    if (original.huella === h) {
      return json({ id: original.id, estado: "aceptada", recibida_en: original.recibida_en }, 200);
    }
    await registrarRechazo(db, {
      motivo: "conflicto_idempotencia",
      claveIdempotencia: d.clave_idempotencia,
      huellaContenido: h,
      activo: d.activo,
      cuerpoCrudo: texto,
    });
    return json({ error: "conflicto_idempotencia" }, 409);
  } catch {
    return json({ error: "error_interno" }, 500);
  }
}

/** Punto de entrada de la ruta: conexión y hash del token tomados del entorno. */
export function recibirConEntorno(request: Request): Promise<Response> {
  return recibirInvestigacion(request, {
    db: obtenerDb(),
    tokenSha256: process.env.INVESTIGADOR_TOKEN_SHA256,
  });
}
