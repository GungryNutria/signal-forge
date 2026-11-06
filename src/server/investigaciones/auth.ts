import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (texto: string) => createHash("sha256").update(texto).digest();

/** SHA-256 en hex del token; es lo que se guarda en INVESTIGADOR_TOKEN_SHA256. */
export function hashToken(token: string): string {
  return sha256(token).toString("hex");
}

const BEARER = /^Bearer (sfi_[A-Za-z0-9_-]{43})$/;

/** REQ-1: Bearer bien formado cuyo SHA-256 coincide (en tiempo constante) con el hash configurado. */
export function tokenValido(authorization: string | null, hashEsperado: string | undefined): boolean {
  const m = authorization ? BEARER.exec(authorization) : null;
  if (!m || !hashEsperado || !/^[0-9a-f]{64}$/.test(hashEsperado)) return false;
  return timingSafeEqual(sha256(m[1]), Buffer.from(hashEsperado, "hex"));
}

/** REQ-3: basic auth del dashboard. Compara los digest de ambos lados, sin cortocircuito. */
export function basicValido(
  authorization: string | null,
  usuario: string | undefined,
  contrasena: string | undefined,
): boolean {
  if (!usuario || !contrasena || !authorization?.startsWith("Basic ")) return false;
  const credencial = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const i = credencial.indexOf(":");
  if (i < 0) return false;
  const u = timingSafeEqual(sha256(credencial.slice(0, i)), sha256(usuario));
  const c = timingSafeEqual(sha256(credencial.slice(i + 1)), sha256(contrasena));
  return u && c;
}
