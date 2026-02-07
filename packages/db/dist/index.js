"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withTransaction = withTransaction;
exports.query = query;
exports.closePool = closePool;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 10000,
});
async function withTransaction(handler) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await handler(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
async function query(text, params) {
    return pool.query(text, params);
}
async function closePool() {
    await pool.end();
}
