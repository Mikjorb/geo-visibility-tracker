import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Comprueba la contraseña y, si es correcta, deja una cookie de sesión.
export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const expected = process.env.APP_PASSWORD;
  if (!expected || password !== expected) {
    return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("geotracker_auth", expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // en local (http) no se exige secure
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });
  return res;
}
