import { AskParams, AskResult, ProviderError, fetchJson } from "./types";

export function parseGeminiResponse(data: any): AskResult {
  const candidate = data.candidates?.[0] ?? {};
  const parts = candidate.content?.parts ?? [];
  const text: string = parts.map((p: any) => p.text ?? "").join("");
  const grounding = candidate.groundingMetadata ?? {};
  const citations = (grounding.groundingChunks ?? [])
    .map((c: any) => {
      const title = c.web?.title;
      const providerUrl = c.web?.uri;
      return title || providerUrl
        ? {
            // Gemini 2.5 suele exponer el dominio en title y un redirect opaco
            // en uri. No inventamos una URL de página que el API no entregó.
            domain: title,
            title,
            providerUrl,
          }
        : null;
    })
    .filter(Boolean);
  const fanoutQueries: string[] = (grounding.webSearchQueries ?? []).filter(Boolean);
  return { text: text.trim(), citations, fanoutQueries };
}

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

  return parseGeminiResponse(data);
}
