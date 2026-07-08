"use client";

import { useEffect, useState } from "react";

interface Rec {
  id: number;
  priority: number;
  category: string;
  title: string;
  action: string;
  rationale: string;
  done: boolean;
}

const PRIORITY = {
  1: { label: "Alta", color: "#f87171" },
  2: { label: "Media", color: "#fbbf24" },
  3: { label: "Baja", color: "#60a5fa" },
} as const;

// Contexto de tu proyecto para los prompts de tareas exportadas a Claude Code.
// Rellénalo una vez con los datos de tu negocio/sitio; las secciones vacías se
// omiten del prompt generado.
const PROJECT_CONTEXT = {
  // p.ej. "Acme Corp (SaaS de analítica para e-commerce; tienda en Shopify)"
  summary: "",
  // Restricciones que Claude debe respetar al tocar tu sitio,
  // p.ej. "El tema ya carga sus propias fuentes: nunca importar fuentes externas."
  technicalConstraints: [] as string[],
  // URLs propias que ya funcionan bien en IA, como patrón a replicar,
  // p.ej. "https://example.com/blog/comparativa-producto-a-vs-b"
  referencePages: [] as string[],
};

// Prompt autocontenido para pegar en una sesión nueva de Claude Code: contexto
// de negocio + recomendación + restricciones técnicas + páginas de referencia.
function buildClaudeCodePrompt(r: Rec): string {
  const priorityLabel = PRIORITY[r.priority as 1 | 2 | 3]?.label ?? "Media";
  const intro = PROJECT_CONTEXT.summary
    ? `Quiero trabajar en esta recomendación GEO de ${PROJECT_CONTEXT.summary}.`
    : "Quiero trabajar en esta recomendación GEO de mi negocio.";

  const sections = [
    intro,
    `RECOMENDACIÓN (prioridad ${priorityLabel}, categoría ${r.category})\n${r.title}`,
    `QUÉ HACER\n${r.action}`,
    `POR QUÉ (hueco real detectado sobre el histórico de respuestas de IA)\n${r.rationale}`,
  ];
  if (PROJECT_CONTEXT.technicalConstraints.length > 0) {
    sections.push(
      `RESTRICCIONES TÉCNICAS DEL SITIO\n${PROJECT_CONTEXT.technicalConstraints
        .map((c) => `- ${c}`)
        .join("\n")}`
    );
  }
  if (PROJECT_CONTEXT.referencePages.length > 0) {
    sections.push(
      `PÁGINAS DE REFERENCIA QUE YA FUNCIONAN BIEN (mismo tono/patrón a replicar)\n${PROJECT_CONTEXT.referencePages
        .map((u) => `- ${u}`)
        .join("\n")}`
    );
  }
  sections.push("Ayúdame a implementarlo.");
  return sections.join("\n\n");
}

export default function RecommendationsPage() {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/recommendations");
    const json = await res.json();
    setRecs(json.recommendations ?? []);
    setUpdatedAt(json.updatedAt ?? null);
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(r: Rec) {
    setRecs((prev) => prev?.map((x) => (x.id === r.id ? { ...x, done: !x.done } : x)) ?? null);
    await fetch("/api/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, done: !r.done }),
    });
  }

  const pending = recs?.filter((r) => !r.done) ?? [];
  const done = recs?.filter((r) => r.done) ?? [];

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Acciones para más visibilidad en IA</h1>
          <p className="subtitle">
            Tareas concretas para que los LLMs te mencionen y citen más, según los huecos
            detectados en todo el histórico de ejecuciones.
          </p>
        </div>
        {updatedAt && (
          <div style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "nowrap" }}>
            Última actualización:{" "}
            {new Date(updatedAt).toLocaleDateString("es-ES", { dateStyle: "medium" })}
          </div>
        )}
      </div>

      {recs === null ? (
        <p className="subtitle">Cargando…</p>
      ) : recs.length === 0 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          Aún no hay recomendaciones. Pide en una sesión de Claude Code que{" "}
          <b>analice los huecos de visibilidad y actualice las recomendaciones</b> — lee el
          histórico completo (sin coste de API) y las escribe directamente. (Necesitas al menos una
          ejecución con respuestas; lánzala desde el{" "}
          <a href="/dashboard" style={{ color: "var(--accent)" }}>
            Dashboard
          </a>
          .)
        </div>
      ) : (
        <>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {pending.map((r) => (
              <RecCard key={r.id} r={r} onToggle={() => toggle(r)} />
            ))}
          </div>

          {done.length > 0 && (
            <>
              <h2 style={{ marginTop: 28, color: "var(--muted)" }}>Completadas ({done.length})</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: 0.6 }}>
                {done.map((r) => (
                  <RecCard key={r.id} r={r} onToggle={() => toggle(r)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function RecCard({ r, onToggle }: { r: Rec; onToggle: () => void }) {
  const p = PRIORITY[r.priority as 1 | 2 | 3] ?? PRIORITY[2];
  const [copied, setCopied] = useState(false);

  async function copyForClaudeCode() {
    await navigator.clipboard.writeText(buildClaudeCodePrompt(r));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="panel" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <input
        type="checkbox"
        checked={r.done}
        onChange={onToggle}
        style={{ marginTop: 4, width: 18, height: 18, cursor: "pointer", flexShrink: 0 }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span
            className="badge"
            style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}55` }}
          >
            {p.label}
          </span>
          <span className="badge">{r.category}</span>
          <strong style={{ textDecoration: r.done ? "line-through" : "none" }}>{r.title}</strong>
        </div>
        <p style={{ marginTop: 8, lineHeight: 1.55 }}>{r.action}</p>
        {r.rationale && (
          <p style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
            <b>Por qué:</b> {r.rationale}
          </p>
        )}
        <button
          className="secondary"
          onClick={copyForClaudeCode}
          style={{ marginTop: 10, fontSize: 13, padding: "6px 12px" }}
          title="Copia esta tarea como prompt autocontenido para pegar en una sesión nueva de Claude Code"
        >
          {copied ? "✓ Copiado" : "📋 Copiar tarea para Claude Code"}
        </button>
      </div>
    </div>
  );
}
