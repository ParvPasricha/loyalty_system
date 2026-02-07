import { type PoolClient, type QueryResult, type QueryResultRow } from "pg";
export declare function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T>;
export declare function query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
export declare function closePool(): Promise<void>;
