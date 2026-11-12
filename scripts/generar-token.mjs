// Genera un token y su SHA-256. Sin dependencias.
//   node scripts/generar-token.mjs            -> token del investigador (sfi_), hash para INVESTIGADOR_TOKEN_SHA256
//   node scripts/generar-token.mjs --decisor  -> token del decisor (sfd_), hash para DECISOR_TOKEN_SHA256
// El token (en claro) va solo como network secret de la tarea de claude.ai;
// el hash va en Coolify. Revocar = cambiar el hash y redesplegar.
import { createHash, randomBytes } from "node:crypto";

const decisor = process.argv.includes("--decisor");
const token = `${decisor ? "sfd" : "sfi"}_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(token).digest("hex");

console.log("Token (network secret de la tarea; no se vuelve a mostrar):");
console.log(token);
console.log(`\n${decisor ? "DECISOR_TOKEN_SHA256" : "INVESTIGADOR_TOKEN_SHA256"} (variable de Coolify):`);
console.log(hash);
