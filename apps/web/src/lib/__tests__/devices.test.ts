import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDevicePreferences, saveDevicePreferences } from '../devices';

/**
 * Device preferences are a convenience, so the contract that matters is that
 * they never break the app: a private window, disabled storage or a corrupted
 * value must all degrade to "no preference" rather than throwing on the path
 * into a meeting.
 */
describe('device preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a preference', () => {
    saveDevicePreferences({ audioInput: 'mic-1', micEnabled: false });
    expect(loadDevicePreferences()).toMatchObject({ audioInput: 'mic-1', micEnabled: false });
  });

  it('merges rather than replacing, so one setting does not clear another', () => {
    saveDevicePreferences({ audioInput: 'mic-1' });
    saveDevicePreferences({ videoInput: 'cam-1' });

    const prefs = loadDevicePreferences();
    expect(prefs.audioInput).toBe('mic-1');
    expect(prefs.videoInput).toBe('cam-1');
  });

  it('returns empty preferences when nothing is stored', () => {
    expect(loadDevicePreferences()).toEqual({});
  });

  it('recovers from a corrupted value instead of throwing', () => {
    localStorage.setItem('orbit.devices', '{not json');
    expect(() => loadDevicePreferences()).not.toThrow();
    expect(loadDevicePreferences()).toEqual({});
  });

  it('survives storage being unavailable', () => {
    // Safari in private mode throws on setItem rather than failing quietly.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => saveDevicePreferences({ audioInput: 'mic-1' })).not.toThrow();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => loadDevicePreferences()).not.toThrow();
    expect(loadDevicePreferences()).toEqual({});
  });
});
