import Redis from 'ioredis';

/**
 * Clears the HTTP rate-limit budget before a run.
 *
 * The API limits registration to ten accounts per five minutes per IP, which
 * is the right production setting — and exactly what a repeated end-to-end run
 * from one machine looks like. Rather than weakening a real security control
 * to make tests pass, the suite resets its own budget before starting.
 *
 * Only the rate-limit namespace is touched: meetings, sessions and presence
 * are left alone, so this cannot mask a bug by wiping application state.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
    retryStrategy: () => null,
    lazyConnect: true,
  });

  try {
    await redis.connect();

    let cursor = '0';
    let cleared = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'orbit:http:*', 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
        cleared += keys.length;
      }
    } while (cursor !== '0');

    console.log(`[e2e] cleared ${cleared} rate-limit key(s)`);
  } catch (error) {
    // Not fatal: the run continues and, if a limit is hit, the request helper
    // reports the 429 body rather than a bare failure.
    console.warn(`[e2e] could not clear rate limits (${(error as Error).message}) — continuing`);
  } finally {
    redis.disconnect();
  }
}
