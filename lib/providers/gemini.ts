import { AskParams, AskResult, ProviderError, fetchJson } from "./types";

// Google Gemini (API generativelanguage). Con webSearch activa el grounding
// con Google Search para que la respuesta use resultados reales de búsqueda.
export async function ask({
  prompt,
  modelName,
  webSearch,
}: AskParams): Promise<AskResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError("Falta GEMINI_API_KEY");

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  if (webSearch) body.tools = [{ google_search: {} }];

  const data = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    }
  );

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text: string = parts.map((p: any) => p.text ?? "").join("");

  // Citas del grounding metadata. OJO: web.uri es un redirect de Vertex
  // (vertexaisearch.cloud.google.com); el dominio real está en web.title.
  const grounding = data.candidates?.[0]?.groundingMetadata ?? {};
  const chunks = grounding.groundingChunks ?? [];
  const citations: string[] = chunks
    .map((c: any) => c.web?.title || c.web?.uri)
    .filter(Boolean);

  // Fan-out: las consultas que Gemini lanzó a Google Search para responder.
  const fanoutQueries: string[] = (grounding.webSearchQueries ?? []).filter(
    Boolean
  );

  return { text: text.trim(), citations, fanoutQueries };
}
