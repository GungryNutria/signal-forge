import { dependenciasDelEntorno } from "@/server/decisor/entorno";
import { recibirDecision } from "@/server/decisor/recibir";

// Ruta del decisor (REQ-1): solo POST con su token; el resto de métodos da 405.
export async function POST(request: Request) {
  try {
    return await recibirDecision(request, dependenciasDelEntorno());
  } catch {
    return Response.json({ error: "error_interno" }, { status: 500 });
  }
}

const noPermitido = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = noPermitido;
export const HEAD = noPermitido;
export const PUT = noPermitido;
export const PATCH = noPermitido;
export const DELETE = noPermitido;
export const OPTIONS = noPermitido;
