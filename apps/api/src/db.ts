import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                          // Max connections in pool
  idleTimeoutMillis: 30_000,        // Close idle connections after 30s
  connectionTimeoutMillis: 5_000,   // Fail fast if DB is down
  allowExitOnIdle: false,
});

// Log pool errors so they don't silently kill queries
pool.on('error', (err) => console.error('[db] Unexpected pool error:', err.message));

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  // Log slow queries (>100ms) for debugging
  if (duration > 100) {
    console.warn(`[db] Slow query (${duration}ms): ${text.substring(0, 120)}`);
  }
  return result.rows as T[];
}
