import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  MEETING_CODE_ALPHABET,
  MEETING_CODE_GROUPS,
  MEETING_CODE_GROUP_SIZE,
} from '@orbit/shared';

/**
 * Password and token primitives.
 *
 * Passwords and meeting passcodes are hashed with Argon2id. Opaque bearer
 * tokens (refresh, password reset, realtime session) are random 256-bit values
 * stored only as SHA-256 digests, so a database leak does not yield usable
 * credentials.
 */

const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB — OWASP minimum for Argon2id
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON_OPTIONS);
}

/** Never throws on a malformed stored hash — returns false so login just fails. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same CPU as a real verification. Called when an email does
 * not exist so response timing does not reveal which accounts are registered.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await argonHash('timing-equalisation-placeholder', ARGON_OPTIONS).catch(() => undefined);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** URL-safe opaque token, 256 bits of entropy. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Meeting code: 3 groups of 4 characters from a 33-symbol alphabet
 * (~60 bits). Generated with the CSPRNG and never derived from a counter,
 * timestamp or row id, so codes cannot be guessed or enumerated.
 */
export function generateMeetingCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < MEETING_CODE_GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < MEETING_CODE_GROUP_SIZE; i += 1) {
      group += MEETING_CODE_ALPHABET[randomInt(0, MEETING_CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/** LiveKit identity. Prefixed so guests and members are distinguishable in logs. */
export function generateIdentity(kind: 'u' | 'g'): string {
  return `${kind}_${randomBytes(9).toString('base64url')}`;
}

export function newId(): string {
  return randomUUID();
}

/** Hash of a client IP, used for coarse abuse tracking without storing addresses. */
export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return sha256(ip).slice(0, 32);
}
