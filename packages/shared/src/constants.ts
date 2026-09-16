/**
 * Shared, non-secret constants used by both the web client and the API.
 */

/** Alphabet used for meeting codes. Excludes look-alike characters (0/O, 1/l/I). */
export const MEETING_CODE_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/** Meeting codes are 3 groups of 4 characters: `abcd-efgh-ijkl`. */
export const MEETING_CODE_GROUPS = 3;
export const MEETING_CODE_GROUP_SIZE = 4;

/**
 * 33^12 ≈ 2.4e18 possible codes. Combined with per-IP rate limiting on the
 * lookup endpoint this makes enumeration impractical.
 */
export const MEETING_CODE_ENTROPY_BITS = Math.round(
  MEETING_CODE_GROUPS * MEETING_CODE_GROUP_SIZE * Math.log2(MEETING_CODE_ALPHABET.length),
);

export const MEETING_CODE_REGEX = new RegExp(
  `^[${MEETING_CODE_ALPHABET}]{${MEETING_CODE_GROUP_SIZE}}(-[${MEETING_CODE_ALPHABET}]{${MEETING_CODE_GROUP_SIZE}}){${MEETING_CODE_GROUPS - 1}}$`,
);

export const CHAT_MESSAGE_MAX_LENGTH = 2000;
export const DISPLAY_NAME_MAX_LENGTH = 60;
export const MEETING_TITLE_MAX_LENGTH = 120;

/** Host may be gone this long before host privileges become transferable. */
export const HOST_DISCONNECT_GRACE_MS = 90_000;

/** Window in which a rejoin with the same session id is treated as a reconnect. */
export const RECONNECT_GRACE_MS = 60_000;

export const ACTIVE_SPEAKER_DEBOUNCE_MS = 700;

export const REACTIONS = ['thumbsup', 'heart', 'laugh', 'clap', 'party', 'wow'] as const;
export type ReactionKey = (typeof REACTIONS)[number];

export const REACTION_EMOJI: Record<ReactionKey, string> = {
  thumbsup: '\u{1F44D}',
  heart: '\u2764\uFE0F',
  laugh: '\u{1F602}',
  clap: '\u{1F44F}',
  party: '\u{1F389}',
  wow: '\u{1F62E}',
};

/** Deterministic avatar palette; index chosen from a hash of the user identity. */
export const AVATAR_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
] as const;
