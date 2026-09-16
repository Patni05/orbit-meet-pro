import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { ERROR_CODES } from '@orbit/shared';
import { env, isProd } from './config/env';
import { AppError, fromZod } from './lib/errors';
import { logger } from './lib/logger';
import { isPrivateOrigin } from './lib/net';
import { redis } from './lib/redis';
import authPlugin from './plugins/auth';
import adminRoutes from './modules/admin/admin.routes';
import authRoutes from './modules/auth/auth.routes';
import healthRoutes from './modules/health/health.routes';
import meetingRoutes from './modules/meetings/meetings.routes';
import type { RealtimeGateway } from './realtime/gateway';

declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeGateway;
  }
}

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 512 * 1024,
    // Needed so the health check can report the real client IP behind Nginx.
    requestIdHeader: 'x-request-id',
  });

  // ------------------------------------------------------------------ security

  await app.register(helmet, {
    // The API serves JSON only; the strict default CSP is correct here.
    contentSecurityPolicy: isProd ? undefined : false,
    crossOriginEmbedderPolicy: false,
    hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  /**
   * Outside production, also trust private-network origins.
   *
   * Testing on a real phone means loading the app from the machine's LAN
   * address, which is never in the configured allowlist and changes with every
   * network. Rather than making developers keep editing CORS_ORIGINS, any
   * RFC1918 or loopback origin is accepted in development.
   *
   * This is gated strictly on the environment: in production only the
   * configured origins are ever allowed.
   */
  const isDevelopmentLanOrigin = (origin: string) => !isProd && isPrivateOrigin(origin);

  await app.register(cors, {
    origin(origin, callback) {
      // Same-origin and non-browser callers send no Origin header.
      if (!origin) return callback(null, true);
      if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
      if (isDevelopmentLanOrigin(origin)) return callback(null, true);
      logger.warn({ origin }, 'blocked cross-origin request');
      callback(new Error('Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    maxAge: 86_400,
  });

  await app.register(cookie, {
    // Refresh cookies are httpOnly and scoped to /auth; see plugins/auth.
    parseOptions: { httpOnly: true, sameSite: env.COOKIE_SAMESITE },
  });

  /**
   * Global rate limiting, backed by Redis so the budget is shared across API
   * instances. Individual routes tighten this further (login, join, code
   * lookup) — those are the endpoints worth attacking.
   */
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    redis,
    nameSpace: 'orbit:http:',
    /**
     * If Redis is unreachable, allow the request through rather than rejecting
     * it. A rate limiter exists to shed abusive load, so letting it become a
     * hard dependency would mean a Redis blip takes the entire API down — a
     * strictly worse outcome than briefly unmetered traffic.
     */
    skipOnError: true,
    keyGenerator: (request) => {
      // Authenticated callers get their own budget rather than sharing an IP
      // pool with everyone else behind the same NAT.
      const auth = request.auth?.userId;
      return auth ? `u:${auth}` : `ip:${request.ip}`;
    },
    // Returning an AppError keeps rate-limit rejections in the same response
    // shape as every other error, instead of a plugin-specific payload.
    errorResponseBuilder: () =>
      new AppError(
        429,
        ERROR_CODES.RATE_LIMITED,
        'Too many requests. Please slow down and try again shortly.',
      ) as unknown as { statusCode: number },
  });

  await app.register(authPlugin);

  /**
   * Accept `POST` with a JSON content type and no body.
   *
   * Actions like "end meeting" or "logout" carry no payload, but browsers and
   * fetch wrappers still label the request as JSON. Fastify's default parser
   * rejects that with an obscure error, so an empty body is normalised to `{}`.
   */
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (raw.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(new AppError(400, ERROR_CODES.VALIDATION, 'The request body is not valid JSON.'), undefined);
    }
  });


  // --------------------------------------------------------------- error shape

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, 'request failed');
      } else {
        request.log.debug({ code: error.code }, 'request rejected');
      }
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.exposeMessage ? error.message : 'Something went wrong on our side.',
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    if (error instanceof ZodError) {
      const appError = fromZod(error);
      return reply.code(400).send({
        error: { code: appError.code, message: appError.message, details: appError.details },
      });
    }

    // Fastify's own errors (bad JSON, payload too large, 404 …)
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      // Stack traces and driver messages never reach the client.
      return reply.code(500).send({
        error: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong on our side.' },
      });
    }

    return reply.code(status).send({
      error: { code: error.code ?? ERROR_CODES.VALIDATION, message: error.message },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: ERROR_CODES.NOT_FOUND, message: `No route for ${request.method} ${request.url}` },
    }),
  );

  // ------------------------------------------------------------------- routes

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meetingRoutes, { prefix: '/meetings' });
  await app.register(adminRoutes, { prefix: '/admin' });

  return app;
}
