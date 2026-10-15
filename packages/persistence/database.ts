import { logger } from "../observability/logger.js";
import pg, { type PoolClient, type QueryResultRow } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
export type Connection = Pick<pg.Pool, "query"> | PoolClient;
export class Database {
  readonly pool: pg.Pool;
  readonly orm: ReturnType<typeof drizzle>;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 12,
      statement_timeout: 15000,
      idle_in_transaction_session_timeout: 30000,
    });
    this.pool.on("error", () => logger.error("database_pool_connection_lost"));
    this.orm = drizzle({ client: this.pool });
  }
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
    tx: Connection = this.pool,
  ): Promise<T[]> {
    return (await tx.query<T>(text, params)).rows;
  }
  async transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      const result = await fn(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
  }
  close(): Promise<void> {
    return this.pool.end();
  }
}
export async function audit(
  tx: Connection,
  org: string,
  actor: string | null,
  action: string,
  target: string,
): Promise<void> {
  await tx.query(
    "INSERT INTO audit_logs(organization_id,actor_id,action,target) VALUES($1,$2,$3,$4)",
    [org, actor, action, target],
  );
}
export async function appendEvent(
  tx: Connection,
  org: string,
  account: string | null,
  type: string,
  aggregate: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    "INSERT INTO outbox_events(organization_id,account_id,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5)",
    [org, account, type, aggregate, payload],
  );
}
