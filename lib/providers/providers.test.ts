import { describe, expect, it } from "vitest";
import { parseGeminiResponse } from "./gemini";
import { parseOpenAIResponse } from "./openai";
import { parsePerplexityResponse } from "./perplexity";

describe("contratos normalizados de proveedor", () => {
  it("extrae texto y citas de OpenAI Responses", () => {
    const result = parseOpenAIResponse({
      output: [
        { type: "web_search_call" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Respuesta",
              annotations: [
                { type: "url_citation", url: "https://example.com/a", title: "A" },
                {
                  type: "url_citation",
                  url_citation: { url: "https://example.org/b", title: "B" },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.text).toBe("Respuesta");
    expect(result.citations).toEqual([
      { url: "https://example.com/a", title: "A" },
      { url: "https://example.org/b", title: "B" },
    ]);
  });

  it("separa dominio y redirect opaco de Gemini", () => {
    const result = parseGeminiResponse({
      candidates: [
        {
          content: { parts: [{ text: "Respuesta" }] },
          groundingMetadata: {
            webSearchQueries: ["consulta"],
            groundingChunks: [
              { web: { title: "example.com", uri: "https://vertex/redirect" } },
            ],
          },
        },
      ],
    });
    expect(result.citations?.[0]).toEqual({
      domain: "example.com",
      title: "example.com",
      providerUrl: "https://vertex/redirect",
    });
    expect(result.fanoutQueries).toEqual(["consulta"]);
  });

  it("normaliza Sonar", () => {
    expect(
      parsePerplexityResponse({
        choices: [{ message: { content: "Respuesta" } }],
        citations: ["https://example.com"],
      })
    ).toEqual({ text: "Respuesta", citations: [{ url: "https://example.com" }] });
  });
});
