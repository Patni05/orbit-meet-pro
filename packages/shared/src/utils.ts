import { AVATAR_COLORS, MEETING_CODE_REGEX } from './constants';

/** "John Smith" -> "JS", "cher" -> "CH". Safe for any unicode name. */
export function initialsFrom(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    return [...parts[0]!].slice(0, 2).join('').toUpperCase();
  }
  const first = [...parts[0]!][0] ?? '';
  const last = [...parts[parts.length - 1]!][0] ?? '';
  return (first + last).toUpperCase();
}

/** Stable colour per identity so a participant keeps the same avatar everywhere. */
export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index]!;
}

export function isValidMeetingCode(code: string): boolean {
  return MEETING_CODE_REGEX.test(code.trim().toLowerCase());
}

/**
 * Accepts a bare code (`abcd-efgh-ijkl`), a spaced code, or a full meeting URL
 * and returns the normalised code, or null when nothing usable was entered.
 */
export function extractMeetingCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let candidate = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const segments = url.pathname.split('/').filter(Boolean);
      candidate = segments[segments.length - 1] ?? '';
    } catch {
      return null;
    }
  } else if (raw.includes('/')) {
    const segments = raw.split('/').filter(Boolean);
    candidate = segments[segments.length - 1] ?? '';
  }

  const normalised = candidate.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  return isValidMeetingCode(normalised) ? normalised : null;
}

/** Display form of a code used in invitations: `abcd efgh ijkl`. */
export function formatMeetingCode(code: string): string {
  return code.replace(/-/g, ' ');
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface InvitationInput {
  title: string;
  joinUrl: string;
  code: string;
  password?: string | null;
  scheduledAt?: string | null;
  timezone?: string | null;
  hostName?: string;
}

/** Plain-text invitation suitable for pasting into email or chat. */
export function buildInvitationText(input: InvitationInput): string {
  const lines: string[] = [];
  lines.push(
    input.hostName
      ? `${input.hostName} has invited you to a video meeting on Orbit.`
      : 'You have been invited to a video meeting on Orbit.',
  );
  lines.push('');
  lines.push('Meeting:');
  lines.push(input.title);

  if (input.scheduledAt) {
    const when = new Date(input.scheduledAt);
    if (!Number.isNaN(when.getTime())) {
      lines.push('');
      lines.push('When:');
      lines.push(when.toUTCString() + (input.timezone ? ` (${input.timezone})` : ''));
    }
  }

  lines.push('');
  lines.push('Join:');
  lines.push(input.joinUrl);
  lines.push('');
  lines.push('Meeting ID:');
  lines.push(formatMeetingCode(input.code));

  if (input.password) {
    lines.push('');
    lines.push('Passcode:');
    lines.push(input.password);
  }

  return lines.join('\n');
}

/** Clamp helper shared by layout maths on the client. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
