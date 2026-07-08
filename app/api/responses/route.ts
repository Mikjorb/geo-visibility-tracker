import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// Devuelve las respuestas crudas de una ejecución (la última por defecto),
// junto con las marcas detectadas en cada una y la lista de ejecuciones.
export async function GET(req: NextRequest) {
  const runs = await query<{ id: number; started_at: string; note: string }>(
    "SELECT id, started_at, note FROM runs WHERE status <> 'running' ORDER BY started_at DESC LIMIT 30"
  );
  if (runs.length === 0) return NextResponse.json({ runs: [], responses: [] });

  const runId = Number(req.nextUrl.searchParams.get("runId")) || runs[0].id;

  const responses = await query<{
    id: number;
    prompt_text: string;
    model_label: string;
    raw_text: string;
    error: string | null;
  }>(
    `SELECT resp.id, p.text AS prompt_text, m.label AS model_label,
            resp.raw_text, resp.error
     FROM responses resp
     JOIN prompts p ON p.id = resp.prompt_id
     JOIN models m ON m.id = resp.model_id
     WHERE resp.run_id = $1
     ORDER BY resp.id`,
    [runId]
  );

  // Marcas mencionadas por respuesta.
  const mentions = await query<{
    response_id: number;
    name: string;
    is_own: boolean;
  }>(
    `SELECT mt.response_id, b.name, b.is_own
     FROM mentions mt JOIN brands b ON b.id = mt.brand_id
     JOIN responses resp ON resp.id = mt.response_id
     WHERE resp.run_id = $1 AND mt.mentioned = TRUE`,
    [runId]
  );

  const byResponse = new Map<number, { name: string; is_own: boolean }[]>();
  for (const m of mentions) {
    if (!byResponse.has(m.response_id)) byResponse.set(m.response_id, []);
    byResponse.get(m.response_id)!.push({ name: m.name, is_own: m.is_own });
  }

  // Citaciones (dominios fuente) por respuesta.
  const cites = await query<{
    response_id: number;
    domain: string;
    url: string | null;
    is_own: boolean;
  }>(
    `SELECT c.response_id, c.domain, c.url, c.is_own
     FROM citations c JOIN responses resp ON resp.id = c.response_id
     WHERE resp.run_id = $1
     ORDER BY c.position`,
    [runId]
  );
  const citesByResponse = new Map<number, { domain: string; url: string | null; is_own: boolean }[]>();
  for (const c of cites) {
    if (!citesByResponse.has(c.response_id)) citesByResponse.set(c.response_id, []);
    citesByResponse.get(c.response_id)!.push({ domain: c.domain, url: c.url, is_own: c.is_own });
  }

  // Fan-out queries por respuesta (solo Gemini las aporta).
  const fanout = await query<{ response_id: number; query: string }>(
    `SELECT fq.response_id, fq.query
     FROM fanout_queries fq JOIN responses resp ON resp.id = fq.response_id
     WHERE resp.run_id = $1
     ORDER BY fq.position`,
    [runId]
  );
  const fanoutByResponse = new Map<number, string[]>();
  for (const f of fanout) {
    if (!fanoutByResponse.has(f.response_id)) fanoutByResponse.set(f.response_id, []);
    fanoutByResponse.get(f.response_id)!.push(f.query);
  }

  // Entidades de marca descubiertas por Claude, por respuesta.
  const ents = await query<{
    response_id: number;
    raw_name: string;
    is_own: boolean;
    is_known: boolean;
  }>(
    `SELECT e.response_id, e.raw_name, e.is_own, e.is_known
     FROM entities e JOIN responses resp ON resp.id = e.response_id
     WHERE resp.run_id = $1
     ORDER BY e.raw_name`,
    [runId]
  );
  const entsByResponse = new Map<number, { name: string; isOwn: boolean; isKnown: boolean }[]>();
  for (const e of ents) {
    if (!entsByResponse.has(e.response_id)) entsByResponse.set(e.response_id, []);
    entsByResponse.get(e.response_id)!.push({ name: e.raw_name, isOwn: e.is_own, isKnown: e.is_known });
  }

  return NextResponse.json({
    runs,
    runId,
    responses: responses.map((r) => ({
      ...r,
      brands: byResponse.get(r.id) ?? [],
      citations: citesByResponse.get(r.id) ?? [],
      fanoutQueries: fanoutByResponse.get(r.id) ?? [],
      entities: entsByResponse.get(r.id) ?? [],
    })),
  });
}
