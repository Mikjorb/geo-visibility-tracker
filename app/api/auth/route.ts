import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export const runtime = "nodejs";

// Comprueba la contraseña y, si es correcta, deja una cookie de sesión.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const password = body?.password;
  const expected = process.env.APP_PASSWORD;
  if (!expected || typeof password !== "string" || !safeEqual(password, expected)) {
    return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // en local (http) no se exige secure
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });
  return res;
}
