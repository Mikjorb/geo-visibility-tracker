import { AskParams, AskResult, ProviderError, fetchJson } from "./types";

// Perplexity (API compatible con chat completions). Siempre busca en web,
// por eso es el modelo más fiel para GEO y el que mejor expone citas.
export async function ask({
  prompt,
  modelName,
}: AskParams): Promise<AskResult> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) throw new ProviderError("Falta PERPLEXITY_API_KEY");

  const data = await fetchJson("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const text: string = data.choices?.[0]?.message?.content ?? "";
  const citations: string[] = data.citations ?? [];
  return { text: text.trim(), citations };
}
