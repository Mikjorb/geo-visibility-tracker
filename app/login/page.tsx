"use client";

import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setLoading(false);
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next;
    } else {
      setErr("Contraseña incorrecta");
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto" }}>
      <h1>⚡ GEO Visibility Tracker</h1>
      <p className="subtitle">Introduce la contraseña para acceder.</p>
      <form onSubmit={submit}>
        <label>Contraseña</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={loading} style={{ marginTop: 14, width: "100%" }}>
          {loading ? "Comprobando…" : "Entrar"}
        </button>
        {err && <div className="toast err" style={{ marginTop: 12 }}>{err}</div>}
      </form>
    </div>
  );
}
