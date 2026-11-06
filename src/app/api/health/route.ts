import { connection } from "next/server";
import { baseDisponible } from "@/server/investigaciones/salud";

export async function GET() {
  await connection(); // request-time: nunca se prerenderiza en el build
  const ok = await baseDisponible();
  return Response.json({ ok }, { status: ok ? 200 : 503 });
}
