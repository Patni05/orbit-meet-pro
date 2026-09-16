import type { FastifyPluginAsync } from 'fastify';
import type { HealthReport } from '@orbit/shared';
import { env } from '../../config/env';
import { checkLivekit } from '../../lib/livekit';
import { checkDatabase } from '../../lib/prisma';
import { checkRedis } from '../../lib/redis';

const startedAt = Date.now();
const VERSION = process.env.npm_package_version ?? '1.0.0';

/**
 * Health and public configuration.
 *
 * `/health` is deliberately shallow on detail: it reports whether dependencies
 * answer, never connection strings, credentials or meeting contents.
 */
const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (_request, reply) => {
    // Every probe is bounded and settled together, so the endpoint's worst case
    // is one timeout rather than the sum of three.
    const [database, redisOk, livekit, activeMeetings] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkLivekit(),
      fastify.realtime.activeMeetings().catch(() => 0),
    ]);

    const report: HealthReport = {
      status: database && redisOk && livekit === 'ok' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      version: VERSION,
      checks: {
        database: database ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
        livekit,
      },
      metrics: {
        activeMeetings,
        connectedParticipants: fastify.realtime.connectedParticipants(),
      },
    };

    // Degraded is still a 200 for load balancers that only need liveness;
    // a hard failure of the database returns 503 so traffic is shifted away.
    return reply.code(report.checks.database === 'ok' ? 200 : 503).send(report);
  });

  /**
   * Liveness only — no dependency checks, for container probes.
   *
   * Rate limiting is disabled here because the limiter itself talks to Redis.
   * A liveness probe that can be slowed by a failing dependency is exactly the
   * probe that gets a healthy process killed during an incident.
   */
  fastify.get('/health/live', { config: { rateLimit: false } }, async (_request, reply) =>
    reply.send({ status: 'ok' }),
  );

  /** Non-secret client configuration. Never includes API keys. */
  fastify.get('/config', async (_request, reply) =>
    reply.send({
      appUrl: env.APP_URL,
      features: {
        recording: env.RECORDING_ENABLED,
        debugPanel: env.ENABLE_DEBUG_ENDPOINTS,
      },
    }),
  );
};

export default healthRoutes;
