import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { SystemRole } from '@orbit/shared';
import { env, isProd } from '../config/env';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';

export interface AuthContext {
  userId: string;
  name: string;
  role: SystemRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set when a valid access token was presented. */
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    /** Rejects the request unless a valid access token is present. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Populates `request.auth` when a token is present, but never rejects. */
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Rejects unless the caller is a platform admin. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const REFRESH_COOKIE = 'orbit_rt';

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || isProd,
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN,
    path: '/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    signed: false,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, {
    path: '/auth',
    domain: env.COOKIE_DOMAIN,
    sameSite: env.COOKIE_SAMESITE,
    secure: env.COOKIE_SECURE || isProd,
  });
}

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('auth', null);

  fastify.decorate('optionalAuth', async (request: FastifyRequest) => {
    const token = extractBearer(request);
    if (!token) return;
    try {
      const claims = await verifyAccessToken(token);
      request.auth = { userId: claims.sub, name: claims.name, role: claims.role };
    } catch {
      // An expired token on an optional route is simply treated as anonymous.
      request.auth = null;
    }
  });

  fastify.decorate('requireAuth', async (request: FastifyRequest) => {
    const token = extractBearer(request);
    if (!token) throw unauthorized();
    const claims = await verifyAccessToken(token);
    request.auth = { userId: claims.sub, name: claims.name, role: claims.role };
  });

  fastify.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.requireAuth(request, reply);
    if (request.auth?.role !== 'ADMIN') throw forbidden('Administrator access is required.');
  });
};

export default fp(authPlugin, { name: 'orbit-auth' });
