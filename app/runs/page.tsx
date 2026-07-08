"use client";

import { useEffect, useState } from "react";

interface Resp {
  id: number;
  prompt_text: string;
  model_label: string;
  raw_text: string;
  error: string | null;
  brands: { name: string; is_own: boolean }[];
  citations: { domain: string; url: string | null; is_own: boolean }[];
  fanoutQueries: string[];
  entities: { name: string; isOwn: boolean; isKnown: boolean }[];
}
interface RunInfo {
  id: number;
  started_at: string;
  note: string;
}
interface Data {
  runs: RunInfo[];
  runId: number;
  responses: Resp[];
}

export default function RunsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  async function load(id?: number) {
    const res = await fetch(`/api/responses${id ? `?runId=${id}` : ""}`);
    const json = await res.json();
    setData(json);
    setRunId(json.runId ?? null);
    setOpen(new Set());
  }
  useEffect(() => {
    load();
  }, []);

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!data) return <p className="subtitle">Cargando…</p>;
  if (data.runs.length === 0)
    return (
      <>
        <h1>Respuestas</h1>
        <div className="empty">Todavía no se ha ejecutado ninguna consulta.</div>
      </>
    );

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Respuestas</h1>
          <p className="subtitle">
            Cada respuesta de cada modelo, con menciones, citaciones y fan-out. Haz clic para
            desplegar.
          </p>
        </div>
        <div style={{ width: 280 }}>
          <label>Ejecución</label>
          <select value={runId ?? ""} onChange={(e) => load(Number(e.target.value))}>
            {data.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.started_at).toLocaleString("es-ES", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                — {r.note}
              </option>
            ))}
          </select>
        </div>
      </div>

      {data.responses.map((r) => {
        const isOpen = open.has(r.id);
        const ownMentioned = r.brands.some((b) => b.is_own);
        return (
          <div className="panel" key={r.id} style={{ cursor: "pointer" }} onClick={() => toggle(r.id)}>
            {/* Cabecera siempre visible: prompt + chips resumen */}
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="badge">{r.model_label}</span>
                  {r.error ? (
                    <span className="badge" style={{ color: "var(--bad)" }}>error</span>
                  ) : (
                    <>
                      <Chip ok={ownMentioned} label={ownMentioned ? "Mencionado" : "No mencionado"} />
                      <Chip ok={r.citations.some((c) => c.is_own)} label={`${r.citations.length} citas`} />
                      {r.fanoutQueries.length > 0 && (
                        <span className="badge">{r.fanoutQueries.length} fan-out</span>
                      )}
                    </>
                  )}
                </div>
                <p style={{ fontWeight: 600, marginTop: 10 }}>{r.prompt_text}</p>
              </div>
              <span style={{ color: "var(--muted)", fontSize: 18, paddingLeft: 12 }}>
                {isOpen ? "▾" : "▸"}
              </span>
            </div>

            {/* Detalle expandible */}
            {isOpen && (
              <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 16, cursor: "default" }}>
                {r.error ? (
                  <p style={{ color: "var(--bad)" }}>⚠ {r.error}</p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
                    {/* Columna izquierda: respuesta */}
                    <div>
                      <h4 style={{ margin: "0 0 8px" }}>Respuesta</h4>
                      <div
                        style={{
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.6,
                          maxHeight: 360,
                          overflowY: "auto",
                          fontSize: 14,
                          background: "var(--panel-2, #1a1e27)",
                          borderRadius: 8,
                          padding: 12,
                        }}
                        dangerouslySetInnerHTML={{
                          __html: highlight(r.raw_text, r.brands.map((b) => b.name)),
                        }}
                      />
                    </div>

                    {/* Columna derecha: menciones, citas, fan-out, entidades */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      <Section title="Menciones">
                        {r.brands.length === 0 ? (
                          <Muted>Ninguna marca conocida mencionada.</Muted>
                        ) : (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {r.brands.map((b, i) => (
                              <span key={i} className={`badge ${b.is_own ? "own" : ""}`}>{b.name}</span>
                            ))}
                          </div>
                        )}
                      </Section>

                      <Section title={`Citaciones (${r.citations.length})`}>
                        {r.citations.length === 0 ? (
                          <Muted>Sin citas (modelo sin búsqueda web o no las expuso).</Muted>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                            {r.citations.map((c, i) => (
                              <li key={i} style={{ marginBottom: 4 }}>
                                {c.url ? (
                                  <a href={c.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                                    {c.domain}
                                  </a>
                                ) : (
                                  c.domain
                                )}
                                {c.is_own && <span className="badge own" style={{ marginLeft: 6 }}>tú</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Section>

                      <Section title="Fan Out Queries">
                        {r.fanoutQueries.length === 0 ? (
                          <Muted>Sin fan-out (solo Gemini las aporta).</Muted>
                        ) : (
                          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                            {r.fanoutQueries.map((q, i) => (
                              <li key={i} style={{ marginBottom: 4 }}>{q}</li>
                            ))}
                          </ol>
                        )}
                      </Section>

                      <Section title={`Entidades de marca (${r.entities.length})`}>
                        {r.entities.length === 0 ? (
                          <Muted>Sin analizar. Pulsa “Ejecutar llamada API y analizar” en el Dashboard.</Muted>
                        ) : (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {r.entities.map((e, i) => (
                              <span
                                key={i}
                                className={`badge ${e.isOwn ? "own" : ""}`}
                                title={e.isOwn ? "tu marca" : e.isKnown ? "competidor conocido" : "marca nueva"}
                              >
                                {e.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </Section>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="badge"
      style={{ background: ok ? "var(--good-soft, #14361f)" : "transparent", color: ok ? "var(--good, #34d399)" : "var(--muted)" }}
    >
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 style={{ margin: "0 0 6px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" }}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{children}</p>;
}

// Resalta las marcas mencionadas en el texto (escapando HTML primero).
function highlight(text: string, brands: string[]): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  for (const b of brands) {
    const safe = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
  }
  return html;
}
