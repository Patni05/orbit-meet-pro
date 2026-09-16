import { env } from './config/env';
import { logger } from './lib/logger';
import { disconnectPrisma } from './lib/prisma';
import { disconnectRedis } from './lib/redis';
import { createRealtime } from './realtime/gateway';
import { buildServer } from './server';

/**
 * Boot sequence.
 *
 * Fastify owns the HTTP server; the realtime gateway attaches to the same
 * server so REST and WebSocket traffic share one port and one TLS termination
 * point in production.
 */
async function main(): Promise<void> {
  const app = await buildServer();

  // Socket.IO attaches to Fastify's underlying Node server, which exists as
  // soon as the instance is built. Both must be wired up before `listen`,
  // because Fastify refuses new decorators once the server has started.
  const realtime = await createRealtime(app.server);
  app.decorate('realtime', realtime);

  await app.listen({ port: env.PORT, host: env.HOST });

  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      appUrl: env.APP_URL,
      livekit: env.LIVEKIT_PUBLIC_URL,
    },
    'Orbit API listening',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Give in-flight requests a moment, then release every resource so the
    // process exits cleanly instead of being killed.
    const timeout = setTimeout(() => {
      logger.warn('forced exit after shutdown timeout');
      process.exit(1);
    }, 10_000);
    timeout.unref();

    try {
      await realtime.close();
      await app.close();
      await disconnectPrisma();
      await disconnectRedis();
      clearTimeout(timeout);
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start Orbit API');
  process.exit(1);
});
