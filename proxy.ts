import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/auth";

// Puerta de acceso simple por contraseña. Si APP_PASSWORD no está definida
// (entorno local), no se exige nada. /api/run queda exento porque lo protege
// su propio RUN_SECRET.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/run"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (hasValidSession(req)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

// Aplica a todo salvo assets estáticos.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
