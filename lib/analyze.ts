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

// 1ª posición de cualquiera de los términos, respetando límites de palabra
// cuando el término es alfanumérico simple (evita falsos positivos).
function firstMatchPosition(haystack: string, terms: string[]): number | null {
  let best: number | null = null;
  for (const term of terms) {
    const t = normalize(term).trim();
    if (!t) continue;
    const useWordBoundary = /^[a-z0-9]+$/.test(t);
    const pattern = useWordBoundary
      ? new RegExp(`\\b${escapeRegex(t)}\\b`)
      : new RegExp(escapeRegex(t));
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
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Convierte la lista de citas (URLs) del proveedor en filas {domain,url,position,isOwn}.
export function parseCitations(
  citations: string[],
  ownDomain: string | null
): { domain: string; url: string; position: number; isOwn: boolean }[] {
  const rows: { domain: string; url: string; position: number; isOwn: boolean }[] = [];
  citations.forEach((url, i) => {
    const domain = domainFromUrl(url);
    if (!domain) return;
    rows.push({
      domain,
      url,
      position: i + 1,
      isOwn: ownDomain ? domain.includes(ownDomain.toLowerCase()) : false,
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
