import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { ask } from "@/lib/providers";
import { detectMentions, parseCitations, Brand } from "@/lib/analyze";

// Ejecuta todos los prompts activos contra todos los modelos activos: la
// llamada a los proveedores que se mide (Gemini/OpenAI/Perplexity), más el
// análisis por regex (menciones/citas/fan-out). La extracción de entidades de
// marca con Claude NO se automatiza aquí: se hace en una sesión de Claude Code
// (dentro de la suscripción, sin coste de API) cuando se pide expresamente.
// Se invoca desde el botón "Ejecutar llamada API y analizar" del dashboard.
export const runtime = "nodejs";
export const maxDuration = 300; // hasta 5 min para procesar todos los prompts

function authorized(req: NextRequest): boolean {
  // El botón "Ejecutar ahora" del dashboard es una petición same-origin: la
  // permitimos. Para disparos externos (curl o un cron del sistema) se acepta
  // el RUN_SECRET por cabecera Authorization o por query ?secret=.
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  if (origin && host) {
    try {
      if (new URL(origin).host === host) return true;
    } catch {} // Origin malformado → sigue con la comprobación del secreto
  }

  const secret = process.env.RUN_SECRET;
  if (!secret) return true; // sin secreto configurado (uso local)

  const header = req.headers.get("authorization") ?? "";
  const fromQuery = req.nextUrl.searchParams.get("secret") ?? "";
  return header === `Bearer ${secret}` || fromQuery === secret;
}

export async function POST(req: NextRequest) {
  return run(req);
}

// Aceptamos GET además de POST para poder dispararlo desde el navegador o curl.
export async function GET(req: NextRequest) {
  return run(req);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const prompts = await query<{
    id: number;
    text: string;
  }>("SELECT id, text FROM prompts WHERE active = TRUE ORDER BY id");
  const models = await query<{
    id: number;
    provider: string;
    model_name: string;
    web_search_enabled: boolean;
  }>(
    "SELECT id, provider, model_name, web_search_enabled FROM models WHERE active = TRUE ORDER BY id"
  );
  const brands = await query<Brand>(
    "SELECT id, name, aliases, domain, is_own FROM brands"
  );
  const ownDomain = brands.find((b) => b.is_own)?.domain ?? null;

  if (prompts.length === 0 || models.length === 0) {
    return NextResponse.json(
      { error: "Necesitas al menos 1 prompt y 1 modelo activos." },
      { status: 400 }
    );
  }

  const run = await queryOne<{ id: number }>(
    "INSERT INTO runs (status) VALUES ('running') RETURNING id"
  );
  const runId = run!.id;

  let ok = 0;
  let failed = 0;

  // Secuencial para no saturar rate limits ni la conexión serverless.
  for (const p of prompts) {
    for (const m of models) {
      try {
        const result = await askWithRetry(m.provider, {
          prompt: p.text,
          modelName: m.model_name,
          webSearch: m.web_search_enabled,
        });
        const resp = await queryOne<{ id: number }>(
          "INSERT INTO responses (run_id, prompt_id, model_id, raw_text) VALUES ($1,$2,$3,$4) RETURNING id",
          [runId, p.id, m.id, result.text]
        );
        const mentions = detectMentions(result.text, brands);
        for (const mention of mentions) {
          await query(
            `INSERT INTO mentions (response_id, brand_id, mentioned, first_position, rank)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (response_id, brand_id) DO NOTHING`,
            [resp!.id, mention.brandId, mention.mentioned, mention.firstPosition, mention.rank]
          );
        }
        // Citas (dominios) de los proveedores con búsqueda web.
        const cites = parseCitations(result.citations ?? [], ownDomain);
        for (const c of cites) {
          await query(
            "INSERT INTO citations (response_id, domain, url, position, is_own) VALUES ($1,$2,$3,$4,$5)",
            [resp!.id, c.domain, c.url, c.position, c.isOwn]
          );
        }
        // Fan-out queries (sub-búsquedas internas del modelo). Solo Gemini.
        const fanout = result.fanoutQueries ?? [];
        for (let i = 0; i < fanout.length; i++) {
          await query(
            "INSERT INTO fanout_queries (response_id, query, position) VALUES ($1,$2,$3)",
            [resp!.id, fanout[i], i + 1]
          );
        }
        ok++;
      } catch (err: any) {
        await query(
          "INSERT INTO responses (run_id, prompt_id, model_id, raw_text, error) VALUES ($1,$2,$3,'',$4)",
          [runId, p.id, m.id, String(err?.message ?? err).slice(0, 1000)]
        );
        failed++;
      }
      // Margen entre llamadas para respetar los límites por minuto (Gemini free).
      await sleep(800);
    }
  }

  await query(
    "UPDATE runs SET finished_at = now(), status = $2, note = $3 WHERE id = $1",
    [runId, failed > 0 && ok === 0 ? "error" : "done", `${ok} ok, ${failed} con error`]
  );

  return NextResponse.json({ runId, ok, failed });
}
