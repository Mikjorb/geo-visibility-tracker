import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { suggestPrompts, AuditInput } from "@/lib/suggest-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

// Genera prompts a partir del payload de auditoría (perfil + consultas GSC + GEO)
// y los inserta en la tabla prompts. Lo invoca Claude Code tras la Fase A.
// Body: { profile, seedQueries[], geoNotes?, market?, language?, count?, replaceActive? }
export async function POST(req: NextRequest) {
  let body: AuditInput & { replaceActive?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!body.profile || !Array.isArray(body.seedQueries) || body.seedQueries.length === 0) {
    return NextResponse.json(
      { error: "Faltan 'profile' o 'seedQueries' (no vacío)." },
      { status: 400 }
    );
  }

  let generated;
  try {
    generated = await suggestPrompts(body);
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }

  if (generated.length === 0) {
    return NextResponse.json({ error: "El modelo no devolvió prompts válidos." }, { status: 502 });
  }

  // Si se pide reemplazar, desactivamos el set anterior (no se borra: se conserva
  // el histórico de runs que lo referencian).
  if (body.replaceActive) {
    await query("UPDATE prompts SET active = FALSE WHERE active = TRUE");
  }

  const created: { id: number; text: string; query_type: string; brand_focus: string }[] = [];
  for (const p of generated) {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO prompts (text, market, language, query_type, brand_focus)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [p.text, p.market, p.language, p.query_type, p.brand_focus]
    );
    created.push({
      id: row!.id,
      text: p.text,
      query_type: p.query_type,
      brand_focus: p.brand_focus,
    });
  }

  return NextResponse.json({ created: created.length, replacedActive: !!body.replaceActive, prompts: created });
}
