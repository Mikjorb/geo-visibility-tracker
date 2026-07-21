import { describe, expect, it } from "vitest";
import {
  aiVisibilityScore,
  detectMentions,
  mentionRate,
  parseCitations,
  sentimentSummary,
  shareOfVoice,
} from "./analyze";

const brands = [
  {
    id: 1,
    name: "ACME3D",
    aliases: ["ACME 3D"],
    domain: "acme3d.com",
    is_own: true,
  },
  { id: 2, name: "Contoso", aliases: [], domain: "contoso.com", is_own: false },
];

describe("detectMentions", () => {
  it("normaliza acentos/case y calcula el orden", () => {
    const result = detectMentions("Contoso y después ÁCME3D", brands);
    expect(result.map((r) => [r.mentioned, r.rank])).toEqual([
      [true, 2],
      [true, 1],
    ]);
  });

  it("no acepta substrings simples ni aliases compuestos", () => {
    expect(detectMentions("contosomente", brands)[1].mentioned).toBe(false);
    expect(
      detectMentions("ACME 3DPLUS no es la marca", brands)[0].mentioned
    ).toBe(false);
  });
});

describe("parseCitations", () => {
  it("acepta el dominio exacto y subdominios, pero no impostores", () => {
    const rows = parseCitations(
      [
        { url: "https://acme3d.com/a" },
        { url: "https://blog.acme3d.com/b" },
        { url: "https://evilacme3d.com/c" },
      ],
      "acme3d.com"
    );
    expect(rows.map((r) => r.isOwn)).toEqual([true, true, false]);
  });

  it("deduplica y conserva metadatos opacos de proveedor", () => {
    const rows = parseCitations(
      [
        { domain: "example.com", providerUrl: "https://redirect/1" },
        { domain: "example.com", providerUrl: "https://redirect/2" },
      ],
      null
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].providerUrl).toBe("https://redirect/1");
    expect(rows[0].url).toBeNull();
  });
});

describe("métricas", () => {
  const own = (mentioned: boolean, rank: number | null) => ({
    brand_id: 1,
    brand_name: "A",
    is_own: true,
    mentioned,
    rank,
  });

  it("calcula Mention Rate y visibility reciprocal rank", () => {
    const rows = [[own(true, 1)], [own(true, 2)], [own(false, null)]];
    expect(mentionRate(rows)).toBe(66.7);
    expect(aiVisibilityScore(rows)).toBe(500);
  });

  it("calcula SoV y sentimiento", () => {
    expect(
      shareOfVoice([
        own(true, 1),
        { ...own(true, 1), brand_id: 2, brand_name: "B", is_own: false },
      ]).map((r) => r.share)
    ).toEqual([50, 50]);
    expect(sentimentSummary([1, 3, 5, null])).toEqual({
      score: 50,
      positive: 1,
      neutral: 1,
      negative: 1,
      analyzed: 3,
    });
  });
});
