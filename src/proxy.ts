import { NextResponse, type NextRequest } from "next/server";
import { basicValido } from "@/server/investigaciones/auth";

// REQ-3: basic auth en todo menos la API del investigador (tiene su token) y el health.
export function proxy(request: NextRequest) {
  if (
    basicValido(
      request.headers.get("authorization"),
      process.env.DASHBOARD_USUARIO,
      process.env.DASHBOARD_CONTRASENA,
    )
  ) {
    return NextResponse.next();
  }
  return new NextResponse("No autorizado", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="SignalForge"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  matcher: ["/((?!api/v1(?:/|$)|api/health$).*)"],
};
