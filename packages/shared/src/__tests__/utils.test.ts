import { describe, expect, it } from 'vitest';
import {
  buildInvitationText,
  clamp,
  extractMeetingCode,
  formatDuration,
  formatMeetingCode,
  initialsFrom,
  isValidMeetingCode,
} from '../utils';

/**
 * These cover the pure logic that both the API and the browser depend on.
 * Meeting-code parsing in particular is the first thing a user touches — a
 * pasted link, a code with stray spaces — and getting it wrong looks like a
 * meeting that does not exist.
 */

describe('extractMeetingCode', () => {
  const code = 'abcd-efgh-ijkm';

  it('accepts a bare code', () => {
    expect(extractMeetingCode(code)).toBe(code);
  });

  it('normalises case, padding and spacing', () => {
    expect(extractMeetingCode('  ABCD EFGH IJKM  ')).toBe(code);
    expect(extractMeetingCode('abcd--efgh--ijkm')).toBe(code);
  });

  it('pulls the code out of a full meeting URL', () => {
    expect(extractMeetingCode(`https://orbit.example/room/${code}`)).toBe(code);
    expect(extractMeetingCode(`https://orbit.example/room/${code}?x=1`)).toBe(code);
    expect(extractMeetingCode(`HTTPS://ORBIT.EXAMPLE/ROOM/${code.toUpperCase()}`)).toBe(code);
  });

  it('handles a path without a scheme', () => {
    expect(extractMeetingCode(`/room/${code}`)).toBe(code);
  });

  it('rejects anything that is not a usable code', () => {
    for (const input of ['', '   ', 'not-a-code', 'abcd-efgh', 'abcd-efgh-ijkm-mnop', 'https://']) {
      expect(extractMeetingCode(input)).toBeNull();
    }
  });

  it('rejects a malformed URL rather than throwing', () => {
    expect(() => extractMeetingCode('http://[bad')).not.toThrow();
    expect(extractMeetingCode('http://[bad')).toBeNull();
  });
});

describe('isValidMeetingCode', () => {
  it('is case and whitespace insensitive', () => {
    expect(isValidMeetingCode(' ABCD-EFGH-IJKM ')).toBe(true);
  });

  it('rejects wrong shapes', () => {
    expect(isValidMeetingCode('abc-efgh-ijkl')).toBe(false);
    expect(isValidMeetingCode('abcd efgh ijkl')).toBe(false);
  });
});

describe('meeting code alphabet', () => {
  it('rejects the look-alike character from each ambiguous pair', () => {
    // For every pair that reads the same aloud or on screen the alphabet keeps
    // exactly one member, so a code cannot be transcribed into a different
    // valid meeting. Dropped: the digits 0 and 1, and the letter l.
    for (const ambiguous of ['abcd-efgh-ijkl', 'abc0-efgh-ijkm', 'abc1-efgh-ijkm']) {
      expect(isValidMeetingCode(ambiguous)).toBe(false);
    }
  });

  it('keeps the surviving member of each pair, case-insensitively', () => {
    // 'o' survives where '0' was dropped, so an uppercase O simply normalises.
    expect(isValidMeetingCode('abco-efgh-ijkm')).toBe(true);
    expect(isValidMeetingCode('abcO-efgh-ijkm')).toBe(true);
  });

  it('accepts the digits that are kept', () => {
    expect(isValidMeetingCode('2345-6789-abcd')).toBe(true);
  });
});

describe('formatMeetingCode', () => {
  it('renders a code for reading aloud', () => {
    expect(formatMeetingCode('abcd-efgh-ijkm')).toBe('abcd efgh ijkm');
  });
});

describe('formatDuration', () => {
  it('omits the hour component under an hour', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(59)).toBe('00:59');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('includes hours once past one', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('never renders a negative or fractional duration', () => {
    // Clock skew can produce a negative elapsed time; showing "-1:-3" would be
    // worse than showing zero.
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(65.9)).toBe('01:05');
  });
});

describe('initialsFrom', () => {
  it('uses the first and last word', () => {
    expect(initialsFrom('Ada Lovelace')).toBe('AL');
    expect(initialsFrom('Grace Brewster Hopper')).toBe('GH');
  });

  it('copes with one word and with empty input', () => {
    expect(initialsFrom('Prince')).toBe('PR');
    expect(initialsFrom('   ')).toBe('?');
  });
});

describe('clamp', () => {
  it('bounds a value on both sides', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('buildInvitationText', () => {
  const base = {
    title: 'Design review',
    joinUrl: 'https://orbit.example/room/abcd-efgh-ijkm',
    code: 'abcd-efgh-ijkm',
  };

  it('includes the essentials someone needs to join', () => {
    const text = buildInvitationText(base);
    expect(text).toContain('Design review');
    expect(text).toContain(base.joinUrl);
    expect(text).toContain(formatMeetingCode(base.code));
  });

  it('includes the passcode only when there is one', () => {
    expect(buildInvitationText(base)).not.toMatch(/passcode/i);
    expect(buildInvitationText({ ...base, password: 'hunter2' })).toContain('hunter2');
  });

  it('does not leak a null passcode into the text', () => {
    const text = buildInvitationText({ ...base, password: null });
    expect(text).not.toContain('null');
  });
});
