# Contributing

Thanks for your interest in improving GEO Visibility Tracker!

## Local setup

Follow the [Quickstart in the README](README.md#quickstart): `npm install`, copy
`.env.local.example` to `.env.local`, run `npm run db:setup -- --seed`, then `npm run dev`.
You need a Postgres database (Supabase free tier works) and at least one provider API key
(Gemini/OpenAI/Perplexity) to test runs end-to-end.

## Pull requests

- Branch from `main`, one focused change per PR.
- Run `npm run build` (and `npm run lint` if you touched TS/TSX) before opening the PR — CI runs
  the same build on every PR.
- Describe *what* changed and *why*; screenshots welcome for UI changes.

## Architecture principle to respect

**No automatic Anthropic API calls from server code.** Entity extraction, recommendation
writing, and GEO audits are performed in a Claude Code session (or by hand), not by baked-in API
calls. The only endpoint allowed to use `ANTHROPIC_API_KEY` is the optional
`/api/suggest-prompts`. The only automatic paid calls are to the models being measured
(Gemini/OpenAI/Perplexity). Please keep new features consistent with this.

## Good first contributions

- Translating the UI to English (currently in Spanish).
- New provider adapters in `lib/providers/` (must expose citations/web search where available).
- Alerts, multi-user support, or export features.
