import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { MODOS, resolverModos, type Modo, type Modos } from "@/core/modos";
import { eventos } from "@/server/db/esquema";
import { leerMaxEntradasAbiertas } from "@/server/env";

type Fuente = Record<string, string | undefined>;

function leerModo(fuente: Fuente, nombre: "MODO_CICLO" | "MODO_DECISOR", defecto: Modo): Modo {
  const v = fuente[nombre];
  if (v === undefined || v === "") return defecto;
  if (!(MODOS as readonly string[]).includes(v)) throw new Error(`${nombre} inválido`);
  return v as Modo;
}

/**
 * Modos configurados (REQ-14). `MODO_CICLO` por defecto `ejecuta` y `MODO_DECISOR` por defecto `apagado`: el comportamiento de antes.
 * Inválido → lanza sin el valor. Fuera de `esquemaEnv` a propósito (D-4), como N: un valor mal escrito detiene solo a quien lo lee,
 * nunca al vigilante, que llama a `cargarEnv`.
 */
export function leerModosConfigurados(fuente: Fuente = process.env): { ciclo: Modo; decisor: Modo } {
  return { ciclo: leerModo(fuente, "MODO_CICLO", "ejecuta"), decisor: leerModo(fuente, "MODO_DECISOR", "apagado") };
}

/**
 * R11 está en vigor (D-5) si N es válida: el motor siempre evalúa R11, y con N inválida las entradas se detienen.
 */
export function r11Vigente(fuente: Fuente = process.env): boolean {
  try {
    leerMaxEntradasAbiertas(fuente);
    return true;
  } catch {
    return false;
  }
}

export function modosActuales(fuente: Fuente = process.env): Modos {
  return resolverModos(leerModosConfigurados(fuente), r11Vigente(fuente));
}

/** REQ-33: registra los modos solo si difieren de los del último evento. Serializado por `sf:modos`. */
export async function registrarModos(db: NodePgDatabase, m: Modos, ahora: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('sf:modos'))`);
    const [ultimo] = await tx
      .select({ detalle: eventos.detalle })
      .from(eventos)
      .where(eq(eventos.tipo, "modo_proponentes"))
      .orderBy(desc(eventos.id))
      .limit(1);
    if (ultimo && JSON.stringify(normalizar(ultimo.detalle as Modos)) === JSON.stringify(normalizar(m))) return;
    await tx.insert(eventos).values({ momento: ahora, tipo: "modo_proponentes", detalle: normalizar(m) });
  });
}

const normalizar = (m: Modos): Modos => ({
  ciclo: { configurado: m.ciclo.configurado, efectivo: m.ciclo.efectivo, motivo: m.ciclo.motivo },
  decisor: { configurado: m.decisor.configurado, efectivo: m.decisor.efectivo, motivo: m.decisor.motivo },
});

/**
 * Activación del decisor: el primer evento de modos con el decisor efectivo distinto de `apagado`.
 * La spec la define como el mínimo entre ese evento y la primera decisión recibida; `decisiones` llega con T-2
 * y entonces se agrega ese segundo término.
 */
export async function activacionDecisor(db: NodePgDatabase): Promise<Date | null> {
  const [primero] = await db
    .select({ momento: eventos.momento })
    .from(eventos)
    .where(and(eq(eventos.tipo, "modo_proponentes"), sql`${eventos.detalle}->'decisor'->>'efectivo' <> 'apagado'`))
    .orderBy(asc(eventos.id))
    .limit(1);
  return primero?.momento ?? null;
}
