"use client";

import { useEffect, useState } from "react";
import BrandsManager from "../components/BrandsManager";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface SovRow {
  brand: string;
  isOwn: boolean;
  mentions: number;
  share: number;
}
interface GeoRecommendation {
  title: string;
  action?: string;
  impact?: string;
  effort?: string;
}
interface GeoAudit {
  id: number;
  domain: string;
  score: number;
  dimensions: Record<string, number>;
  crawler_access: Record<string, string>;
  llms_txt_status: string | null;
  platform_scores: Record<string, number>;
  recommendations: GeoRecommendation[];
  created_at: string;
}
interface Sentiment {
  score: number | null; // 0-100 (null = sin analizar)
  positive: number;
  neutral: number;
  negative: number;
  analyzed: number;
}
interface DashboardData {
  history: {
    runId: number;
    date: string;
    panelFingerprint: string | null;
    mentionRate: number;
    aiVisibilityScore: number;
    sentimentScore: number | null;
  }[];
  latest: {
    date: string;
    responses: number;
    brandMentions: number;
    mentionRate: number;
    aiVisibilityScore: number;
    averagePosition: number | null;
    citations: number;
    citationEligibleResponses: number;
    citationRate: number;
    sentiment: Sentiment;
    sentimentPending: number;
    pendingAnalysis: number;
    shareOfVoice: SovRow[];
    topDomains: { domain: string; count: number; isOwn: boolean }[];
    entities: { name: string; isOwn: boolean; isKnown: boolean; responses: number }[];
    fanoutQueries: { query: string; count: number }[];
  } | null;
}

const AXIS = "#9aa3b2";
const GRID = "#2a2f3a";
const tooltipStyle = {
  background: "#1e222b",
  border: "1px solid #2a2f3a",
  borderRadius: 8,
  color: "#e6e8ec",
  fontSize: 13,
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [geoAudits, setGeoAudits] = useState<GeoAudit[] | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function load() {
    const res = await fetch("/api/data");
    setData(await res.json());
    const geoRes = await fetch("/api/geo-audit");
    const geoJson = await geoRes.json();
    setGeoAudits(geoJson.audits ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  // Llama a los proveedores medidos (Gemini/OpenAI/Perplexity) y analiza cada
  // respuesta por regex (menciones/citas/fan-out). La extracción de entidades
  // con Claude no es automática: se hace en una sesión de Claude Code, sin
  // coste de API, cuando se pide expresamente.
  async function runAndAnalyze() {
    setRunning(true);
    setToast(null);
    try {
      const res = await fetch("/api/run", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error");
      setToast({
        kind: "ok",
        msg: `Ejecución completada: ${json.ok} respuestas, ${json.failed} con error.`,
      });
      await load();
    } catch (err: any) {
      setToast({ kind: "err", msg: err.message });
    } finally {
      setRunning(false);
    }
  }

  const l = data?.latest;
  const historyComparable = !!data && data.history.length > 0 &&
    data.history.every((h) => h.panelFingerprint) &&
    new Set(data.history.map((h) => h.panelFingerprint)).size === 1;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">
            Visibilidad de tu marca en respuestas de IA frente a competidores.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={runAndAnalyze} disabled={running}>
            {running ? "Ejecutando y analizando…" : "▶ Ejecutar llamada API y analizar"}
          </button>
        </div>
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

      {/* GEO Readiness: diagnóstico técnico (causa) que complementa la visibilidad (resultado).
          Va primero a propósito: explica el "por qué" antes de mostrar el "qué" (las métricas). */}
      {geoAudits && geoAudits.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2 style={{ marginBottom: 0 }}>GEO Readiness</h2>
          <p className="subtitle" style={{ marginTop: -8 }}>
            Salud técnica de cara a crawlers de IA y citabilidad (auditoría seo-geo). Explica el
            &quot;por qué&quot; detrás de las métricas de visibilidad.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
            {geoAudits.map((audit) => (
              <GeoAuditCard key={audit.domain} audit={audit} />
            ))}
          </div>
        </div>
      )}

      {!l ? (
        <div className="empty" style={{ marginTop: 24 }}>
          Aún no hay datos. Revisa la{" "}
          <a href="/prompts" style={{ color: "var(--accent)" }}>
            Configuración
          </a>{" "}
          y pulsa <b>Ejecutar ahora</b>.
        </div>
      ) : (
        <>
          <div className="cards" style={{ marginTop: 16 }}>
            <Card label="AI Visibility Score" value={`${l.aiVisibilityScore}`} hint="escala 0–1000" />
            <Card label="Mention Rate" value={`${l.mentionRate}%`} hint={`${l.brandMentions} menciones`} />
            <Card label="Citation Rate" value={`${l.citationRate}%`} hint={`${l.citations}/${l.citationEligibleResponses} respuestas elegibles`} />
            <Card
              label="Orden medio de mención"
              value={l.averagePosition == null ? "—" : `${l.averagePosition}`}
              hint="primera aparición al mencionarse"
            />
            <Card
              label="Sentimiento de marca"
              value={l.sentiment.score == null ? "—" : `${l.sentiment.score}/100`}
              hint={
                l.sentiment.analyzed === 0
                  ? l.sentimentPending > 0
                    ? `${l.sentimentPending} menciones sin analizar`
                    : "sin menciones"
                  : `${l.sentiment.positive}👍 ${l.sentiment.neutral}· ${l.sentiment.negative}👎` +
                    (l.sentimentPending > 0 ? ` · ${l.sentimentPending} pdte.` : "")
              }
            />
          </div>

          <h2>Evolución</h2>
          {!historyComparable && data!.history.length > 1 && (
            <div className="toast err" style={{ marginBottom: 12 }}>
              Serie orientativa: incluye runs legacy o paneles diferentes. Compara únicamente
              ejecuciones con el mismo fingerprint.
            </div>
          )}
          <div className="panel">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data!.history.map(fmtHistory)}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={AXIS} fontSize={12} />
                <YAxis yAxisId="l" stroke={AXIS} fontSize={12} domain={[0, 100]} unit="%" />
                <YAxis yAxisId="r" orientation="right" stroke={AXIS} fontSize={12} domain={[0, 1000]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line yAxisId="l" type="monotone" dataKey="Mention Rate" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="l" type="monotone" dataKey="Sentiment Score" stroke="#f5a623" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line yAxisId="r" type="monotone" dataKey="AI Visibility Score" stroke="#4f8cff" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            {/* Share of Voice ranking */}
            <div className="panel">
              <h3>Share of Voice (tú vs competidores)</h3>
              {l.shareOfVoice.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>Ninguna marca mencionada.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Marca</th>
                      <th style={{ textAlign: "right" }}>Menciones</th>
                      <th style={{ textAlign: "right" }}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.shareOfVoice.map((b, i) => (
                      <tr key={b.brand}>
                        <td>{i + 1}</td>
                        <td>
                          <span className={`badge ${b.isOwn ? "own" : ""}`}>{b.brand}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>{b.mentions}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{b.share}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Top dominios citados */}
            <div className="panel">
              <h3>Dominios más citados por la IA</h3>
              {l.topDomains.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>
                  Sin citas. Los modelos con búsqueda web (Perplexity, Gemini grounding) las aportan.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, l.topDomains.length * 34)}>
                  <BarChart data={l.topDomains} layout="vertical">
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis type="number" stroke={AXIS} fontSize={12} allowDecimals={false} />
                    <YAxis type="category" dataKey="domain" stroke={AXIS} fontSize={11} width={130} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {l.topDomains.map((d, i) => (
                        <Cell key={i} fill={d.isOwn ? "#34d399" : "#5b6472"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            {/* Entidades de marca descubiertas por Claude */}
            <div className="panel">
              <h3>Entidades de marca en el grafo de la IA</h3>
              {l.entities.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>
                  Sin entidades. Pulsa <b>▶ Ejecutar llamada API y analizar</b> para descubrir todas
                  las marcas que aparecen en las respuestas.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Marca</th>
                      <th></th>
                      <th style={{ textAlign: "right" }}>Respuestas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.entities.map((e) => (
                      <tr key={e.name}>
                        <td>
                          <span className={`badge ${e.isOwn ? "own" : ""}`}>{e.name}</span>
                        </td>
                        <td style={{ color: "var(--muted)", fontSize: 12 }}>
                          {e.isOwn ? "tú" : e.isKnown ? "competidor" : "nueva"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{e.responses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Fan-out queries (cómo busca el LLM) */}
            <div className="panel">
              <h3>Fan-out: cómo busca el LLM</h3>
              {l.fanoutQueries.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>
                  Sin fan-out. Solo Gemini (con grounding) expone las sub-búsquedas que lanza para
                  responder.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Sub-búsqueda del modelo</th>
                      <th style={{ textAlign: "right" }}>Veces</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.fanoutQueries.map((f) => (
                      <tr key={f.query}>
                        <td>{f.query}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{f.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      <h2 style={{ marginTop: 28 }}>Marcas</h2>
      <BrandsManager />
    </>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="delta flat">{hint}</div>
    </div>
  );
}

function GeoAuditCard({ audit }: { audit: GeoAudit }) {
  const scoreColor =
    audit.score >= 70 ? "var(--good)" : audit.score >= 40 ? "var(--warn)" : "var(--bad)";
  const dims = Object.entries(audit.dimensions ?? {});
  const crawlers = Object.entries(audit.crawler_access ?? {});

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{audit.domain}</h3>
        <span style={{ fontSize: 22, fontWeight: 700, color: scoreColor }}>{audit.score}/100</span>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
        Auditado {new Date(audit.created_at).toLocaleDateString("es-ES", { dateStyle: "medium" })}
        {audit.llms_txt_status && ` · llms.txt: ${audit.llms_txt_status}`}
      </div>

      {dims.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {dims.map(([name, val]) => (
            <div key={name} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
                <span>{name}</span>
                <span>{val}/100</span>
              </div>
              <div style={{ background: "var(--panel-2)", borderRadius: 4, height: 6 }}>
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, val))}%`,
                    background: "var(--accent)",
                    height: 6,
                    borderRadius: 4,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {crawlers.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {crawlers.map(([bot, status]) => (
            <span
              key={bot}
              className="badge"
              style={{
                color: status === "allowed" ? "var(--good)" : "var(--bad)",
                borderColor: status === "allowed" ? "var(--good)" : "var(--bad)",
              }}
            >
              {bot}: {status}
            </span>
          ))}
        </div>
      )}

      {audit.recommendations?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
            Top recomendaciones
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {audit.recommendations.slice(0, 5).map((r, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {r.title}
                {r.effort && <span style={{ color: "var(--muted)" }}> · esfuerzo: {r.effort}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function fmtHistory(h: {
  date: string;
  mentionRate: number;
  aiVisibilityScore: number;
  sentimentScore: number | null;
}) {
  return {
    label: new Date(h.date).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
    "Mention Rate": h.mentionRate,
    "Sentiment Score": h.sentimentScore,
    "AI Visibility Score": h.aiVisibilityScore,
  };
}
