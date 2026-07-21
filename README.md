# ⚡ GEO Visibility Tracker

Self-hosted, lightweight tool to measure **how visible your brand is in LLM answers**
(ChatGPT, Perplexity, Gemini) versus your competitors — the "rank tracker" of the AI-search era,
running locally for **cents of API cost** instead of a 100 €/month SaaS.

It periodically runs your prompts against several LLMs and measures three core signals —
**Response, Mention, and Citation** — aggregated into metrics with history, plus a brand-entity
discovery layer, a GEO recommendations engine, and a technical GEO audit of your site.

## Core concepts

- **Response** — the text an LLM returns for a prompt.
- **Mention** — the model names your brand in the body of the answer.
- **Citation** — your domain appears as a *source* the model used (Perplexity, Gemini grounding).
- **Fan-out queries** — the sub-searches the model runs internally (only Gemini exposes them).
- **Brand entities** — every brand that appears in the answers, discovered from the responses
  themselves (a graph of who co-occurs with your brand).
- **Brand sentiment** — how the AI *perceives* your brand when it mentions it (positive or
  negative). An LLM-as-judge task: each mention of your own brand is scored 1-5 against a
  fixed rubric.
- **GEO Readiness** — technical health of your site for AI crawlers (robots.txt, llms.txt,
  citability, authority): the "why" behind the visibility metrics.

## Metrics

- **AI Visibility Score** (0–1000) — frequency × position of your brand.
- **Mention Rate** — % of responses that mention you.
- **Citation Rate** — % of responses that cite your domain.
- **Share of Voice** — your mentions / (yours + competitors), with ranking.
- **Sentiment Score** (0–100) — brand perception = (mean 1-5 score − 1) / 4 × 100 (1→0, 3→50,
  5→100), with a positive (4-5) / neutral (3) / negative (1-2) breakdown. `—` = not analyzed yet.
- **Top cited domains** and evolution over time.
- **GEO Health Score** (0–100) — per dimension: citability, structural readability, multi-modal,
  authority, technical accessibility.

> ⚠️ **GEO nuance:** calling a model's API is not identical to what a user sees in the app.
> Enable **web search** on models that support it (Perplexity always uses it) for more realism.

## You don't need to know your competitors upfront

Start with just your own brand and your prompts. When you run queries, entity extraction reveals
every brand the AI mentions alongside yours (flagged as "new brand" in the Responses view) — then
you add the relevant ones as competitors in the Configuration UI, and they enter Share of Voice
and the rest of the metrics. The tool *discovers* your AI-search competitors for you.

## Architecture principle: no Anthropic API key baked in

The **Anthropic API is never called automatically from server code** (the only optional exception
is `/api/suggest-prompts`, see below). The "brain" behind entity extraction, recommendation
writing, and GEO audits is a **Claude Code session** — you ask for the analysis in chat, and
Claude reads/writes the database directly. If you have a Claude subscription, that analysis costs
you nothing extra. The only paid API calls are to the models being **measured**
(Gemini/OpenAI/Perplexity) — that cost is the measurement itself and can't be avoided.

## Analysis flows

1. **▶ Run & analyze** (`/api/run`) — runs the active prompts against the active models and
   stores mentions (regex-based), citations, position, and fan-out. The only call that costs
   money, because these are the models being measured.
2. **Brand entities** — to discover **all** brands that appear (not just your configured list),
   ask in a Claude Code session: *"analyze the pending responses and extract entities"* — it reads
   unanalyzed `responses` and writes directly to the `entities` table.
3. **Brand sentiment** — ask in a session: *"analyze the sentiment of the pending mentions"*.
   Claude lists your own brand's unanalyzed mentions (`mentions` with `mentioned = true AND
   sentiment IS NULL`, joined to `responses.raw_text`), judges each one against a fixed rubric —
   **1** very negative · **2** negative · **3** neutral/factual · **4** positive · **5** very
   positive (recommended as leader) — and writes `UPDATE mentions SET sentiment = …,
   sentiment_reason = …, source = 'claude'`. The Dashboard aggregates it into the **Brand
   sentiment** card and the **Sentiment Score** series.
4. **Recommendations** — `POST /api/recommendations` detects gaps rule-based (no AI, no cost)
   aggregating the **full history** of runs (prompts without mention, domains citing competitors,
   low citation rate…) and returns the summary. Then ask in a session: *"update the
   recommendations"* — Claude Code reads that summary, writes the prioritized tasks (quality
   criteria documented in `lib/recommendations.ts`), and saves them via `PUT /api/recommendations`.
   Each recommendation card has a **"Copy as Claude Code task"** button that exports it as a
   self-contained prompt (configure your business context in `PROJECT_CONTEXT`, `app/page.tsx`).
5. **GEO audit** (`/api/geo-audit`) — the "cause-side" technical diagnosis: your site's health for
   AI crawlers. Ask in a session: *"audit the GEO of example.com"* → the agent analyzes the site
   (robots.txt, llms.txt, schema, crawler access) → posts the structured result to
   `/api/geo-audit` → it shows up on the Dashboard under **GEO Readiness**.
6. **Prompt suggestions** (`POST /api/suggest-prompts`, optional) — turns a site/SEO audit corpus
   into natural LLM-style prompts. This is the only endpoint that uses `ANTHROPIC_API_KEY`; leave
   the key empty if you prefer to write prompts by hand or ask for them in a Claude Code session.

## MCP server

The tracker exposes its data as **read-only MCP tools** so you can query it from any compatible
chat (Claude Desktop, Claude Code): `get_visibility`, `get_share_of_voice`, `get_recommendations`,
`get_entities`, `get_geo_audit`, `list_runs`. It connects straight to Postgres (the Next.js server
doesn't need to be running). See [`mcp/README.md`](mcp/README.md) for setup.

## Stack

Next.js (App Router, TypeScript) · Postgres (Supabase free tier works) · Recharts · MCP SDK ·
runs locally by design (your visibility data stays on your machine).

## Quickstart

1. **Dependencies**: `npm install`
2. **Environment**: copy `.env.local.example` to `.env.local` and fill in `DATABASE_URL`
   (for Supabase use the *Transaction pooler*, port 6543) plus the `*_API_KEY` of the providers
   you want to measure (Gemini/OpenAI/Perplexity). `ANTHROPIC_API_KEY` is only needed for
   `/api/suggest-prompts` and can stay empty. Restart `npm run dev` after adding a new key.
3. **Database**: `npm run db:setup -- --seed` (use `-- --reset --seed` to recreate from scratch).
   The seed only adds the three LLM models — no demo brands or prompts.
4. **Start**: `npm run dev` → http://localhost:3000.
5. **Configure**: open **/prompts** and add your own brand (with aliases and domain) and the
   prompts you want to monitor. Then hit **Run** on the Dashboard.

## Project structure

```
app/
  page.tsx              GEO recommendations (home) + PROJECT_CONTEXT for task export
  dashboard/page.tsx    Dashboard (metrics, SoV, entities, fan-out, GEO Readiness)
  prompts/page.tsx      Configuration: brands, prompts, models
  runs/page.tsx         Response viewer (mention + citation + fan-out + entities)
  api/
    run/                Execution engine (button + cron)
    data/               Aggregated metrics
    recommendations/    GEO gap detection + recommendations storage
    suggest-prompts/    Prompt generation from an audit (optional, Anthropic API)
    geo-audit/          GEO audit persistence
    config/             CRUD for brands/prompts/models
    responses/          Raw responses of a run
lib/
  providers/            OpenAI, Perplexity, Gemini adapters
  analyze.ts            Mention detection + metrics (mention rate, SoV, sentiment…) + canonicalBrand
  recommendations.ts    Rule-based gap detection + writing criteria
  suggest-prompts.ts    Prompt generation from an audit
  json.ts               Shared extractJson
  db.ts                 Postgres client
db/
  schema.sql            Schema (brands, prompts, models, runs, responses, mentions, citations,
                        fanout_queries, entities, recommendations, geo_audits)
  seed.sql              Minimal seed (LLM models only)
mcp/
  server.mjs            Read-only MCP server (see mcp/README.md)
```

## Known limitations / roadmap

- **UI is in Spanish** — the tool was born in a Spanish-speaking market. A full English
  translation of the UI is a welcome contribution.
- Models without a public API (Google AI Mode, AI Overviews) are not covered.
- Single-user, local-first by design; no alerts yet.

## License

[MIT](LICENSE) © Miksolid
