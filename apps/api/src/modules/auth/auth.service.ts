import type { PublicUser, SystemRole } from '@orbit/shared';
import type { Prisma, User } from '@prisma/client';
import { env } from '../../config/env';
import {
  fakeVerifyDelay,
  generateOpaqueToken,
  hashIp,
  hashPassword,
  newId,
  sha256,
  verifyPassword,
} from '../../lib/crypto';
import { AppError, conflict, unauthorized } from '../../lib/errors';
import { signAccessToken } from '../../lib/jwt';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: user.role as SystemRole,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.lastActiveAt ? user.lastActiveAt.toISOString() : null,
  };
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Issues an access token plus a fresh refresh token in an existing or new family. */
async function issueTokens(user: User, ctx: SessionContext, familyId = newId()) {
  const refreshToken = generateOpaqueToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt: refreshExpiry(),
      userAgent: ctx.userAgent?.slice(0, 256),
      ipHash: hashIp(ctx.ip),
    },
  });

  const accessToken = await signAccessToken({ id: user.id, name: user.name, role: user.role as SystemRole });

  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
}

export async function register(
  input: { name: string; email: string; password: string },
  ctx: SessionContext,
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw conflict('EMAIL_TAKEN', 'An account with that email already exists.');
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      lastActiveAt: new Date(),
    },
  });

  logger.info({ userId: user.id }, 'user registered');
  const tokens = await issueTokens(user, ctx);
  return { user: toPublicUser(user), ...tokens };
}

export async function login(input: { email: string; password: string }, ctx: SessionContext) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    // Same work and same message as a wrong password, so neither timing nor
    // wording reveals whether the address is registered.
    await fakeVerifyDelay();
    throw unauthorized('Incorrect email or password.');
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    logger.warn({ userId: user.id }, 'failed login attempt');
    throw unauthorized('Incorrect email or password.');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
  logger.info({ userId: user.id }, 'user signed in');

  const tokens = await issueTokens(user, ctx);
  return { user: toPublicUser(user), ...tokens };
}

/**
 * Rotating refresh.
 *
 * Every refresh retires the presented token and issues a new one in the same
 * family. Presenting an already-retired token means it leaked, so the entire
 * family is revoked and the client must sign in again.
 */
export async function refresh(presentedToken: string, ctx: SessionContext) {
  const tokenHash = sha256(presentedToken);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record) throw unauthorized('Your session has expired. Please sign in again.');

  if (record.revokedAt) {
    logger.warn({ userId: record.userId, familyId: record.familyId }, 'refresh token reuse detected');
    await prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  const tokens = await issueTokens(record.user, ctx, record.familyId);

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date(), replacedById: sha256(tokens.refreshToken).slice(0, 32) },
  });

  await prisma.user.update({ where: { id: record.userId }, data: { lastActiveAt: new Date() } });

  return { user: toPublicUser(record.user), ...tokens };
}

export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presentedToken) } });
  if (!record) return;
  // Revoke the whole family: signing out should end the device's session chain.
  await prisma.refreshToken.updateMany({
    where: { familyId: record.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Creates a password-reset token.
 *
 * Always resolves, whether or not the address exists — the caller responds
 * identically either way so the endpoint cannot be used to test for accounts.
 * The token is returned to the caller for delivery by whichever mail transport
 * is wired up; in development it is logged instead of emailed.
 */
export async function requestPasswordReset(email: string): Promise<{ token: string; userId: string } | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;

  const token = generateOpaqueToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return { token, userId: user.id };
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // A password change invalidates every existing session.
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  logger.info({ userId: record.userId }, 'password reset completed');
}

export async function getUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function updateProfile(
  userId: string,
  data: { name?: string; avatarUrl?: string | null },
): Promise<PublicUser> {
  const patch: Prisma.UserUpdateInput = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.avatarUrl !== undefined) patch.avatarUrl = data.avatarUrl;

  const user = await prisma.user.update({ where: { id: userId }, data: patch });
  return toPublicUser(user);
}

/** Housekeeping: drop expired and long-revoked tokens. */
export async function pruneTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [refreshDeleted, resetDeleted] = await Promise.all([
    prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
    }),
    prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ]);
  return (refreshDeleted?.count ?? 0) + (resetDeleted?.count ?? 0);
}
