// Parseo tolerante de JSON devuelto por un LLM. Maneja los casos típicos:
// - JSON directo.
// - Envuelto en code fence ```json … ``` (Claude lo hace a menudo).
// - JSON embebido en prosa: extrae del primer { al último }.
export function extractJson(text: string): any {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}
