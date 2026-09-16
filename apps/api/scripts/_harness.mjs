/**
 * Shared setup for the integration scripts.
 *
 * Two things every suite needs before it can trust its own results.
 */

import Redis from 'ioredis';

/**
 * Waits until the API is genuinely serving.
 *
 * A freshly started server spends its first seconds opening database and Redis
 * connections, and these suites contain real deadlines — a cold start would
 * surface as a timing failure that says nothing about the code.
 */
export async function waitForApi(api, attempts = 20) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${api}/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const body = await response.json();
        if (body?.checks?.database === 'ok' && body?.checks?.redis === 'ok') return;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`API at ${api} did not become healthy`);
}

/**
 * Clears the HTTP rate-limit budget.
 *
 * Registration is capped at ten accounts per five minutes per address, which
 * is the right production setting — and exactly what several integration
 * suites run back to back look like. Rather than weakening a real control to
 * make tests pass, each suite resets its own budget first.
 *
 * Only the rate-limit namespace is touched, so this cannot mask a bug by
 * wiping application state. If Redis is unreachable the suite continues and
 * simply reports the 429 it then receives.
 */
export async function clearRateLimits() {
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
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'orbit:*rate*', 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');

    // The HTTP limiter keeps its own namespace.
    cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'orbit:http:*', 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    // Not fatal; the suite will report whatever the API says.
  } finally {
    redis.disconnect();
  }
}

/** Fails loudly when an account could not be created, rather than later. */
export function requireToken(body, who) {
  if (!body?.accessToken) {
    throw new Error(
      `could not register ${who}: ${JSON.stringify(body)?.slice(0, 200)}. ` +
        'If this is a 429, the rate-limit reset did not run.',
    );
  }
  return body.accessToken;
}
