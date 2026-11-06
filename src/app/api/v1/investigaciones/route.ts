import { recibirConEntorno } from "@/server/investigaciones/recibir";

// Única ruta que acepta el token del investigador (REQ-2). Cualquier otra bajo /api/v1/ da 404.
export async function POST(request: Request) {
  return recibirConEntorno(request);
}

// Los demás métodos dan 405 (OPTIONS se declara porque Next lo respondería solo con 204).
const noPermitido = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = noPermitido;
export const HEAD = noPermitido;
export const PUT = noPermitido;
export const PATCH = noPermitido;
export const DELETE = noPermitido;
export const OPTIONS = noPermitido;
