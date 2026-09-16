import Redis, { type RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Redis is the coordination layer: Socket.IO pub/sub across API instances,
 * live presence counters, and short-lived join/session state. Nothing
 * authoritative lives here — PostgreSQL remains the source of truth, so a
 * Redis flush degrades presence counters but never loses a meeting.
 */

const baseOptions: RedisOptions = {
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy(times) {
    // Back off to at most 5s; keep retrying so a Redis restart self-heals.
    return Math.min(times * 200, 5000);
  },
};

/**
 * Command clients fail fast; pub/sub clients queue forever.
 *
 * These two need opposite policies, and conflating them is an outage waiting
 * to happen. A command client with `maxRetriesPerRequest: null` never rejects
 * while Redis is unreachable — it queues indefinitely. Because the HTTP rate
 * limiter awaits Redis on *every* request, that turns a brief Redis blip into
 * an API that accepts connections and then answers nothing, which is far worse
 * than returning errors. Command clients therefore get bounded retries and a
 * command timeout, and callers are expected to handle rejection.
 *
 * The Socket.IO adapter is the exception: its pub/sub connections must survive
 * a reconnect without dropping their subscriptions, so they keep unlimited
 * retries. They never serve a request path, so they cannot hang one.
 */
export function createRedis(role: string, options: { pubsub?: boolean } = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    ...baseOptions,
    ...(options.pubsub
      ? { maxRetriesPerRequest: null }
      : { maxRetriesPerRequest: 2, commandTimeout: 3000 }),
  });
  client.on('error', (err) => logger.error({ err, role }, 'redis connection error'));
  client.on('ready', () => logger.debug({ role }, 'redis ready'));
  return client;
}

export const redis = createRedis('primary');

export const KEYS = {
  /** Set of connected identities per meeting. */
  presence: (meetingId: string) => `orbit:presence:${meetingId}`,
  /** Set of meeting ids currently live. */
  liveMeetings: 'orbit:meetings:live',
  /** Opaque realtime session token -> participant descriptor. */
  session: (token: string) => `orbit:session:${token}`,
  /** Guards duplicate socket connections for one participant. */
  socketOwner: (meetingId: string, identity: string) => `orbit:socket:${meetingId}:${identity}`,
  /** Sliding counters for abuse protection. */
  rate: (bucket: string, subject: string) => `orbit:rate:${bucket}:${subject}`,
  /** Host absence timer used by the host-disconnect grace period. */
  hostGrace: (meetingId: string) => `orbit:hostgrace:${meetingId}`,
} as const;

export async function checkRedis(): Promise<boolean> {
  try {
    // A health check that can itself hang is not a health check, so the ping
    // races a timeout rather than trusting the client's command timeout alone.
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('redis ping timed out')), 2000).unref();
      }),
    ]);
    return pong === 'PONG';
  } catch (error) {
    logger.error({ err: error }, 'redis health check failed');
    return false;
  }
}

/**
 * Fixed-window counter used for things Fastify's HTTP rate limiter cannot see,
 * such as chat messages and meeting-code guesses over the socket channel.
 * Returns the current count after incrementing.
 */
export async function bumpCounter(bucket: string, subject: string, windowSeconds: number): Promise<number> {
  const key = KEYS.rate(bucket, subject);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count;
}

export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
