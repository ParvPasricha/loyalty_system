import { Pool } from "pg";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
}
export const pool = new Pool({
    connectionString: databaseUrl
});
export async function query(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows;
}
export async function queryOne(text, params = []) {
    const rows = await query(text, params);
    return rows[0] ?? null;
}
