import { ProviderError, fetchJson } from "./providers/types";
import { extractJson } from "./json";

// Modelo generador. Haiku basta y es barato; configurable por env.
const MODEL = process.env.ANALYSIS_MODEL || "claude-haiku-4-5-20251001";

// Entrada: lo que produce la auditoría (Claude Code) — perfil de negocio,
// consultas reales de búsqueda (GSC) y notas de la auditoría GEO técnica.
export interface AuditInput {
  profile: string; // descripción del negocio: qué vende, a quién, competidores
  seedQueries: string[]; // queries reales de GSC (cómo busca la gente hoy)
  geoNotes?: string; // hallazgos de la auditoría GEO técnica (opcional)
  market?: string; // por defecto ES
  language?: string; // por defecto es
  count?: number; // nº de prompts a generar (por defecto 14)
}

export interface GeneratedPrompt {
  text: string;
  query_type: string; // Commercial | Informational | Transactional | Navigational
  brand_focus: string; // Own Brand | Non-Brand | Competitor
  market: string;
  language: string;
}

const QUERY_TYPES = ["Commercial", "Informational", "Transactional", "Navigational"];
const BRAND_FOCUS = ["Own Brand", "Non-Brand", "Competitor"];

// Convierte el corpus de auditoría en prompts naturales tipo-LLM, categorizados.
// Una sola llamada a Claude (barata). Devuelve [] si no hay JSON válido.
export async function suggestPrompts(input: AuditInput): Promise<GeneratedPrompt[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ProviderError("Falta ANTHROPIC_API_KEY");

  const market = input.market || "ES";
  const language = input.language || "es";
  const count = input.count && input.count > 0 ? input.count : 14;

  const system = `Eres un estratega de GEO (Generative Engine Optimization). A partir de una AUDITORÍA de un negocio (perfil, consultas reales de Google Search Console y notas técnicas GEO), generas los PROMPTS que un usuario real escribiría a un LLM (ChatGPT, Gemini, Perplexity) y donde la marca debería aparecer.
Reglas:
- Convierte cada consulta de keyword en una PREGUNTA NATURAL como la haría una persona a un asistente de IA (no fragmentos de keyword: "mejores impresoras 3d" -> "¿Cuáles son las mejores impresoras 3D profesionales para una empresa?").
- DESCARTA intención no relacionada con la visibilidad de marca: herramientas/utilidades propias (p.ej. "calculadora impresión 3D"), soporte técnico puro, o navegación irrelevante.
- Cubre un MIX equilibrado de categorías:
  - query_type: uno de ${QUERY_TYPES.join(" | ")}.
  - brand_focus: uno de ${BRAND_FOCUS.join(" | ")}. Incluye algunos "Own Brand" (preguntas sobre la propia marca, p.ej. opiniones), varios "Non-Brand" (categoría/recomendación, donde compites de verdad) y algunos "Competitor" (comparativas con competidores reales del perfil).
- Prompts en idioma "${language}" y pensados para el mercado "${market}".
- NO inventes datos ni nombres de marca que no estén en el perfil o las consultas.
- Genera exactamente ${count} prompts, sin duplicados.
Responde EXCLUSIVAMENTE con JSON válido, sin texto adicional, con esta forma exacta:
{"prompts":[{"text":"…","query_type":"Commercial","brand_focus":"Non-Brand"}]}`;

  const user = `PERFIL DE NEGOCIO:\n${input.profile}\n\nCONSULTAS REALES (GSC):\n${input.seedQueries.join("\n")}\n\nNOTAS GEO TÉCNICAS:\n${input.geoNotes || "(sin notas)"}`;

  const data = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000, // margen para no truncar el JSON con muchos prompts
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const text: string = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  const parsed = extractJson(text);
  const prompts = Array.isArray(parsed?.prompts) ? parsed.prompts : [];
  return prompts
    .map((p: any) => ({
      text: String(p.text ?? "").trim(),
      query_type: QUERY_TYPES.includes(p.query_type) ? p.query_type : "Commercial",
      brand_focus: BRAND_FOCUS.includes(p.brand_focus) ? p.brand_focus : "Non-Brand",
      market,
      language,
    }))
    .filter((p: GeneratedPrompt) => p.text.length > 0);
}
