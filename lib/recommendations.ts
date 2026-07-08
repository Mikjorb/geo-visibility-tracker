// ---- Detección de huecos por reglas (sin IA, sin coste de API) ----
// La redacción de estos huecos como tareas priorizadas la hace Claude Code
// directamente en una sesión (dentro de la suscripción), no una llamada
// automática a la API de Anthropic.
// Resume, a partir de los datos del run, dónde pierdes visibilidad. Este resumen
// estructurado es lo que luego Claude convierte en tareas accionables.

export interface RunResponse {
  promptText: string;
  modelLabel: string;
  ownMentioned: boolean;
  competitorsMentioned: string[]; // marcas conocidas (no propias) mencionadas
  ownCited: boolean;
  ownCitedUrls: string[]; // URLs propias concretas citadas en esta respuesta
  competitorDomainsCited: string[];
  fanoutQueries: string[];
}

export interface GapSummary {
  ownBrand: string;
  totalResponses: number;
  promptsWithoutMention: string[]; // prompts donde NO apareces
  promptsWhereCompetitorWinsAlone: { prompt: string; competitors: string[] }[];
  reputationFanouts: string[]; // fan-out tipo "opiniones"/"reviews" sobre ti
  categoryFanouts: string[]; // resto de fan-out (cómo te categoriza la IA)
  ownCitationRate: number; // % de respuestas que citan tu dominio
  topCompetitorDomains: { domain: string; count: number }[];
  // --- Consciencia de contenido existente (citación ≠ mención) ---
  ownCitedPages: { url: string; count: number }[]; // tus páginas que la IA ya cita
  promptsCitedNotMentioned: { prompt: string; pages: string[] }[]; // te citan como fuente pero NO te nombran
}

const REPUTATION_RE = /(opinion|opiniones|review|reviews|reputaci|valorac|experiencias|fiable|confiab|estafa|scam)/i;

export function detectGaps(ownBrand: string, responses: RunResponse[]): GapSummary {
  const ok = responses.filter((r) => true);
  const total = ok.length;

  const promptsWithoutMention = [
    ...new Set(ok.filter((r) => !r.ownMentioned).map((r) => r.promptText)),
  ];

  const promptsWhereCompetitorWinsAlone = ok
    .filter((r) => !r.ownMentioned && r.competitorsMentioned.length > 0)
    .map((r) => ({ prompt: r.promptText, competitors: r.competitorsMentioned }));

  const allFanout = [...new Set(ok.flatMap((r) => r.fanoutQueries))];
  const ownTokens = ownBrand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const reputationFanouts = allFanout.filter(
    (q) => REPUTATION_RE.test(q) || q.toLowerCase().replace(/[^a-z0-9]/g, "").includes(ownTokens)
  );
  const categoryFanouts = allFanout.filter((q) => !reputationFanouts.includes(q));

  const ownCites = ok.filter((r) => r.ownCited).length;
  const ownCitationRate = total ? Math.round((ownCites / total) * 100) : 0;

  const domainCounts = new Map<string, number>();
  for (const r of ok)
    for (const d of r.competitorDomainsCited)
      domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  const topCompetitorDomains = [...domainCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Tus páginas que la IA ya cita (existen y funcionan a nivel de fuente).
  const pageCounts = new Map<string, number>();
  for (const r of ok)
    for (const u of r.ownCitedUrls)
      pageCounts.set(u, (pageCounts.get(u) ?? 0) + 1);
  const ownCitedPages = [...pageCounts.entries()]
    .map(([url, count]) => ({ url, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // El caso quirúrgico: prompts donde te CITAN como fuente pero NO te MENCIONAN
  // en el texto → no hay que crear contenido, sino optimizar esa página existente
  // para que el modelo te atribuya.
  const cnmByPrompt = new Map<string, Set<string>>();
  for (const r of ok) {
    if (r.ownMentioned || r.ownCitedUrls.length === 0) continue;
    const set = cnmByPrompt.get(r.promptText) ?? new Set<string>();
    for (const u of r.ownCitedUrls) set.add(u);
    cnmByPrompt.set(r.promptText, set);
  }
  const promptsCitedNotMentioned = [...cnmByPrompt.entries()].map(([prompt, pages]) => ({
    prompt,
    pages: [...pages],
  }));

  return {
    ownBrand,
    totalResponses: total,
    promptsWithoutMention,
    promptsWhereCompetitorWinsAlone,
    reputationFanouts,
    categoryFanouts,
    ownCitationRate,
    topCompetitorDomains,
    ownCitedPages,
    promptsCitedNotMentioned,
  };
}

export interface Recommendation {
  priority: number; // 1 alta, 2 media, 3 baja
  category: string; // contenido | optimizacion | reputacion | citaciones | competencia | general
  title: string;
  action: string;
  rationale: string;
}

// ---- Criterios para redactar recomendaciones a partir de un GapSummary ----
// Ya no los aplica una llamada a la API: los sigue Claude Code directamente en
// sesión cuando se le pide "actualiza las recomendaciones". Se documentan aquí
// para no perder el criterio de calidad acumulado:
//
// - Cada tarea ESPECÍFICA y ejecutable (nada de "haz más SEO").
// - CRÍTICO: no recomendar CREAR contenido que ya existe. `ownCitedPages` y
//   `promptsCitedNotMentioned` son páginas que la IA YA cita — ahí la acción es
//   OPTIMIZAR (category "optimizacion"), citando la URL exacta, con lenguaje de
//   marca explícito, datos estructurados, FAQ y pasajes citables.
// - Solo recomendar CREAR contenido nuevo para prompts en
//   `promptsWithoutMention` sin ninguna página propia ya citada.
// - Apoyarse en los datos reales del resumen (prompts sin mención, fan-out de
//   reputación, dominios que citan a competidores, tasa de citación).
// - Prohibido inventar cifras, prompts, dominios o URLs que no estén
//   literalmente en el resumen.
// - priority: 1 alta (más impacto) · 2 media · 3 baja.
// - category: contenido | optimizacion | reputacion | citaciones | competencia | general.
// - Entre 5 y 10 tareas por actualización.
