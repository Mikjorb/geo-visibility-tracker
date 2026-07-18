#!/usr/bin/env node
// Servidor MCP del tracker (solo lectura). Expone los datos de visibilidad de
// marca en LLMs como herramientas para cualquier cliente MCP (Claude Desktop,
// Claude Code…). Acceso DIRECTO a Postgres: no necesita el server Next arrancado.
//
// Las fórmulas de métricas reflejan lib/analyze.ts (fuente de verdad).
//
// Uso (claude_desktop_config.json o Claude Code):
//   "geo-visibility-tracker": { "command": "node", "args": ["/ruta/abs/mcp/server.mjs"],
//                  "env": { "DATABASE_URL": "postgres://…" } }
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// --- Carga de DATABASE_URL (.env.local si no está en el entorno) ---
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});
const q = (text, params) => pool.query(text, params).then((r) => r.rows);
const round1 = (n) => Math.round(n * 10) / 10;

// Última ejecución terminada (o la indicada por runId).
async function resolveRunId(runId) {
  if (runId) return runId;
  const r = await q("SELECT id FROM runs WHERE status <> 'running' ORDER BY started_at DESC LIMIT 1");
  return r[0]?.id ?? null;
}

// Filas de menciones (todas las marcas) de un run, agrupadas por respuesta.
async function mentionRows(runId) {
  return q(
    `SELECT mt.response_id, b.name AS brand_name, b.is_own, mt.mentioned, mt.rank, mt.sentiment
     FROM mentions mt JOIN responses resp ON resp.id = mt.response_id
     JOIN brands b ON b.id = mt.brand_id
     WHERE resp.run_id = $1 AND resp.error IS NULL`,
    [runId]
  );
}

// Resumen de sentimiento de la marca propia (refleja sentimentSummary de lib/analyze.ts).
// score 0-100 = (media-1)/4*100. pos 4-5, neutral 3, neg 1-2. score:null si no hay datos.
function sentimentSummary(sentiments) {
  const vals = sentiments.filter((s) => s != null);
  if (vals.length === 0)
    return { score: null, positive: 0, neutral: 0, negative: 0, analyzed: 0 };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    score: Math.round(((avg - 1) / 4) * 100),
    positive: vals.filter((s) => s >= 4).length,
    neutral: vals.filter((s) => s === 3).length,
    negative: vals.filter((s) => s <= 2).length,
    analyzed: vals.length,
  };
}

async function getVisibility(runId) {
  runId = await resolveRunId(runId);
  if (!runId) return { error: "No hay ninguna ejecución." };
  const rows = await mentionRows(runId);
  const byResp = new Map();
  for (const r of rows) {
    if (!byResp.has(r.response_id)) byResp.set(r.response_id, []);
    byResp.get(r.response_id).push(r);
  }
  const total = byResp.size;
  let hits = 0, vis = 0, ranks = [];
  for (const rs of byResp.values()) {
    const own = rs.find((r) => r.is_own && r.mentioned);
    if (own) { hits++; if (own.rank != null) { vis += 1 / own.rank; ranks.push(own.rank); } }
  }
  const ownCites = await q(
    `SELECT COUNT(DISTINCT resp.id) n FROM citations c JOIN responses resp ON resp.id = c.response_id
     WHERE resp.run_id = $1 AND c.is_own = TRUE`,
    [runId]
  );
  const cites = Number(ownCites[0]?.n ?? 0);
  const ownSentiments = rows
    .filter((r) => r.is_own && r.mentioned)
    .map((r) => r.sentiment);
  return {
    runId,
    responses: total,
    mentionRate: total ? round1((hits / total) * 100) : 0,
    citationRate: total ? round1((cites / total) * 100) : 0,
    aiVisibilityScore: total ? Math.round((vis / total) * 1000) : 0,
    averagePosition: ranks.length ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
    sentiment: sentimentSummary(ownSentiments),
    sentimentPending: ownSentiments.filter((s) => s == null).length,
  };
}

async function getShareOfVoice(runId) {
  runId = await resolveRunId(runId);
  if (!runId) return { error: "No hay ninguna ejecución." };
  const rows = (await mentionRows(runId)).filter((r) => r.mentioned);
  const total = rows.length;
  const byBrand = new Map();
  for (const r of rows) {
    const cur = byBrand.get(r.brand_name) ?? { isOwn: r.is_own, mentions: 0 };
    cur.mentions++; byBrand.set(r.brand_name, cur);
  }
  const ranking = [...byBrand.entries()]
    .map(([brand, v]) => ({ brand, isOwn: v.isOwn, mentions: v.mentions, share: total ? round1((v.mentions / total) * 100) : 0 }))
    .sort((a, b) => b.mentions - a.mentions);
  return { runId, totalMentions: total, ranking };
}

async function getRecommendations(runId) {
  runId = await resolveRunId(runId);
  if (!runId) return { error: "No hay ninguna ejecución." };
  const recs = await q(
    `SELECT priority, category, title, action, rationale, done
     FROM recommendations WHERE run_id = $1 ORDER BY done ASC, priority ASC, id ASC`,
    [runId]
  );
  return { runId, count: recs.length, recommendations: recs };
}

async function getEntities(runId) {
  runId = await resolveRunId(runId);
  if (!runId) return { error: "No hay ninguna ejecución." };
  const ents = await q(
    `SELECT canonical_name AS name, bool_or(is_own) AS is_own, bool_or(is_known) AS is_known,
            COUNT(DISTINCT response_id) AS responses
     FROM entities e JOIN responses r ON r.id = e.response_id
     WHERE r.run_id = $1 GROUP BY canonical_name ORDER BY responses DESC`,
    [runId]
  );
  return { runId, count: ents.length, entities: ents.map((e) => ({ ...e, responses: Number(e.responses) })) };
}

async function getGeoAudit(domain) {
  if (domain) {
    const history = await q(
      "SELECT * FROM geo_audits WHERE domain = $1 ORDER BY created_at DESC LIMIT 10",
      [domain]
    );
    if (history.length === 0) return { error: `Sin auditorías GEO para ${domain}.` };
    return { domain, latest: history[0], history };
  }
  const latest = await q(
    "SELECT DISTINCT ON (domain) * FROM geo_audits ORDER BY domain, created_at DESC"
  );
  if (latest.length === 0) return { error: "No hay ninguna auditoría GEO registrada todavía." };
  return { audits: latest };
}

async function listRuns() {
  const runs = await q(
    `SELECT r.id, r.started_at, r.status, r.note, COUNT(resp.id) AS responses
     FROM runs r LEFT JOIN responses resp ON resp.run_id = r.id
     GROUP BY r.id ORDER BY r.started_at DESC LIMIT 20`
  );
  return { runs: runs.map((r) => ({ ...r, responses: Number(r.responses) })) };
}

// --- Definición de herramientas MCP ---
const TOOLS = [
  { name: "get_visibility", description: "Métricas de visibilidad de la marca propia en la última ejecución (o runId): Mention Rate, Citation Rate, AI Visibility Score, posición media y sentimiento de marca (score 0-100 + reparto pos/neutral/neg).", handler: (a) => getVisibility(a.runId) },
  { name: "get_share_of_voice", description: "Share of Voice: ranking de menciones de tu marca frente a competidores en la última ejecución (o runId).", handler: (a) => getShareOfVoice(a.runId) },
  { name: "get_recommendations", description: "Lista de recomendaciones GEO (tareas para ganar visibilidad en IA) de la última ejecución (o runId).", handler: (a) => getRecommendations(a.runId) },
  { name: "get_entities", description: "Grafo de marcas: todas las entidades de marca detectadas en las respuestas de la última ejecución (o runId).", handler: (a) => getEntities(a.runId) },
  { name: "get_geo_audit", description: "Auditoría GEO técnica (agente seo-geo): score de salud, acceso de crawlers de IA, llms.txt y recomendaciones de un dominio (o de todos los auditados si se omite).", handler: (a) => getGeoAudit(a.domain) },
  { name: "list_runs", description: "Lista las últimas ejecuciones (id, fecha, estado, nº de respuestas).", handler: () => listRuns() },
];

const inputSchema = {
  type: "object",
  properties: { runId: { type: "number", description: "ID de ejecución; si se omite, usa la última terminada." } },
};
const geoInputSchema = {
  type: "object",
  properties: { domain: { type: "string", description: "Dominio a consultar, p.ej. example.com. Si se omite, devuelve la última auditoría de cada dominio." } },
};

const server = new Server({ name: "geo-visibility-tracker", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema:
      t.name === "list_runs" ? { type: "object", properties: {} } :
      t.name === "get_geo_audit" ? geoInputSchema :
      inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) throw new Error(`Herramienta desconocida: ${req.params.name}`);
  const result = await tool.handler(req.params.arguments ?? {});
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());
console.error("GEO Visibility Tracker MCP server listo (stdio).");
