import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

// Auditorías GEO técnicas (agente seo-geo de Claude Code): salud de un dominio
// de cara a crawlers de IA y citabilidad. Es el diagnóstico "de causa" que
// complementa las métricas "de resultado" (Mention Rate, Citation Rate…).
//
// Este endpoint NO ejecuta la auditoría (requiere WebFetch/robots.txt/curl,
// propio de un agente de Claude Code) — solo la persiste. El flujo es:
//   1. Pides "audita el GEO de example.com" en una sesión de Claude Code.
//   2. El agente seo-geo analiza el sitio y devuelve el informe estructurado.
//   3. Claude hace POST aquí con el resultado, quedando en el histórico.

// Última auditoría por dominio + histórico del dominio propio (o el indicado).
export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");

  if (domain) {
    const history = await query(
      "SELECT * FROM geo_audits WHERE domain = $1 ORDER BY created_at DESC LIMIT 20",
      [domain]
    );
    return NextResponse.json({ domain, history, latest: history[0] ?? null });
  }

  // Sin dominio: última auditoría de cada dominio auditado.
  const latestPerDomain = await query(
    `SELECT DISTINCT ON (domain) *
     FROM geo_audits
     ORDER BY domain, created_at DESC`
  );
  return NextResponse.json({ audits: latestPerDomain });
}

// Guarda el resultado de una auditoría GEO ya realizada.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    domain,
    score,
    dimensions = {},
    crawlerAccess = {},
    llmsTxtStatus = null,
    platformScores = {},
    recommendations = [],
    notes = null,
  } = body;

  if (!domain || typeof score !== "number") {
    return NextResponse.json(
      { error: "Se requieren 'domain' (string) y 'score' (número 0-100)." },
      { status: 400 }
    );
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO geo_audits
      (domain, score, dimensions, crawler_access, llms_txt_status, platform_scores, recommendations, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      domain,
      Math.round(score),
      JSON.stringify(dimensions),
      JSON.stringify(crawlerAccess),
      llmsTxtStatus,
      JSON.stringify(platformScores),
      JSON.stringify(recommendations),
      notes,
    ]
  );

  return NextResponse.json({ ok: true, id: row!.id });
}
