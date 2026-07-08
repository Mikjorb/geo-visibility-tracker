// Interfaz común a todos los proveedores LLM.
// Cada adaptador recibe el prompt y devuelve el texto plano de la respuesta.

export interface AskParams {
  prompt: string;
  modelName: string;
  webSearch: boolean;
}

export interface AskResult {
  text: string;
  // Citas/URLs (fuentes) si el proveedor las expone (Perplexity, Gemini grounding).
  citations?: string[];
  // Fan-out: sub-búsquedas que el modelo lanzó internamente. Solo Gemini las da.
  fanoutQueries?: string[];
}

export type Provider = (params: AskParams) => Promise<AskResult>;

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

// Helper compartido: timeout para no colgar una ejecución entera.
export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 60000
): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body = await res.text();
    if (!res.ok) {
      throw new ProviderError(`HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    return body ? JSON.parse(body) : {};
  } finally {
    clearTimeout(t);
  }
}
