import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { detectGaps, RunResponse } from "@/lib/recommendations";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET: recomendaciones guardadas (las escribe Claude Code en sesión, no una
// llamada a la API) + fecha de la última actualización.
export async function GET() {
  const recs = await query<{
    id: number;
    priority: number;
    category: string;
    title: string;
    action: string;
    rationale: string;
    done: boolean;
    created_at: string;
  }>(
    `SELECT id, priority, category, title, action, rationale, done, created_at
     FROM recommendations
     ORDER BY done ASC, priority ASC, id ASC`
  );
  const updatedAt = recs.reduce<string | null>(
    (max, r) => (!max || r.created_at > max ? r.created_at : max),
    null
  );
  return NextResponse.json({ recommendations: recs, updatedAt });
}

// POST: detecta huecos de visibilidad SOLO por reglas (sin IA, sin coste de
// API), agregando TODO el histórico de ejecuciones, no solo la última. No
// escribe nada en `recommendations` — devuelve el resumen para que Claude Code
// lo lea en sesión y redacte/actualice las tareas él mismo.
export async function POST(req: NextRequest) {
  const ownRow = await query<{ name: string }>(
    "SELECT name FROM brands WHERE is_own = TRUE LIMIT 1"
  );
  const ownBrand = ownRow[0]?.name ?? "tu marca";

  const responses = await query<{ id: number; prompt_text: string; model_label: string }>(
    `SELECT resp.id, p.text AS prompt_text, m.label AS model_label
     FROM responses resp
     JOIN prompts p ON p.id = resp.prompt_id
     JOIN models m ON m.id = resp.model_id
     WHERE resp.error IS NULL`
  );
  if (responses.length === 0)
    return NextResponse.json({ error: "Todavía no hay respuestas en el histórico." }, { status: 400 });

  const ids = responses.map((r) => r.id);

  const mentions = await query<{ response_id: number; name: string; is_own: boolean }>(
    `SELECT mt.response_id, b.name, b.is_own
     FROM mentions mt JOIN brands b ON b.id = mt.brand_id
     WHERE mt.response_id = ANY($1) AND mt.mentioned = TRUE`,
    [ids]
  );
  const cites = await query<{ response_id: number; domain: string; url: string | null; is_own: boolean }>(
    `SELECT response_id, domain, url, is_own FROM citations WHERE response_id = ANY($1)`,
    [ids]
  );
  const fanout = await query<{ response_id: number; query: string }>(
    `SELECT response_id, query FROM fanout_queries WHERE response_id = ANY($1) ORDER BY position`,
    [ids]
  );

  const byId = new Map<number, RunResponse>();
  for (const r of responses)
    byId.set(r.id, {
      promptText: r.prompt_text,
      modelLabel: r.model_label,
      ownMentioned: false,
      competitorsMentioned: [],
      ownCited: false,
      ownCitedUrls: [],
      competitorDomainsCited: [],
      fanoutQueries: [],
    });
  for (const m of mentions) {
    const r = byId.get(m.response_id);
    if (!r) continue;
    if (m.is_own) r.ownMentioned = true;
    else r.competitorsMentioned.push(m.name);
  }
  for (const c of cites) {
    const r = byId.get(c.response_id);
    if (!r) continue;
    if (c.is_own) {
      r.ownCited = true;
      if (c.url && !r.ownCitedUrls.includes(c.url)) r.ownCitedUrls.push(c.url);
    } else r.competitorDomainsCited.push(c.domain);
  }
  for (const f of fanout) byId.get(f.response_id)?.fanoutQueries.push(f.query);

  const gaps = detectGaps(ownBrand, [...byId.values()]);

  return NextResponse.json({ gaps });
}

// PUT: guarda una tanda de recomendaciones ya redactadas (por Claude Code en
// sesión, a partir del resumen de huecos). Reemplaza las anteriores.
export async function PUT(req: NextRequest) {
  const { recommendations } = await req.json();
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return NextResponse.json({ error: "recommendations vacío o inválido" }, { status: 400 });
  }

  await query("DELETE FROM recommendations");
  for (const t of recommendations) {
    await query(
      `INSERT INTO recommendations (run_id, priority, category, title, action, rationale)
       VALUES ((SELECT id FROM runs ORDER BY started_at DESC LIMIT 1), $1,$2,$3,$4,$5)`,
      [t.priority ?? 2, t.category ?? "general", t.title, t.action, t.rationale ?? ""]
    );
  }

  return NextResponse.json({ saved: recommendations.length });
}

// PATCH: marca/desmarca una tarea como hecha.
export async function PATCH(req: NextRequest) {
  const { id, done } = await req.json();
  if (typeof id !== "number") return NextResponse.json({ error: "id requerido" }, { status: 400 });
  await query("UPDATE recommendations SET done = $2 WHERE id = $1", [id, !!done]);
  return NextResponse.json({ ok: true });
}
