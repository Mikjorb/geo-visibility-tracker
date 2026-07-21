import {
  AskParams,
  AskResult,
  ProviderCitation,
  ProviderError,
  fetchJson,
} from "./types";

export function parseOpenAIResponse(data: any): AskResult {
  let text: string = data.output_text ?? "";
  const citations: ProviderCitation[] = [];
  if (Array.isArray(data.output)) {
    const content = data.output.flatMap((item: any) =>
      Array.isArray(item.content) ? item.content : []
    );
    if (!text)
      text = content
        .map((c: any) => c.text ?? "")
        .filter(Boolean)
        .join("\n");
    for (const block of content) {
      for (const annotation of block.annotations ?? []) {
        if (annotation.type !== "url_citation") continue;
        const value = annotation.url_citation ?? annotation;
        if (value.url)
          citations.push({ url: value.url, title: value.title });
      }
    }
  }
  return { text: text.trim(), citations };
}

// OpenAI vía Responses API. Con webSearch activa la herramienta web_search
// para que la respuesta refleje lo que vería un usuario con navegación.
export async function ask({
  prompt,
  modelName,
  webSearch,
}: AskParams): Promise<AskResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError("Falta OPENAI_API_KEY");

  const body: Record<string, unknown> = {
    model: modelName,
    input: prompt,
  };
  if (webSearch) body.tools = [{ type: "web_search" }];

  const data = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseOpenAIResponse(data);
}
