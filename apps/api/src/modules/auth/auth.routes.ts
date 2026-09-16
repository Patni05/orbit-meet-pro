import type { FastifyPluginAsync } from 'fastify';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@orbit/shared';
import { env, isProd } from '../../config/env';
import { parseOrThrow, unauthorized } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from '../../plugins/auth';
import * as authService from './auth.service';

/**
 * Auth endpoints.
 *
 * The refresh token travels in an httpOnly, SameSite cookie scoped to `/auth`
 * so browser JavaScript can never read it. It is also returned in the body for
 * native clients, which have no cookie jar.
 */
const authRoutes: FastifyPluginAsync = async (fastify) => {
  /** Tight limits: these are the endpoints worth brute-forcing. */
  const strictLimit = {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  };

  fastify.post('/register', strictLimit, async (request, reply) => {
    const input = parseOrThrow(registerSchema, request.body);
    const result = await authService.register(input, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    setRefreshCookie(reply, result.refreshToken);
    return reply.code(201).send(result);
  });

  fastify.post('/login', strictLimit, async (request, reply) => {
    const input = parseOrThrow(loginSchema, request.body);
    const result = await authService.login(input, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    setRefreshCookie(reply, result.refreshToken);
    return reply.send(result);
  });

  fastify.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const body = (request.body ?? {}) as { refreshToken?: string };
    const presented = request.cookies[REFRESH_COOKIE] ?? body.refreshToken;
    if (!presented) throw unauthorized('No active session.');

    const result = await authService.refresh(presented, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    setRefreshCookie(reply, result.refreshToken);
    return reply.send(result);
  });

  fastify.post('/logout', async (request, reply) => {
    const body = (request.body ?? {}) as { refreshToken?: string };
    await authService.logout(request.cookies[REFRESH_COOKIE] ?? body.refreshToken);
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });

  fastify.post('/logout-all', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    await authService.logoutAll(request.auth!.userId);
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });

  fastify.get('/me', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const user = await authService.getUserById(request.auth!.userId);
    if (!user) throw unauthorized('Your account is no longer available.');
    return reply.send({ user: authService.toPublicUser(user) });
  });

  fastify.patch('/me', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const input = parseOrThrow(updateProfileSchema, request.body);
    const user = await authService.updateProfile(request.auth!.userId, input);
    return reply.send({ user });
  });

  fastify.post('/forgot-password', strictLimit, async (request, reply) => {
    const { email } = parseOrThrow(forgotPasswordSchema, request.body);
    const result = await authService.requestPasswordReset(email);

    if (result) {
      const resetUrl = `${env.APP_URL}/reset-password?token=${result.token}`;
      if (isProd) {
        // Wire a mail transport here; the token itself is never logged.
        logger.info({ userId: result.userId }, 'password reset requested — delivery pending mail transport');
      } else {
        logger.info({ resetUrl }, 'password reset link (development only)');
      }
    }

    // Identical response either way — this endpoint must not confirm which
    // addresses have accounts.
    return reply.send({
      ok: true,
      message: 'If an account exists for that address, a reset link is on its way.',
      ...(isProd ? {} : { devHint: 'Check the API logs for the reset link.' }),
    });
  });

  fastify.post('/reset-password', strictLimit, async (request, reply) => {
    const input = parseOrThrow(resetPasswordSchema, request.body);
    await authService.resetPassword(input.token, input.password);
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });
};

export default authRoutes;
