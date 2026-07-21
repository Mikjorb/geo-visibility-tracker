import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import { ask } from "@/lib/providers";
import { detectMentions, parseCitations, Brand } from "@/lib/analyze";
import { hasValidSession, safeEqual } from "@/lib/auth";

// Ejecuta todos los prompts activos contra todos los modelos activos: la
// llamada a los proveedores que se mide (Gemini/OpenAI/Perplexity), más el
// análisis por regex (menciones/citas/fan-out). La extracción de entidades de
// marca con Claude NO se automatiza aquí: se hace en una sesión de Claude Code
// (dentro de la suscripción, sin coste de API) cuando se pide expresamente.
// Se invoca desde el botón "Ejecutar llamada API y analizar" del dashboard.
export const runtime = "nodejs";
export const maxDuration = 300; // hasta 5 min para procesar todos los prompts

function authorized(req: NextRequest): boolean {
  const passwordConfigured = !!process.env.APP_PASSWORD;
  if (passwordConfigured && hasValidSession(req)) return true;
  const secret = process.env.RUN_SECRET;
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    return safeEqual(header, `Bearer ${secret}`);
  }
  return !passwordConfigured; // modo local explícitamente sin protección
}

export async function POST(req: NextRequest) {
  return run(req);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ANALYZER_VERSION = "regex-v2";

// Llama al proveedor con reintento ante errores transitorios: 429 (rate limit)
// y 503 (modelo saturado, típico de Gemini). Respeta el "retry in Xs" que
// devuelven algunos proveedores; tope de 18s por espera y 3 intentos.
async function askWithRetry(provider: string, params: Parameters<typeof ask>[1]) {
  let lastErr: unknown;
  // Hasta 2 reintentos con espera corta, para no agotar el tiempo de ejecución.
  // Si el error transitorio persiste, se registra como fallo y se sigue.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ask(provider, params);
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      // Solo reintentamos errores transitorios; el resto se propaga ya.
      const transient = /\b(429|503)\b/.test(msg) || /overloaded|unavailable/i.test(msg);
      if (!transient || attempt === 2) throw err;
      const m = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
      const waitMs = Math.min(m ? Math.ceil(parseFloat(m[1])) * 1000 : 12000, 18000);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Una caída antigua no debe bloquear todos los runs para siempre.
  await query(
    `UPDATE runs SET status = 'error', finished_at = now(),
       note = concat_ws('; ', note, 'interrumpido: heartbeat caducado')
     WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) < now() - interval '15 minutes'`
  );
  await query(
    `UPDATE run_items SET status = 'error', error = COALESCE(error, 'ejecución interrumpida'), finished_at = now()
     WHERE status = 'running' AND run_id IN (SELECT id FROM runs WHERE status = 'error')`
  );

  const resumeRunId = Number(req.nextUrl.searchParams.get("resumeRunId")) || null;
  let runId: number;

  if (resumeRunId) {
    const resumed = await query<{ id: number }>(
      `UPDATE runs SET status = 'running', finished_at = NULL, heartbeat_at = now()
       WHERE id = $1 AND status IN ('error', 'partial') RETURNING id`,
      [resumeRunId]
    );
    if (!resumed[0])
      return NextResponse.json({ error: "El run no existe, ya terminó o sigue ejecutándose." }, { status: 409 });
    runId = resumed[0].id;
  } else {
    const [prompts, models, brands] = await Promise.all([
      query<{ id: number; text: string; market: string; language: string; query_type: string; brand_focus: string }>(
        "SELECT id, text, market, language, query_type, brand_focus FROM prompts WHERE active = TRUE ORDER BY id"
      ),
      query<{
    id: number;
    provider: string;
    model_name: string;
    label: string;
    web_search_enabled: boolean;
      }>("SELECT id, provider, model_name, label, web_search_enabled FROM models WHERE active = TRUE ORDER BY id"),
      query<Brand>("SELECT id, name, aliases, domain, is_own FROM brands WHERE active = TRUE ORDER BY id"),
    ]);
    if (prompts.length === 0 || models.length === 0)
      return NextResponse.json({ error: "Necesitas al menos 1 prompt y 1 modelo activos." }, { status: 400 });

    const snapshot = { prompts, models, brands, analyzerVersion: ANALYZER_VERSION };
    const serialized = JSON.stringify(snapshot);
    const fingerprint = createHash("sha256").update(serialized).digest("hex");
    try {
      runId = await withTransaction(async (client) => {
        const result = await client.query<{ id: number }>(
          `INSERT INTO runs (status, config_snapshot, panel_fingerprint, analyzer_version, heartbeat_at)
           VALUES ('running', $1, $2, $3, now()) RETURNING id`,
          [serialized, fingerprint, ANALYZER_VERSION]
        );
        const id = result.rows[0].id;
        for (const prompt of prompts)
          for (const model of models)
            await client.query(
              "INSERT INTO run_items (run_id, prompt_id, model_id) VALUES ($1,$2,$3)",
              [id, prompt.id, model.id]
            );
        return id;
      });
    } catch (error: any) {
      if (error?.code === "23505")
        return NextResponse.json({ error: "Ya hay una ejecución activa." }, { status: 409 });
      throw error;
    }
  }

  const items = await query<{
    id: number;
    prompt_id: number;
    prompt_text: string;
    model_id: number;
    provider: string;
    model_name: string;
    web_search_enabled: boolean;
  }>(
    `SELECT ri.id, ri.prompt_id, p.text AS prompt_text, ri.model_id,
            m.provider, m.model_name, m.web_search_enabled
     FROM run_items ri JOIN prompts p ON p.id = ri.prompt_id
     JOIN models m ON m.id = ri.model_id
     WHERE ri.run_id = $1 AND ri.status IN ('pending', 'error')
     ORDER BY ri.id`,
    [runId]
  );
  const snapshotRows = await query<{ brands: Brand[] }>(
    "SELECT config_snapshot->'brands' AS brands FROM runs WHERE id=$1",
    [runId]
  );
  const brands = snapshotRows[0]?.brands ?? [];
  const ownDomain = brands.find((b) => b.is_own)?.domain ?? null;

  for (const item of items) {
    await query(
      "UPDATE run_items SET status='running', attempts=attempts+1, started_at=now(), error=NULL WHERE id=$1",
      [item.id]
    );
    await query("UPDATE runs SET heartbeat_at=now() WHERE id=$1", [runId]);
    try {
      const result = await askWithRetry(item.provider, {
        prompt: item.prompt_text,
        modelName: item.model_name,
        webSearch: item.web_search_enabled,
      });
      await withTransaction(async (client) => {
        const response = await client.query<{ id: number }>(
          `INSERT INTO responses (run_id, prompt_id, model_id, raw_text, error)
           VALUES ($1,$2,$3,$4,NULL)
           ON CONFLICT (run_id, prompt_id, model_id)
           DO UPDATE SET raw_text=EXCLUDED.raw_text, error=NULL, created_at=now()
           RETURNING id`,
          [runId, item.prompt_id, item.model_id, result.text]
        );
        const responseId = response.rows[0].id;
        await client.query("DELETE FROM mentions WHERE response_id=$1", [responseId]);
        await client.query("DELETE FROM citations WHERE response_id=$1", [responseId]);
        await client.query("DELETE FROM fanout_queries WHERE response_id=$1", [responseId]);
        await client.query("DELETE FROM entities WHERE response_id=$1", [responseId]);
        for (const mention of detectMentions(result.text, brands))
          await client.query(
            `INSERT INTO mentions (response_id, brand_id, mentioned, first_position, rank)
             VALUES ($1,$2,$3,$4,$5)`,
            [responseId, mention.brandId, mention.mentioned, mention.firstPosition, mention.rank]
          );
        for (const citation of parseCitations(result.citations ?? [], ownDomain))
          await client.query(
            `INSERT INTO citations (response_id, domain, url, provider_url, title, position, is_own)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [responseId, citation.domain, citation.url, citation.providerUrl, citation.title, citation.position, citation.isOwn]
          );
        for (let i = 0; i < (result.fanoutQueries ?? []).length; i++)
          await client.query(
            "INSERT INTO fanout_queries (response_id, query, position) VALUES ($1,$2,$3)",
            [responseId, result.fanoutQueries![i], i + 1]
          );
        await client.query(
          "UPDATE run_items SET status='done', response_id=$2, finished_at=now(), error=NULL WHERE id=$1",
          [item.id, responseId]
        );
      });
    } catch (err: any) {
      const message = String(err?.message ?? err).slice(0, 1000);
      await withTransaction(async (client) => {
        const response = await client.query<{ id: number }>(
          `INSERT INTO responses (run_id, prompt_id, model_id, raw_text, error)
           VALUES ($1,$2,$3,'',$4)
           ON CONFLICT (run_id, prompt_id, model_id)
           DO UPDATE SET raw_text='', error=EXCLUDED.error, created_at=now()
           RETURNING id`,
          [runId, item.prompt_id, item.model_id, message]
        );
        await client.query(
          "UPDATE run_items SET status='error', response_id=$2, error=$3, finished_at=now() WHERE id=$1",
          [item.id, response.rows[0].id, message]
        );
      });
    }
    await sleep(800);
  }

  const totals = await query<{ ok: string; failed: string }>(
    `SELECT COUNT(*) FILTER (WHERE status='done') AS ok,
            COUNT(*) FILTER (WHERE status='error') AS failed
     FROM run_items WHERE run_id=$1`,
    [runId]
  );
  const ok = Number(totals[0]?.ok ?? 0);
  const failed = Number(totals[0]?.failed ?? 0);
  const status = failed === 0 ? "done" : ok === 0 ? "error" : "partial";
  await query(
    "UPDATE runs SET finished_at=now(), heartbeat_at=now(), status=$2, note=$3 WHERE id=$1",
    [runId, status, `${ok} ok, ${failed} con error`]
  );

  return NextResponse.json({ runId, ok, failed, status });
}
