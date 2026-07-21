import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { z } from "zod";

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
  const scoreMap = z.record(z.string(), z.number().min(0).max(100));
  const schema = z.object({
    domain: z.string().trim().min(1).max(253),
    score: z.number().min(0).max(100),
    dimensions: scoreMap.optional().default({}),
    crawlerAccess: z.record(z.string(), z.string()).optional().default({}),
    llmsTxtStatus: z.enum(["present", "missing", "malformed"]).nullable().optional().default(null),
    platformScores: scoreMap.optional().default({}),
    recommendations: z.array(z.record(z.string(), z.unknown())).max(100).optional().default([]),
    notes: z.string().max(20000).nullable().optional().default(null),
    auditorVersion: z.string().trim().min(1).max(120),
    evidence: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
  });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Auditoría GEO inválida", issues: parsed.error.issues }, { status: 400 });
  const body = parsed.data;
  const {
    domain,
    score,
    dimensions = {},
    crawlerAccess = {},
    llmsTxtStatus = null,
    platformScores = {},
    recommendations = [],
    notes = null,
    auditorVersion,
    evidence,
  } = body;

  const row = await queryOne<{ id: number }>(
    `INSERT INTO geo_audits
      (domain, score, dimensions, crawler_access, llms_txt_status, platform_scores, recommendations, notes, auditor_version, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
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
      auditorVersion,
      JSON.stringify(evidence),
    ]
  );

  return NextResponse.json({ ok: true, id: row!.id });
}
