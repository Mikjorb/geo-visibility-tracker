import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

export const AUTH_COOKIE = "geotracker_auth";

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sessionToken(password: string): string {
  return createHmac("sha256", password)
    .update("geo-visibility-tracker-session-v1")
    .digest("hex");
}

export function hasValidSession(req: NextRequest): boolean {
  const password = process.env.APP_PASSWORD;
  if (!password) return true; // herramienta local sin puerta configurada
  const cookie = req.cookies.get(AUTH_COOKIE)?.value ?? "";
  return safeEqual(cookie, sessionToken(password));
}
