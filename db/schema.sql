-- GEO Visibility Tracker — esquema de base de datos (Postgres / Supabase)
-- Aplica con:  npm run db:setup            (crea tablas si no existen)
--              npm run db:setup -- --reset (borra y recrea; útil tras cambios de esquema)
--              npm run db:setup -- --seed   (carga datos reales)

-- Marcas: la propia + competidores. aliases = variantes; domain = dominio para citas.
CREATE TABLE IF NOT EXISTS brands (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  domain  TEXT,
  is_own  BOOLEAN NOT NULL DEFAULT FALSE,
  active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prompts a lanzar. query_type y brand_focus replican la categorización de LLMPulse.
CREATE TABLE IF NOT EXISTS prompts (
  id          SERIAL PRIMARY KEY,
  text        TEXT NOT NULL,
  market      TEXT NOT NULL DEFAULT 'ES',
  language    TEXT NOT NULL DEFAULT 'es',
  query_type  TEXT NOT NULL DEFAULT 'Commercial',   -- Commercial | Informational | Transactional | Navigational
  brand_focus TEXT NOT NULL DEFAULT 'Non-Brand',     -- Own Brand | Non-Brand | Competitor
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plataformas de análisis/datos para GEO (Search Console, Analytics, Ahrefs…).
-- Registro informativo de fuentes: la integración real la hace Claude Code vía MCP.
CREATE TABLE IF NOT EXISTS platforms (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'other',  -- search-console | analytics | seo | ai | other
  reference  TEXT,                            -- propiedad/sitio/ID (ej. sc-domain:example.com)
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modelos LLM configurados.
CREATE TABLE IF NOT EXISTS models (
  id                 SERIAL PRIMARY KEY,
  provider           TEXT NOT NULL,
  model_name         TEXT NOT NULL,
  label              TEXT NOT NULL,
  web_search_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada ejecución periódica (manual o por cron).
CREATE TABLE IF NOT EXISTS runs (
  id          SERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'running',
  note        TEXT,
  config_snapshot JSONB NOT NULL DEFAULT '{}',
  panel_fingerprint TEXT,
  analyzer_version TEXT NOT NULL DEFAULT 'regex-v2',
  heartbeat_at TIMESTAMPTZ
);

-- Respuesta cruda de un modelo a un prompt dentro de una ejecución.
CREATE TABLE IF NOT EXISTS responses (
  id         SERIAL PRIMARY KEY,
  run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  prompt_id  INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  model_id   INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  raw_text    TEXT NOT NULL DEFAULT '',
  error       TEXT,
  analyzed_at TIMESTAMPTZ,  -- cuándo lo procesó el análisis de Claude (NULL = pendiente)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Menciones: ¿aparece cada marca conocida?, posición del carácter y rank.
-- Se llenan con detección por regex (lista fija de brands) durante el run.
CREATE TABLE IF NOT EXISTS mentions (
  id             SERIAL PRIMARY KEY,
  response_id    INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  brand_id       INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  mentioned        BOOLEAN NOT NULL DEFAULT FALSE,
  first_position   INTEGER,  -- índice del carácter de la 1ª aparición
  rank             INTEGER,  -- 1 = primera marca citada en la respuesta (NULL si no aparece)
  source           TEXT NOT NULL DEFAULT 'regex',  -- regex | claude (cómo se detectó)
  sentiment        INTEGER,  -- 1..5 (NULL = sin analizar). Solo la marca propia, cuando mentioned=true. Lo escribe Claude en sesión.
  sentiment_reason TEXT,     -- justificación breve del juicio de sentimiento (Claude)
  UNIQUE (response_id, brand_id)
);

-- Citas (Citation): dominios que el modelo usó como FUENTE de la respuesta
-- (de los proveedores con búsqueda web: Perplexity, Gemini grounding).
CREATE TABLE IF NOT EXISTS citations (
  id          SERIAL PRIMARY KEY,
  response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,
  url         TEXT,
  provider_url TEXT,
  title       TEXT,
  position    INTEGER,
  is_own      BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE si el dominio es el de la marca propia
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fan-out queries: las sub-búsquedas que el modelo lanza internamente para
-- responder ("cómo busca el LLM"). Solo Gemini las expone (webSearchQueries).
CREATE TABLE IF NOT EXISTS fanout_queries (
  id          SERIAL PRIMARY KEY,
  response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  query       TEXT NOT NULL,
  position    INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Entidades de marca: TODAS las marcas/empresas que aparecen en una respuesta,
-- descubiertas por Claude (no solo las de la lista fija). canonical_name agrupa
-- variantes; is_own = es la marca propia; is_known = está en la tabla brands.
CREATE TABLE IF NOT EXISTS entities (
  id             SERIAL PRIMARY KEY,
  response_id    INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,  -- nombre normalizado para agrupar/contar
  raw_name       TEXT NOT NULL,  -- cómo aparecía literalmente en el texto
  is_own         BOOLEAN NOT NULL DEFAULT FALSE,
  is_known       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (response_id, canonical_name)
);

-- Recomendaciones GEO: lista de tareas para mejorar la visibilidad en IA.
-- Se generan por ejecución (reglas detectan huecos + Claude las redacta).
CREATE TABLE IF NOT EXISTS recommendations (
  id         SERIAL PRIMARY KEY,
  run_id     INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  priority   INTEGER NOT NULL DEFAULT 2,      -- 1 = alta, 2 = media, 3 = baja
  category   TEXT NOT NULL DEFAULT 'general', -- contenido | reputacion | citaciones | competencia | general
  title      TEXT NOT NULL,
  action     TEXT NOT NULL,                   -- qué hacer, accionable
  rationale  TEXT NOT NULL DEFAULT '',        -- por qué (hueco detectado en los datos)
  done       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auditorías GEO técnicas (agente seo-geo): salud de un dominio de cara a
-- crawlers de IA y citabilidad. Complementa la visibilidad "de resultado"
-- (mentions/citations/entities) con el diagnóstico "de causa" a nivel de sitio.
CREATE TABLE IF NOT EXISTS geo_audits (
  id               SERIAL PRIMARY KEY,
  domain           TEXT NOT NULL,                  -- p.ej. example.com
  score            INTEGER NOT NULL,               -- GEO Health Score 0-100
  dimensions       JSONB NOT NULL DEFAULT '{}',    -- {citability, structuralReadability, multiModal, authority, technicalAccess} 0-100 c/u
  crawler_access   JSONB NOT NULL DEFAULT '{}',    -- {GPTBot: "allowed"|"blocked", ClaudeBot: ..., PerplexityBot: ..., OAI-SearchBot: ...}
  llms_txt_status  TEXT,                           -- present | missing | malformed
  platform_scores  JSONB NOT NULL DEFAULT '{}',    -- {googleAIO, chatgpt, perplexity, bingCopilot} 0-100 c/u
  recommendations  JSONB NOT NULL DEFAULT '[]',    -- [{title, action, impact, effort}]
  notes            TEXT,
  auditor_version  TEXT,
  evidence         JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migración de bases existentes (CREATE TABLE IF NOT EXISTS no altera tablas ya creadas).
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS sentiment INTEGER;
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS sentiment_reason TEXT;
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS sentiment_model TEXT;
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS sentiment_rubric_version TEXT;
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS sentiment_analyzed_at TIMESTAMPTZ;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS config_snapshot JSONB NOT NULL DEFAULT '{}';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS panel_fingerprint TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS analyzer_version TEXT NOT NULL DEFAULT 'regex-v2';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE citations ADD COLUMN IF NOT EXISTS provider_url TEXT;
ALTER TABLE citations ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS analyzer_version TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS analysis_metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS generator_version TEXT;
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS source_context JSONB NOT NULL DEFAULT '{}';
ALTER TABLE geo_audits ADD COLUMN IF NOT EXISTS auditor_version TEXT;
ALTER TABLE geo_audits ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]';

-- Unidades idempotentes y recuperables de una ejecución.
CREATE TABLE IF NOT EXISTS run_items (
  id          SERIAL PRIMARY KEY,
  run_id      INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  prompt_id   INTEGER NOT NULL REFERENCES prompts(id) ON DELETE RESTRICT,
  model_id    INTEGER NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
  response_id INTEGER REFERENCES responses(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (run_id, prompt_id, model_id),
  CHECK (status IN ('pending', 'running', 'done', 'error')),
  CHECK (attempts >= 0)
);

-- Representa también el histórico previo a run_items; se marca como ya
-- procesado y no se intenta reconstruir una configuración que no se guardó.
INSERT INTO run_items
  (run_id, prompt_id, model_id, response_id, status, attempts, error, started_at, finished_at)
SELECT r.run_id, r.prompt_id, r.model_id, r.id,
       CASE WHEN r.error IS NULL THEN 'done' ELSE 'error' END,
       1, r.error, r.created_at, r.created_at
FROM responses r
ON CONFLICT (run_id, prompt_id, model_id) DO NOTHING;

-- Preserva hechos históricos aunque se archive configuración.
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_prompt_id_fkey;
ALTER TABLE responses ADD CONSTRAINT responses_prompt_id_fkey
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE RESTRICT;
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_model_id_fkey;
ALTER TABLE responses ADD CONSTRAINT responses_model_id_fkey
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE RESTRICT;
ALTER TABLE mentions DROP CONSTRAINT IF EXISTS mentions_brand_id_fkey;
ALTER TABLE mentions ADD CONSTRAINT mentions_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE RESTRICT;

-- Constraints de dominio que antes solo existían en comentarios.
DO $$ BEGIN
  ALTER TABLE mentions ADD CONSTRAINT mentions_sentiment_range CHECK (sentiment IS NULL OR sentiment BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE recommendations ADD CONSTRAINT recommendations_priority_range CHECK (priority BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE geo_audits ADD CONSTRAINT geo_audits_score_range CHECK (score BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Limpieza idempotente de duplicados previos antes de imponer unicidad.
DELETE FROM citations a USING citations b
WHERE a.id > b.id
  AND a.response_id = b.response_id
  AND a.domain = b.domain
  AND COALESCE(a.url, '') = COALESCE(b.url, '')
  AND COALESCE(a.provider_url, '') = COALESCE(b.provider_url, '');

CREATE INDEX IF NOT EXISTS idx_responses_run ON responses(run_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_run ON recommendations(run_id);
CREATE INDEX IF NOT EXISTS idx_mentions_response ON mentions(response_id);
CREATE INDEX IF NOT EXISTS idx_mentions_brand ON mentions(brand_id);
CREATE INDEX IF NOT EXISTS idx_citations_response ON citations(response_id);
CREATE INDEX IF NOT EXISTS idx_fanout_response ON fanout_queries(response_id);
CREATE INDEX IF NOT EXISTS idx_entities_response ON entities(response_id);
CREATE INDEX IF NOT EXISTS idx_entities_canonical ON entities(canonical_name);
CREATE INDEX IF NOT EXISTS idx_geo_audits_domain ON geo_audits(domain, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_run_prompt_model
  ON responses(run_id, prompt_id, model_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_citations_unique_source
  ON citations(response_id, domain, COALESCE(url, ''), COALESCE(provider_url, ''));
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_own_active_brand
  ON brands ((1)) WHERE is_own = TRUE AND active = TRUE;
CREATE INDEX IF NOT EXISTS idx_run_items_run_status ON run_items(run_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_running_run
  ON runs ((1)) WHERE status = 'running';
