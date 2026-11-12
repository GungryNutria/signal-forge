import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (texto: string) => createHash("sha256").update(texto).digest();

/** SHA-256 en hex del token; es lo que se guarda en INVESTIGADOR_TOKEN_SHA256. */
export function hashToken(token: string): string {
  return sha256(token).toString("hex");
}

const BEARER = /^Bearer (sf([id])_[A-Za-z0-9_-]{43})$/;

export type Rol = "investigador" | "decisor";

/**
 * REQ-1: Bearer bien formado (`sfi_` del investigador, `sfd_` del decisor) cuyo SHA-256 coincide, en tiempo constante,
 * con el hash configurado de su rol. Un token con otro prefijo, sin hash configurado o revocado da `null`.
 */
export function identificarToken(
  authorization: string | null,
  hashes: { investigador?: string; decisor?: string },
): Rol | null {
  const m = authorization ? BEARER.exec(authorization) : null;
  if (!m) return null;
  const rol: Rol = m[2] === "i" ? "investigador" : "decisor";
  const esperado = hashes[rol];
  if (!esperado || !/^[0-9a-f]{64}$/.test(esperado)) return null;
  return timingSafeEqual(sha256(m[1]), Buffer.from(esperado, "hex")) ? rol : null;
}

/** REQ-1: el Bearer es el del investigador. */
export function tokenValido(authorization: string | null, hashEsperado: string | undefined): boolean {
  return identificarToken(authorization, { investigador: hashEsperado }) === "investigador";
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
