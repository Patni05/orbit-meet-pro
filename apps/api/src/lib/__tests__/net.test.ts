import { describe, expect, it } from 'vitest';
import { isPrivateHost, isPrivateOrigin } from '../net';

/**
 * This pattern has been silently broken before by a lost backslash, which
 * turned `\d` into a literal "d" so nothing matched and every LAN request was
 * rejected as a cross-origin violation. The failure was invisible at the call
 * site, so it is pinned here instead.
 */

describe('isPrivateHost', () => {
  it('accepts loopback', () => {
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  it('accepts the RFC1918 ranges', () => {
    for (const host of ['10.0.0.1', '10.255.255.254', '192.168.1.35', '172.16.0.1', '172.31.255.1']) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  it('rejects public addresses', () => {
    for (const host of ['8.8.8.8', '1.1.1.1', '203.0.113.9', 'example.com', 'orbit.example.org']) {
      expect(isPrivateHost(host)).toBe(false);
    }
  });

  it('rejects addresses just outside the 172.16/12 block', () => {
    // 172.15 and 172.32 are public; only 172.16–172.31 are private, and an
    // over-broad pattern here would quietly widen what development trusts.
    expect(isPrivateHost('172.15.0.1')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
    expect(isPrivateHost('172.20.0.1')).toBe(true);
  });

  it('rejects hosts that merely contain a private address', () => {
    expect(isPrivateHost('192.168.1.35.example.com')).toBe(false);
    expect(isPrivateHost('evil-127.0.0.1')).toBe(false);
    expect(isPrivateHost('notlocalhost')).toBe(false);
  });

  it('does not match a literal "d" where a digit belongs', () => {
    // Exactly the corruption this module exists to prevent.
    expect(isPrivateHost('192.168.d.d')).toBe(false);
    expect(isPrivateHost('127.d.d.d')).toBe(false);
  });
});

describe('isPrivateOrigin', () => {
  it('accepts private origins on any scheme or port', () => {
    expect(isPrivateOrigin('http://localhost:3000')).toBe(true);
    expect(isPrivateOrigin('https://192.168.1.35:8443')).toBe(true);
    expect(isPrivateOrigin('http://10.0.0.5')).toBe(true);
  });

  it('rejects public origins', () => {
    expect(isPrivateOrigin('https://orbit.example.com')).toBe(false);
    expect(isPrivateOrigin('https://8.8.8.8')).toBe(false);
  });

  it('rejects malformed input rather than throwing', () => {
    for (const value of ['', 'not a url', 'http://', '://nope']) {
      expect(() => isPrivateOrigin(value)).not.toThrow();
      expect(isPrivateOrigin(value)).toBe(false);
    }
  });
});
