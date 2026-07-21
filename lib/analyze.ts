// Detección de menciones de marca y extracción de citas en respuestas LLM,
// más el cálculo de las métricas (alineadas con LLMPulse).

export interface Brand {
  id: number;
  name: string;
  aliases: string[];
  domain: string | null;
  is_own: boolean;
}

export interface BrandMention {
  brandId: number;
  mentioned: boolean;
  firstPosition: number | null; // índice del carácter de la 1ª aparición
  rank: number | null; // 1 = primera marca citada en la respuesta
}

// Normaliza para comparar: minúsculas + sin acentos.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 1ª posición de cualquiera de los términos. Los límites se aplican también a
// aliases compuestos para evitar casos como "ACME 3DPLUS".
function firstMatchPosition(haystack: string, terms: string[]): number | null {
  let best: number | null = null;
  for (const term of terms) {
    const t = normalize(term).trim();
    if (!t) continue;
    const pattern = new RegExp(
      `(?<![a-z0-9])${escapeRegex(t)}(?![a-z0-9])`,
      "u"
    );
    const m = pattern.exec(haystack);
    if (m && (best === null || m.index < best)) best = m.index;
  }
  return best;
}

// Analiza una respuesta contra todas las marcas y asigna rank por orden de aparición.
export function detectMentions(rawText: string, brands: Brand[]): BrandMention[] {
  const haystack = normalize(rawText);
  const found = brands.map((b) => ({
    brandId: b.id,
    firstPosition: firstMatchPosition(haystack, [b.name, ...b.aliases]),
  }));

  // rank: orden de las marcas que SÍ aparecen, por posición ascendente.
  const ordered = found
    .filter((f) => f.firstPosition !== null)
    .sort((a, b) => (a.firstPosition as number) - (b.firstPosition as number));
  const rankMap = new Map<number, number>();
  ordered.forEach((f, i) => rankMap.set(f.brandId, i + 1));

  return found.map((f) => ({
    brandId: f.brandId,
    mentioned: f.firstPosition !== null,
    firstPosition: f.firstPosition,
    rank: rankMap.get(f.brandId) ?? null,
  }));
}

// Extrae dominio (sin www) de una URL. Devuelve null si no es parseable.
export function domainFromUrl(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Convierte la lista de citas (URLs) del proveedor en filas {domain,url,position,isOwn}.
export function parseCitations(
  citations: Array<
    | string
    | { url?: string; domain?: string; title?: string; providerUrl?: string }
  >,
  ownDomain: string | null
): {
  domain: string;
  url: string | null;
  providerUrl: string | null;
  title: string | null;
  position: number;
  isOwn: boolean;
}[] {
  const rows: ReturnType<typeof parseCitations> = [];
  const seen = new Set<string>();
  const normalizedOwn = ownDomain ? domainFromUrl(ownDomain) : null;
  citations.forEach((citation) => {
    const item = typeof citation === "string" ? { url: citation } : citation;
    const domain = item.domain
      ? domainFromUrl(item.domain)
      : item.url
        ? domainFromUrl(item.url)
        : null;
    if (!domain) return;
    const url = item.url ?? null;
    const key = `${domain}|${url ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      domain,
      url,
      providerUrl: item.providerUrl ?? null,
      title: item.title ?? null,
      position: rows.length + 1,
      isOwn: normalizedOwn
        ? domain === normalizedOwn || domain.endsWith(`.${normalizedOwn}`)
        : false,
    });
  });
  return rows;
}

// ---- Métricas agregadas (se calculan en /api/data) ----

export interface MentionRow {
  brand_id: number;
  brand_name: string;
  is_own: boolean;
  mentioned: boolean;
  rank: number | null;
}

// Nombre canónico de una entidad de marca para agrupar variantes:
// minúsculas, sin acentos, sin sufijos societarios, sin TLD suelto y sin un
// "3d" FINAL (pero conservando el "3D" cuando es parte integral del nombre,
// p.ej. "3D Systems"). "ACME 3D" => "acme"; "3D Systems" se queda.
export function canonicalBrand(name: string): string {
  return normalize(name)
    .replace(/\b(s\.?l\.?|s\.?a\.?|inc|ltd|gmbh|srl)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(com|es|net|org|io|eu|info)\b/g, " ") // quita TLD suelto (example.com)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+3d$/, "") // quita "3d" SOLO si es el último token (no "3D Systems")
    .trim();
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Mention Rate = respuestas que mencionan la marca propia / total de respuestas.
export function mentionRate(rowsByResponse: MentionRow[][]): number {
  if (rowsByResponse.length === 0) return 0;
  const hits = rowsByResponse.filter((rows) =>
    rows.some((r) => r.is_own && r.mentioned)
  ).length;
  return round1((hits / rowsByResponse.length) * 100);
}

// Share of Voice por marca = menciones de la marca / menciones totales del grupo.
export function shareOfVoice(allRows: MentionRow[]): {
  brand: string;
  isOwn: boolean;
  mentions: number;
  share: number;
}[] {
  const mentioned = allRows.filter((r) => r.mentioned);
  const total = mentioned.length;
  const byBrand = new Map<string, { isOwn: boolean; count: number }>();
  for (const r of mentioned) {
    const cur = byBrand.get(r.brand_name) ?? { isOwn: r.is_own, count: 0 };
    cur.count++;
    byBrand.set(r.brand_name, cur);
  }
  return [...byBrand.entries()]
    .map(([brand, v]) => ({
      brand,
      isOwn: v.isOwn,
      mentions: v.count,
      share: total ? round1((v.count / total) * 100) : 0,
    }))
    .sort((a, b) => b.mentions - a.mentions);
}

// Posición media de la marca propia cuando aparece (1 = primera). null si nunca aparece.
export function averagePosition(allRows: MentionRow[]): number | null {
  const ranks = allRows
    .filter((r) => r.is_own && r.rank != null)
    .map((r) => r.rank as number);
  if (ranks.length === 0) return null;
  return round1(ranks.reduce((a, b) => a + b, 0) / ranks.length);
}

// Sentimiento de marca (percepción) — tarea LLM-as-judge: Claude puntúa 1-5
// cómo se percibe la marca propia en cada respuesta que la menciona
// (1 muy negativo … 5 muy positivo/líder). Aquí solo agregamos esos valores.
// score 0-100 = (media-1)/4*100 (1→0, 3→50, 5→100). Reparto: pos 4-5, neutral 3, neg 1-2.
// Devuelve score:null si no hay ninguna mención analizada (no mostrar 0% engañoso).
export function sentimentSummary(sentiments: (number | null)[]): {
  score: number | null;
  positive: number;
  neutral: number;
  negative: number;
  analyzed: number;
} {
  const vals = sentiments.filter((s): s is number => s != null);
  if (vals.length === 0)
    return { score: null, positive: 0, neutral: 0, negative: 0, analyzed: 0 };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    score: Math.round(((avg - 1) / 4) * 100),
    positive: vals.filter((s) => s >= 4).length,
    neutral: vals.filter((s) => s === 3).length,
    negative: vals.filter((s) => s <= 2).length,
    analyzed: vals.length,
  };
}

// AI Visibility Score (escala 0-1000) — fórmula propia y transparente:
// premia frecuencia Y posición. Por cada respuesta donde apareces en rank p
// sumas 1/p; se divide por el total de respuestas y se escala a 1000.
// Aparecer 1º en todas las respuestas => 1000.
export function aiVisibilityScore(rowsByResponse: MentionRow[][]): number {
  if (rowsByResponse.length === 0) return 0;
  let acc = 0;
  for (const rows of rowsByResponse) {
    const own = rows.find((r) => r.is_own && r.mentioned && r.rank != null);
    if (own) acc += 1 / (own.rank as number);
  }
  return Math.round((acc / rowsByResponse.length) * 1000);
}
