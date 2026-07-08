import { AskParams, AskResult, ProviderError } from "./types";
import { ask as openai } from "./openai";
import { ask as perplexity } from "./perplexity";
import { ask as gemini } from "./gemini";

// Claude/Anthropic NO se usa como buscador a propósito: solo responden modelos
// de búsqueda real (con web). El análisis de entidades ya no se automatiza vía
// API: se hace directamente en una sesión de Claude Code, sin coste de API.
const REGISTRY: Record<string, (p: AskParams) => Promise<AskResult>> = {
  openai,
  perplexity,
  gemini,
};

export const SUPPORTED_PROVIDERS = Object.keys(REGISTRY);

// Pregunta a un proveedor por su nombre. Lanza si el proveedor no existe.
export function ask(
  provider: string,
  params: AskParams
): Promise<AskResult> {
  const fn = REGISTRY[provider];
  if (!fn) {
    throw new ProviderError(
      `Proveedor desconocido: "${provider}". Soportados: ${SUPPORTED_PROVIDERS.join(", ")}`
    );
  }
  return fn(params);
}
