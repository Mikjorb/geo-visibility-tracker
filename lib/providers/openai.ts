import { AskParams, AskResult, ProviderError, fetchJson } from "./types";

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

  // output_text es el atajo que da la Responses API; si no, recorremos output.
  let text: string = data.output_text ?? "";
  if (!text && Array.isArray(data.output)) {
    text = data.output
      .flatMap((item: any) =>
        Array.isArray(item.content)
          ? item.content.map((c: any) => c.text ?? "").filter(Boolean)
          : []
      )
      .join("\n");
  }

  return { text: text.trim() };
}
