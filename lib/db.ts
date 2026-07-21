import { Pool, PoolClient } from "pg";

// Pool único reutilizado entre invocaciones.
// Usa DATABASE_URL (Supabase u otro Postgres). SSL requerido por Postgres gestionado.
declare global {
  var _geoTrackerPool: Pool | undefined;
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
  if (!global._geoTrackerPool) global._geoTrackerPool = createPool();
  return global._geoTrackerPool;
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

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
