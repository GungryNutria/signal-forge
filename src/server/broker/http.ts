import { ErrorBroker } from "./tipos";

export type Fetch = typeof fetch;

export const TIMEOUT_MS = 10_000;

export type Respuesta = { status: number; cuerpo: unknown };

/**
 * GET/POST con timeout. Devuelve el estado y el JSON (o `null` si el cuerpo no es JSON); lo que lanza es un
 * `ErrorBroker` con texto fijo: el error original de `fetch` no se reenvía porque podría citar cabeceras.
 */
export async function pedir(
  fetchFn: Fetch,
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<Respuesta> {
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const vencido = new Promise<never>((_, rechazar) => ctl.signal.addEventListener("abort", rechazar));
    const r = await Promise.race([fetchFn(url, { ...init, signal: ctl.signal }), vencido]);
    const texto = await Promise.race([r.text(), vencido]);
    let cuerpo: unknown = null;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      // cuerpo no JSON
    }
    return { status: r.status, cuerpo };
  } catch {
    throw ctl.signal.aborted
      ? new ErrorBroker(`Sin respuesta en ${timeoutMs} ms`, "timeout")
      : new ErrorBroker("Error de red", "red");
  } finally {
    clearTimeout(reloj);
  }
}
