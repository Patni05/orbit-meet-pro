import { PrismaClient } from '@prisma/client';
import { env, isDev } from '../config/env';
import { logger } from './logger';

/**
 * Single Prisma client for the process. In dev the instance is cached on
 * globalThis so `tsx watch` reloads do not exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { __orbitPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__orbitPrisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: isDev
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'error' }],
  });

prisma.$on('error' as never, (e: unknown) => logger.error({ prisma: e }, 'prisma error'));
prisma.$on('warn' as never, (e: unknown) => logger.warn({ prisma: e }, 'prisma warning'));

if (isDev) globalForPrisma.__orbitPrisma = prisma;

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ err: error }, 'database health check failed');
    return false;
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
