// Genera el token del investigador y su SHA-256. Sin dependencias.
// El token (en claro) va solo como network secret de la tarea de claude.ai;
// el hash va en Coolify como INVESTIGADOR_TOKEN_SHA256. Revocar = cambiar el hash y redesplegar.
import { createHash, randomBytes } from "node:crypto";

const token = `sfi_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(token).digest("hex");

console.log("Token (network secret de la tarea; no se vuelve a mostrar):");
console.log(token);
console.log("\nINVESTIGADOR_TOKEN_SHA256 (variable de Coolify):");
console.log(hash);
