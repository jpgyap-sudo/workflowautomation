import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS ?? 15);

export let cacheClient: Awaited<ReturnType<typeof createClient>> | null = null;

try {
  cacheClient = createClient({ url: REDIS_URL });
  cacheClient.on('error', (err) => console.warn('[cache] Redis error (non-fatal):', err.message));
  await cacheClient.connect();
  console.log('[cache] Redis connected');
} catch (err) {
  console.warn('[cache] Redis unavailable — running without cache');
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!cacheClient?.isOpen) return null;
  try {
    const raw = await cacheClient.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function cacheSet(key: string, data: unknown, ttl = CACHE_TTL_SECONDS): Promise<void> {
  if (!cacheClient?.isOpen) return;
  try {
    await cacheClient.setEx(key, ttl, JSON.stringify(data));
  } catch { /* ignore */ }
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (!cacheClient?.isOpen || keys.length === 0) return;
  try {
    await cacheClient.del(keys);
  } catch { /* ignore */ }
}

export async function cacheDeletePattern(pattern: string): Promise<void> {
  if (!cacheClient?.isOpen) return;
  try {
    const keys = await cacheClient.keys(pattern);
    if (keys.length > 0) await cacheClient.del(keys);
  } catch { /* ignore */ }
}
