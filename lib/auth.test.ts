import { describe, expect, it } from "vitest";
import { safeEqual, sessionToken } from "./auth";

describe("autenticación", () => {
  it("compara secretos sin aceptar longitudes o valores distintos", () => {
    expect(safeEqual("secreto", "secreto")).toBe(true);
    expect(safeEqual("secreto", "otro")).toBe(false);
    expect(safeEqual("secreto", "secreto-largo")).toBe(false);
  });

  it("la cookie derivada no contiene la contraseña", () => {
    const token = sessionToken("mi-password");
    expect(token).not.toContain("mi-password");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });
});
