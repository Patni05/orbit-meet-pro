import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env';
import { unauthorized } from './errors';
import type { SystemRole } from '@orbit/shared';

/**
 * Token strategy
 * --------------
 * - Access token: short-lived signed JWT, sent in `Authorization: Bearer`.
 * - Refresh token: opaque random string (see auth.service) stored hashed in
 *   PostgreSQL and rotated on every use — not a JWT, so it can be revoked.
 * - Session token: signed JWT binding one browser tab to one participant row.
 *   It is stateless on purpose so a Redis restart does not drop live meetings;
 *   revocation happens by checking participant status in the database on every
 *   socket connection.
 */

const ISSUER = 'orbit.api';
const AUDIENCE_ACCESS = 'orbit.access';
const AUDIENCE_SESSION = 'orbit.session';

const accessKey = new TextEncoder().encode(env.JWT_SECRET);
const sessionKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  name: string;
  role: SystemRole;
}

export interface SessionTokenClaims extends JWTPayload {
  sub: string; // participantId
  meetingId: string;
  identity: string;
}

export async function signAccessToken(user: { id: string; name: string; role: SystemRole }): Promise<string> {
  return new SignJWT({ name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE_ACCESS)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: ISSUER,
      audience: AUDIENCE_ACCESS,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') throw new Error('missing subject');
    return payload as AccessTokenClaims;
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

export async function signSessionToken(claims: {
  participantId: string;
  meetingId: string;
  identity: string;
}): Promise<string> {
  return new SignJWT({ meetingId: claims.meetingId, identity: claims.identity })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.participantId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE_SESSION)
    .setIssuedAt()
    .setExpirationTime(`${env.LIVEKIT_TOKEN_TTL_SECONDS}s`)
    .sign(sessionKey);
}

export async function verifySessionToken(token: string): Promise<SessionTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, sessionKey, {
      issuer: ISSUER,
      audience: AUDIENCE_SESSION,
      algorithms: ['HS256'],
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.meetingId !== 'string' ||
      typeof payload.identity !== 'string'
    ) {
      throw new Error('malformed session token');
    }
    return payload as SessionTokenClaims;
  } catch {
    throw unauthorized('This meeting session is no longer valid. Rejoin the meeting.');
  }
}
