import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 10000,
});

export async function withTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query(text, params);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
