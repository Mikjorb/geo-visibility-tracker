import { Pool } from "pg";

// Pool único reutilizado entre invocaciones.
// Usa DATABASE_URL (Supabase u otro Postgres). SSL requerido por Postgres gestionado.
declare global {
  // eslint-disable-next-line no-var
  var _llmTrackPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Falta DATABASE_URL. Copia .env.local.example a .env.local y rellena la cadena de conexión de Supabase."
    );
  }
  return new Pool({
    connectionString,
    // Supabase y la mayoría de Postgres gestionados requieren SSL.
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
    max: 5,
  });
}

// Inicialización perezosa: no se conecta al importar (para no romper el build
// sin DATABASE_URL), solo en la primera consulta real.
export function getPool(): Pool {
  if (!global._llmTrackPool) global._llmTrackPool = createPool();
  return global._llmTrackPool;
}

export async function query<T = any>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = any>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
