import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

// Lee la configuración completa (marcas, prompts, modelos) para /prompts.
export async function GET() {
  const [brands, prompts, models, platforms] = await Promise.all([
    query(
      "SELECT id, name, aliases, domain, is_own FROM brands WHERE active = TRUE ORDER BY is_own DESC, id"
    ),
    query(
      "SELECT id, text, market, language, query_type, brand_focus, active FROM prompts WHERE active = TRUE ORDER BY id"
    ),
    query(
      "SELECT id, provider, model_name, label, web_search_enabled, active FROM models WHERE active = TRUE ORDER BY id"
    ),
    query(
      "SELECT id, name, kind, reference, active FROM platforms WHERE active = TRUE ORDER BY id"
    ),
  ]);
  return NextResponse.json({ brands, prompts, models, platforms });
}

// Crea una entidad nueva. Body: { entity: 'brand'|'prompt'|'model', data: {...} }
export async function POST(req: NextRequest) {
  const parsed = z
    .object({
      entity: z.enum(["brand", "prompt", "model", "platform"]),
      data: z.record(z.string(), z.unknown()),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Payload de configuración inválido" }, { status: 400 });
  const { entity, data } = parsed.data;
  try {
    if (entity === "brand") {
      const values = z.object({
        name: z.string().trim().min(1).max(120),
        aliases: z.unknown().optional(),
        domain: z.string().trim().max(253).optional().nullable(),
        is_own: z.boolean().optional(),
      }).parse(data);
      const aliases = parseAliases(values.aliases);
      await query(
        "INSERT INTO brands (name, aliases, domain, is_own) VALUES ($1,$2,$3,$4)",
        [values.name, aliases, values.domain || null, !!values.is_own]
      );
    } else if (entity === "prompt") {
      const values = z.object({
        text: z.string().trim().min(1).max(4000),
        market: z.string().trim().min(2).max(10).optional(),
        language: z.string().trim().min(2).max(10).optional(),
        query_type: z.enum(["Commercial", "Informational", "Transactional", "Navigational"]).optional(),
        brand_focus: z.enum(["Own Brand", "Non-Brand", "Competitor"]).optional(),
      }).parse(data);
      await query(
        "INSERT INTO prompts (text, market, language, query_type, brand_focus) VALUES ($1,$2,$3,$4,$5)",
        [
          values.text,
          values.market || "ES",
          values.language || "es",
          values.query_type || "Commercial",
          values.brand_focus || "Non-Brand",
        ]
      );
    } else if (entity === "model") {
      const values = z.object({
        provider: z.enum(["openai", "gemini", "perplexity"]),
        model_name: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(120).optional(),
        web_search_enabled: z.boolean().optional(),
      }).parse(data);
      await query(
        "INSERT INTO models (provider, model_name, label, web_search_enabled) VALUES ($1,$2,$3,$4)",
        [
          values.provider,
          values.model_name,
          values.label || values.model_name,
          !!values.web_search_enabled,
        ]
      );
    } else if (entity === "platform") {
      const values = z.object({
        name: z.string().trim().min(1).max(120),
        kind: z.string().trim().min(1).max(60).optional(),
        reference: z.string().trim().max(500).optional().nullable(),
      }).parse(data);
      await query(
        "INSERT INTO platforms (name, kind, reference) VALUES ($1,$2,$3)",
        [values.name, values.kind || "other", values.reference || null]
      );
    } else {
      return NextResponse.json({ error: "Entidad desconocida" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : err?.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: status === 400 ? "Datos inválidos" : String(err?.message ?? err) }, { status });
  }
}

// Borra una entidad. Body: { entity, id }
export async function DELETE(req: NextRequest) {
  const parsed = z.object({
    entity: z.enum(["brand", "prompt", "model", "platform"]),
    id: z.number().int().positive(),
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  const { entity, id } = parsed.data;
  const tables: Record<string, string> = {
    brand: "brands",
    prompt: "prompts",
    model: "models",
    platform: "platforms",
  };
  const table = tables[entity];
  if (!table) return NextResponse.json({ error: "Entidad desconocida" }, { status: 400 });
  // Archivado lógico: la configuración desaparece de la UI sin destruir runs.
  await query(`UPDATE ${table} SET active = FALSE WHERE id = $1`, [id]);
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
