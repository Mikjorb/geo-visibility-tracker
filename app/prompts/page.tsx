"use client";

import { useEffect, useState } from "react";

interface Prompt {
  id: number;
  text: string;
  market: string;
  language: string;
  query_type: string;
  brand_focus: string;
  active: boolean;
}
interface Model {
  id: number;
  provider: string;
  model_name: string;
  label: string;
  web_search_enabled: boolean;
  active: boolean;
}
interface Platform {
  id: number;
  name: string;
  kind: string;
  reference: string | null;
  active: boolean;
}
interface Config {
  prompts: Prompt[];
  models: Model[];
  platforms: Platform[];
}

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null);

  async function load() {
    const res = await fetch("/api/config");
    setCfg(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function create(entity: string, data: Record<string, unknown>) {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, data }),
    });
    if (res.ok) load();
    else alert((await res.json()).error || "Error");
  }

  async function remove(entity: string, id: number) {
    if (!confirm("¿Eliminar?")) return;
    await fetch("/api/config", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity, id }),
    });
    load();
  }

  if (!cfg) return <p className="subtitle">Cargando…</p>;

  return (
    <>
      <h1>Configuración</h1>
      <p className="subtitle">
        Los prompts a monitorizar, los modelos LLM y las plataformas de análisis. Las marcas se
        gestionan en el <a href="/dashboard" style={{ color: "var(--accent)" }}>Dashboard</a>.
      </p>

      {/* ---------- PROMPTS (form arriba) ---------- */}
      <h2>Prompts</h2>
      <div className="panel">
        <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Añade un prompt manual o genera el set desde la auditoría (Claude Code · <code>/api/suggest-prompts</code>).
        </p>
        <PromptForm onCreate={(d) => create("prompt", d)} />
        <table style={{ marginTop: 20 }}>
          <thead>
            <tr>
              <th>Texto</th>
              <th>Categoría</th>
              <th>Mercado</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cfg.prompts.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                <td>{p.text}</td>
                <td>
                  <span className="badge">{p.query_type}</span>{" "}
                  <span className={`badge ${p.brand_focus === "Own Brand" ? "own" : ""}`}>
                    {p.brand_focus}
                  </span>
                </td>
                <td>
                  <span className="badge">
                    {p.market} / {p.language}
                  </span>
                </td>
                <td style={{ color: "var(--muted)", fontSize: 12 }}>
                  {p.active ? "activo" : "inactivo"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button className="danger" onClick={() => remove("prompt", p.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- MODELOS LLM ---------- */}
      <h2>Modelos LLM</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Etiqueta</th>
              <th>Proveedor</th>
              <th>Modelo</th>
              <th>Web</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cfg.models.map((m) => (
              <tr key={m.id} style={{ opacity: m.active ? 1 : 0.5 }}>
                <td>{m.label}</td>
                <td>
                  <span className="badge">{m.provider}</span>
                </td>
                <td style={{ color: "var(--muted)" }}>{m.model_name}</td>
                <td>{m.web_search_enabled ? "✓" : "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="danger" onClick={() => remove("model", m.id)}>
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ModelForm onCreate={(d) => create("model", d)} />
      </div>

      {/* ---------- PLATAFORMAS DE ANÁLISIS (trackings, opcional) ---------- */}
      <h2>Plataformas de análisis (opcional)</h2>
      <div className="panel">
        <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          Fuentes de datos para enriquecer el análisis GEO (Search Console, Analytics, Ahrefs…). La
          integración la ejecuta Claude Code; aquí declaras qué plataformas usas.
        </p>
        <table>
          <thead>
            <tr>
              <th>Plataforma</th>
              <th>Tipo</th>
              <th>Referencia</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cfg.platforms.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  Sin plataformas. Añade una abajo.
                </td>
              </tr>
            ) : (
              cfg.platforms.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <span className="badge">{p.kind}</span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{p.reference || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="danger" onClick={() => remove("platform", p.id)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <PlatformForm onCreate={(d) => create("platform", d)} />
      </div>
    </>
  );
}

function PromptForm({ onCreate }: { onCreate: (d: Record<string, unknown>) => void }) {
  const [text, setText] = useState("");
  const [market, setMarket] = useState("ES");
  const [language] = useState("es");
  const [queryType, setQueryType] = useState("Commercial");
  const [brandFocus, setBrandFocus] = useState("Non-Brand");
  return (
    <div className="row">
      <div style={{ flex: 4 }}>
        <label>Prompt</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="¿Cuáles son las mejores impresoras 3D profesionales para una empresa?"
        />
      </div>
      <div style={{ width: 150 }}>
        <label>Query Type</label>
        <select value={queryType} onChange={(e) => setQueryType(e.target.value)}>
          <option>Commercial</option>
          <option>Informational</option>
          <option>Transactional</option>
          <option>Navigational</option>
        </select>
      </div>
      <div style={{ width: 130 }}>
        <label>Brand Focus</label>
        <select value={brandFocus} onChange={(e) => setBrandFocus(e.target.value)}>
          <option>Non-Brand</option>
          <option>Own Brand</option>
          <option>Competitor</option>
        </select>
      </div>
      <div style={{ width: 70 }}>
        <label>Mercado</label>
        <input value={market} onChange={(e) => setMarket(e.target.value)} />
      </div>
      <button
        onClick={() => {
          if (!text) return;
          onCreate({ text, market, language, query_type: queryType, brand_focus: brandFocus });
          setText("");
        }}
      >
        Añadir
      </button>
    </div>
  );
}

function ModelForm({ onCreate }: { onCreate: (d: Record<string, unknown>) => void }) {
  const [provider, setProvider] = useState("openai");
  const [modelName, setModelName] = useState("");
  const [label, setLabel] = useState("");
  const [web, setWeb] = useState(false);
  return (
    <div className="row" style={{ marginTop: 16 }}>
      <div>
        <label>Proveedor</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="openai">openai</option>
          <option value="perplexity">perplexity</option>
          <option value="gemini">gemini</option>
        </select>
      </div>
      <div style={{ flex: 2 }}>
        <label>Modelo (id de la API)</label>
        <input
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder="gpt-4o-mini"
        />
      </div>
      <div style={{ flex: 2 }}>
        <label>Etiqueta (visible)</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ChatGPT" />
      </div>
      <div>
        <label>
          <input
            type="checkbox"
            checked={web}
            onChange={(e) => setWeb(e.target.checked)}
            style={{ width: "auto", marginRight: 6 }}
          />
          Búsqueda web
        </label>
      </div>
      <button
        onClick={() => {
          if (!modelName) return;
          onCreate({ provider, model_name: modelName, label, web_search_enabled: web });
          setModelName("");
          setLabel("");
          setWeb(false);
        }}
      >
        Añadir
      </button>
    </div>
  );
}

function PlatformForm({ onCreate }: { onCreate: (d: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("search-console");
  const [reference, setReference] = useState("");
  return (
    <div className="row" style={{ marginTop: 16 }}>
      <div style={{ flex: 2 }}>
        <label>Plataforma</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Google Search Console" />
      </div>
      <div style={{ width: 170 }}>
        <label>Tipo</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="search-console">search-console</option>
          <option value="analytics">analytics</option>
          <option value="seo">seo</option>
          <option value="ai">ai</option>
          <option value="other">other</option>
        </select>
      </div>
      <div style={{ flex: 2 }}>
        <label>Referencia (propiedad/ID)</label>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="sc-domain:example.com"
        />
      </div>
      <button
        onClick={() => {
          if (!name) return;
          onCreate({ name, kind, reference });
          setName("");
          setReference("");
        }}
      >
        Añadir
      </button>
    </div>
  );
}
