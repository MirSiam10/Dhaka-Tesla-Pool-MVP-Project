import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { logger } from '../logger';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
});

pool.on('error', (err) => logger.error({ err }, 'unexpected idle pg client error'));

/** Anything that can run a query: the pool itself or a transaction client. */
export type Db = Pick<PoolClient, 'query'>;

export function query<T extends QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

// 40001 serialization_failure, 40P01 deadlock_detected: safe to retry the whole transaction.
const RETRYABLE = new Set(['40001', '40P01']);

/**
 * Runs `fn` inside BEGIN/COMMIT. Rolls back on any error and retries the whole
 * transaction (up to `attempts`) on deadlock or serialization failures.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (err as { code?: string }).code;
      if (attempt < attempts && code && RETRYABLE.has(code)) {
        logger.warn({ code, attempt }, 'retrying transaction');
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
