// Aplica db/schema.sql y (opcionalmente) db/seed.sql sobre la DATABASE_URL.
// Uso:
//   node scripts/db-setup.mjs          -> solo esquema
//   node scripts/db-setup.mjs --seed   -> esquema + datos de ejemplo
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Carga .env.local de forma sencilla (sin dependencias externas).
try {
  const env = readFileSync(join(root, ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // sin .env.local; se asume DATABASE_URL en el entorno
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("✖ Falta DATABASE_URL (en .env.local o entorno).");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

const runSeed = process.argv.includes("--seed");
const reset = process.argv.includes("--reset");

try {
  await client.connect();
  if (reset) {
    console.log("→ Borrando tablas existentes (--reset)…");
    await client.query(
      "DROP TABLE IF EXISTS recommendations, entities, fanout_queries, citations, mentions, responses, runs, prompts, models, platforms, brands CASCADE"
    );
    console.log("✔ Tablas borradas.");
  }
  console.log("→ Aplicando esquema (db/schema.sql)…");
  await client.query(readFileSync(join(root, "db/schema.sql"), "utf8"));
  console.log("✔ Esquema aplicado.");

  if (runSeed) {
    console.log("→ Insertando datos de ejemplo (db/seed.sql)…");
    await client.query(readFileSync(join(root, "db/seed.sql"), "utf8"));
    console.log("✔ Seed aplicado.");
  } else {
    console.log("ℹ Ejecuta con --seed para cargar datos de ejemplo.");
  }
} catch (err) {
  console.error("✖ Error:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
