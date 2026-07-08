-- Seed mínimo: solo los modelos LLM a medir (genéricos, sin datos de empresa).
--
-- Este proyecto NO incluye marcas, competidores ni prompts de ejemplo: cada
-- instalación configura los suyos desde la UI de Configuración (/prompts) una
-- vez la app está en marcha.
--
-- Ni siquiera necesitas conocer a tus competidores de antemano: al ejecutar
-- las consultas, la extracción de entidades revela las marcas que la IA
-- menciona junto a la tuya, y las añades como competidores desde la misma UI.

-- ---------- MODELOS ----------
-- Los tres proveedores soportados, con búsqueda web activada para reflejar lo
-- que ve un usuario real. Puedes cambiarlos o desactivarlos desde la UI.
INSERT INTO models (provider, model_name, label, web_search_enabled, active)
SELECT 'gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM models WHERE provider='gemini' AND model_name='gemini-2.5-flash');

INSERT INTO models (provider, model_name, label, web_search_enabled, active)
SELECT 'perplexity', 'sonar', 'Perplexity (Sonar)', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM models WHERE provider='perplexity' AND model_name='sonar');

INSERT INTO models (provider, model_name, label, web_search_enabled, active)
SELECT 'openai', 'gpt-4o-mini', 'ChatGPT (gpt-4o-mini)', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM models WHERE provider='openai' AND model_name='gpt-4o-mini');
