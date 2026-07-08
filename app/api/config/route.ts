import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// Lee la configuración completa (marcas, prompts, modelos) para /prompts.
export async function GET() {
  const [brands, prompts, models, platforms] = await Promise.all([
    query(
      "SELECT id, name, aliases, domain, is_own FROM brands ORDER BY is_own DESC, id"
    ),
    query(
      "SELECT id, text, market, language, query_type, brand_focus, active FROM prompts ORDER BY id"
    ),
    query(
      "SELECT id, provider, model_name, label, web_search_enabled, active FROM models ORDER BY id"
    ),
    query(
      "SELECT id, name, kind, reference, active FROM platforms ORDER BY id"
    ),
  ]);
  return NextResponse.json({ brands, prompts, models, platforms });
}

// Crea una entidad nueva. Body: { entity: 'brand'|'prompt'|'model', data: {...} }
export async function POST(req: NextRequest) {
  const { entity, data } = await req.json();
  try {
    if (entity === "brand") {
      const aliases = parseAliases(data.aliases);
      await query(
        "INSERT INTO brands (name, aliases, domain, is_own) VALUES ($1,$2,$3,$4)",
        [data.name, aliases, data.domain || null, !!data.is_own]
      );
    } else if (entity === "prompt") {
      await query(
        "INSERT INTO prompts (text, market, language, query_type, brand_focus) VALUES ($1,$2,$3,$4,$5)",
        [
          data.text,
          data.market || "ES",
          data.language || "es",
          data.query_type || "Commercial",
          data.brand_focus || "Non-Brand",
        ]
      );
    } else if (entity === "model") {
      await query(
        "INSERT INTO models (provider, model_name, label, web_search_enabled) VALUES ($1,$2,$3,$4)",
        [
          data.provider,
          data.model_name,
          data.label || data.model_name,
          !!data.web_search_enabled,
        ]
      );
    } else if (entity === "platform") {
      await query(
        "INSERT INTO platforms (name, kind, reference) VALUES ($1,$2,$3)",
        [data.name, data.kind || "other", data.reference || null]
      );
    } else {
      return NextResponse.json({ error: "Entidad desconocida" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}

// Borra una entidad. Body: { entity, id }
export async function DELETE(req: NextRequest) {
  const { entity, id } = await req.json();
  const tables: Record<string, string> = {
    brand: "brands",
    prompt: "prompts",
    model: "models",
    platform: "platforms",
  };
  const table = tables[entity];
  if (!table) return NextResponse.json({ error: "Entidad desconocida" }, { status: 400 });
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}

function parseAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string")
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}
