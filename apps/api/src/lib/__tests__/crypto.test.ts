import { describe, expect, it } from 'vitest';
import { isValidMeetingCode, MEETING_CODE_ALPHABET } from '@orbit/shared';
import {
  generateIdentity,
  generateMeetingCode,
  generateOpaqueToken,
  hashIp,
  hashPassword,
  safeEqual,
  sha256,
  verifyPassword,
} from '../crypto';

/**
 * These cover the primitives that protect accounts and meetings. They are
 * deliberately behavioural — that a wrong password fails, that codes do not
 * repeat — rather than asserting a particular hash string, which would only
 * pin the current parameters in place.
 */

describe('generateMeetingCode', () => {
  it('produces codes the shared validator accepts', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isValidMeetingCode(generateMeetingCode())).toBe(true);
    }
  });

  it('only uses the unambiguous alphabet', () => {
    const allowed = new Set([...MEETING_CODE_ALPHABET, '-']);
    for (let i = 0; i < 100; i += 1) {
      for (const character of generateMeetingCode()) {
        expect(allowed.has(character)).toBe(true);
      }
    }
  });

  it('does not repeat across a large sample', () => {
    // Codes are drawn from a cryptographic source, not a counter or a clock,
    // so collisions in a few thousand draws would indicate a broken generator.
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(generateMeetingCode());
    expect(seen.size).toBe(5000);
  });

  it('spreads values across the alphabet rather than favouring a prefix', () => {
    // A generator that sliced a timestamp would cluster heavily on the first
    // character; a random one should reach most of the alphabet quickly.
    const firstCharacters = new Set<string>();
    for (let i = 0; i < 2000; i += 1) firstCharacters.add(generateMeetingCode()[0]!);
    expect(firstCharacters.size).toBeGreaterThan(MEETING_CODE_ALPHABET.length / 2);
  });
});

describe('password hashing', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('Str0ngPassw0rd!');
    expect(await verifyPassword(hash, 'Str0ngPassw0rd!')).toBe(true);
    expect(await verifyPassword(hash, 'Str0ngPassw0rd')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('never stores the password in the hash', async () => {
    const secret = 'CorrectHorseBattery1!';
    const hash = await hashPassword(secret);
    expect(hash).not.toContain(secret);
  });

  it('salts, so the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-1A'), hashPassword('same-password-1A')]);
    expect(a).not.toBe(b);
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares by value', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('handles differing lengths without throwing', () => {
    expect(safeEqual('short', 'considerably-longer')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('tokens and identities', () => {
  it('generates distinct opaque tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) seen.add(generateOpaqueToken());
    expect(seen.size).toBe(1000);
  });

  it('tags identities by kind so guests are distinguishable', () => {
    expect(generateIdentity('u').startsWith('u_')).toBe(true);
    expect(generateIdentity('g').startsWith('g_')).toBe(true);
    expect(generateIdentity('g')).not.toBe(generateIdentity('g'));
  });
});

describe('hashIp', () => {
  it('is stable for one address and different across addresses', () => {
    expect(hashIp('203.0.113.9')).toBe(hashIp('203.0.113.9'));
    expect(hashIp('203.0.113.9')).not.toBe(hashIp('203.0.113.10'));
  });

  it('never returns the address itself', () => {
    expect(hashIp('203.0.113.9')).not.toContain('203.0.113.9');
  });

  it('passes through a missing address', () => {
    expect(hashIp(undefined)).toBeNull();
  });
});

describe('sha256', () => {
  it('is deterministic and fixed width', () => {
    expect(sha256('orbit')).toBe(sha256('orbit'));
    expect(sha256('orbit')).toHaveLength(64);
    expect(sha256('orbit')).not.toBe(sha256('orbi'));
  });
});
