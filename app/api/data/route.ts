import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  mentionRate,
  shareOfVoice,
  averagePosition,
  aiVisibilityScore,
  sentimentSummary,
  round1,
  MentionRow,
} from "@/lib/analyze";

export const runtime = "nodejs";

// Métricas del dashboard, alineadas con LLMPulse.
export async function GET() {
  // Menciones de la última ejecución terminada.
  const lastRun = await query<{ id: number; started_at: string }>(
    "SELECT id, started_at FROM runs WHERE status <> 'running' ORDER BY started_at DESC LIMIT 1"
  );
  if (lastRun.length === 0) return NextResponse.json({ latest: null, history: [] });
  const runId = lastRun[0].id;

  // Filas de menciones (todas las marcas) de las respuestas SIN error de esa ejecución.
  const rows = await query<{
    response_id: number;
    model_label: string;
    brand_id: number;
    brand_name: string;
    is_own: boolean;
    mentioned: boolean;
    rank: number | null;
    sentiment: number | null;
  }>(
    `SELECT mt.response_id, m.label AS model_label,
            b.id AS brand_id, b.name AS brand_name, b.is_own,
            mt.mentioned, mt.rank, mt.sentiment
     FROM mentions mt
     JOIN responses resp ON resp.id = mt.response_id
     JOIN models m ON m.id = resp.model_id
     JOIN brands b ON b.id = mt.brand_id
     WHERE resp.run_id = $1 AND resp.error IS NULL`,
    [runId]
  );

  // Agrupar por respuesta.
  const byResponse = new Map<number, { model: string; rows: MentionRow[] }>();
  for (const r of rows) {
    if (!byResponse.has(r.response_id))
      byResponse.set(r.response_id, { model: r.model_label, rows: [] });
    byResponse.get(r.response_id)!.rows.push(r);
  }
  const rowsByResponse = [...byResponse.values()].map((v) => v.rows);
  const allRows: MentionRow[] = rows;

  // Citas de la ejecución.
  const cites = await query<{ domain: string; is_own: boolean }>(
    `SELECT c.domain, c.is_own
     FROM citations c JOIN responses resp ON resp.id = c.response_id
     WHERE resp.run_id = $1 AND resp.error IS NULL`,
    [runId]
  );
  const totalResponses = byResponse.size;
  const citationEligible = await query<{ n: string }>(
    `SELECT COUNT(*) AS n
     FROM responses resp JOIN models m ON m.id = resp.model_id
     WHERE resp.run_id = $1 AND resp.error IS NULL
       AND (m.web_search_enabled = TRUE OR m.provider = 'perplexity')`,
    [runId]
  );
  const citationEligibleResponses = Number(citationEligible[0]?.n ?? 0);
  const ownCitationResponses = await query<{ n: string }>(
    `SELECT COUNT(DISTINCT resp.id) AS n
     FROM citations c JOIN responses resp ON resp.id = c.response_id
     WHERE resp.run_id = $1 AND c.is_own = TRUE`,
    [runId]
  );

  // Top dominios citados (conservando si el dominio es el propio).
  const domainCounts = new Map<string, { count: number; isOwn: boolean }>();
  for (const c of cites) {
    const entry = domainCounts.get(c.domain) ?? { count: 0, isOwn: false };
    entry.count += 1;
    entry.isOwn = entry.isOwn || c.is_own;
    domainCounts.set(c.domain, entry);
  }
  const topDomains = [...domainCounts.entries()]
    .map(([domain, { count, isOwn }]) => ({ domain, count, isOwn }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Métricas principales.
  const sov = shareOfVoice(allRows);
  const ownMentions = allRows.filter((r) => r.is_own && r.mentioned).length;
  const ownCites = Number(ownCitationResponses[0]?.n ?? 0);

  // Sentimiento de la marca propia (solo menciones donde aparece). Los valores
  // 1-5 los escribe Claude en sesión; aquí solo se agregan.
  const ownMentionRows = rows.filter((r) => r.is_own && r.mentioned);
  const sentiment = sentimentSummary(ownMentionRows.map((r) => r.sentiment));
  const sentimentPending = ownMentionRows.filter((r) => r.sentiment == null).length;

  // Entidades de marca descubiertas por Claude en esta ejecución: cuántas
  // respuestas mencionan cada marca (canónica). Construye el "grafo" de marcas.
  const entityRows = await query<{
    canonical_name: string;
    raw_name: string;
    is_own: boolean;
    is_known: boolean;
    responses: string;
  }>(
    `SELECT e.canonical_name,
            MIN(e.raw_name) AS raw_name,
            bool_or(e.is_own) AS is_own,
            bool_or(e.is_known) AS is_known,
            COUNT(DISTINCT e.response_id) AS responses
     FROM entities e JOIN responses resp ON resp.id = e.response_id
     WHERE resp.run_id = $1 AND resp.error IS NULL
     GROUP BY e.canonical_name
     ORDER BY responses DESC, raw_name ASC
     LIMIT 30`,
    [runId]
  );
  const entities = entityRows.map((e) => ({
    name: e.raw_name,
    isOwn: e.is_own,
    isKnown: e.is_known,
    responses: Number(e.responses),
  }));

  // Fan-out queries de la ejecución (las sub-búsquedas del modelo, solo Gemini).
  const fanoutRows = await query<{ query: string; n: string }>(
    `SELECT fq.query, COUNT(*) AS n
     FROM fanout_queries fq JOIN responses resp ON resp.id = fq.response_id
     WHERE resp.run_id = $1 AND resp.error IS NULL
     GROUP BY fq.query
     ORDER BY n DESC, fq.query ASC
     LIMIT 30`,
    [runId]
  );
  const fanoutQueries = fanoutRows.map((f) => ({
    query: f.query,
    count: Number(f.n),
  }));

  // ¿Quedan respuestas sin analizar con Claude?
  const pending = await query<{ n: string }>(
    "SELECT COUNT(*) AS n FROM responses WHERE error IS NULL AND analyzed_at IS NULL"
  );

  // Histórico (Mention Rate y AI Visibility Score por ejecución).
  const history = await buildHistory();

  return NextResponse.json({
    latest: {
      date: lastRun[0].started_at,
      responses: totalResponses,
      brandMentions: ownMentions,
      mentionRate: mentionRate(rowsByResponse),
      aiVisibilityScore: aiVisibilityScore(rowsByResponse),
      averagePosition: averagePosition(allRows),
      citations: ownCites,
      citationEligibleResponses,
      citationRate: citationEligibleResponses
        ? round1((ownCites / citationEligibleResponses) * 100)
        : 0,
      sentiment,
      sentimentPending,
      pendingAnalysis: Number(pending[0]?.n ?? 0),
      shareOfVoice: sov,
      topDomains,
      entities,
      fanoutQueries,
    },
    history,
  });
}

// Serie temporal: para cada run terminado, Mention Rate y AI Visibility Score.
async function buildHistory() {
  const rows = await query<{
    run_id: number;
    started_at: string;
    panel_fingerprint: string | null;
    response_id: number;
    is_own: boolean;
    mentioned: boolean;
    rank: number | null;
    brand_name: string;
    sentiment: number | null;
  }>(
    `SELECT r.id AS run_id, r.started_at, r.panel_fingerprint, mt.response_id,
            b.is_own, mt.mentioned, mt.rank, b.name AS brand_name, mt.sentiment
     FROM mentions mt
     JOIN responses resp ON resp.id = mt.response_id
     JOIN runs r ON r.id = resp.run_id
     JOIN brands b ON b.id = mt.brand_id
     WHERE r.status <> 'running' AND resp.error IS NULL
     ORDER BY r.started_at ASC`
  );

  const byRun = new Map<
    number,
    { date: string; panelFingerprint: string | null; responses: Map<number, MentionRow[]>; sentiments: (number | null)[] }
  >();
  for (const r of rows) {
    if (!byRun.has(r.run_id))
      byRun.set(r.run_id, { date: r.started_at, panelFingerprint: r.panel_fingerprint, responses: new Map(), sentiments: [] });
    const run = byRun.get(r.run_id)!;
    if (!run.responses.has(r.response_id)) run.responses.set(r.response_id, []);
    run.responses.get(r.response_id)!.push({
      brand_id: 0,
      brand_name: r.brand_name,
      is_own: r.is_own,
      mentioned: r.mentioned,
      rank: r.rank,
    });
    if (r.is_own && r.mentioned) run.sentiments.push(r.sentiment);
  }

  return [...byRun.entries()].map(([runId, v]) => {
    const rbr = [...v.responses.values()];
    return {
      runId,
      date: v.date,
      panelFingerprint: v.panelFingerprint,
      mentionRate: mentionRate(rbr),
      aiVisibilityScore: aiVisibilityScore(rbr),
      sentimentScore: sentimentSummary(v.sentiments).score,
    };
  });
}
