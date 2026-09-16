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

// ---------------------------------------------------------------------------
// Built-in avatars
// ---------------------------------------------------------------------------

/**
 * A small catalogue of avatars people can pick instead of showing a photo.
 *
 * Each entry is a glyph plus a background, stored as the short id
 * `preset:<id>` and rendered client-side. Keeping them as data rather than
 * image files means no asset pipeline, no broken-image states, no extra
 * requests during a meeting, and identical appearance on every device.
 *
 * Anyone who picks nothing still gets a deterministic initials avatar, so a
 * participant always has a stable visual identity.
 */
export interface AvatarPreset {
  id: string;
  category: 'People' | 'Animals' | 'Robots' | 'Nature' | 'Abstract';
  /** Rendered as a text node inside the avatar circle. */
  glyph: string;
  /** Background, chosen to keep the glyph legible in light and dark rooms. */
  background: string;
  label: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  // People
  { id: 'p-explorer', category: 'People', glyph: '🧑‍🚀', background: '#4338ca', label: 'Astronaut' },
  { id: 'p-artist', category: 'People', glyph: '🧑‍🎨', background: '#be185d', label: 'Artist' },
  { id: 'p-coder', category: 'People', glyph: '🧑‍💻', background: '#0f766e', label: 'Developer' },
  { id: 'p-teacher', category: 'People', glyph: '🧑‍🏫', background: '#b45309', label: 'Teacher' },
  { id: 'p-scientist', category: 'People', glyph: '🧑‍🔬', background: '#1d4ed8', label: 'Scientist' },
  { id: 'p-chef', category: 'People', glyph: '🧑‍🍳', background: '#c2410c', label: 'Chef' },

  // Animals
  { id: 'a-fox', category: 'Animals', glyph: '🦊', background: '#c2410c', label: 'Fox' },
  { id: 'a-panda', category: 'Animals', glyph: '🐼', background: '#3f3f46', label: 'Panda' },
  { id: 'a-owl', category: 'Animals', glyph: '🦉', background: '#7c2d12', label: 'Owl' },
  { id: 'a-cat', category: 'Animals', glyph: '🐱', background: '#a16207', label: 'Cat' },
  { id: 'a-whale', category: 'Animals', glyph: '🐳', background: '#0369a1', label: 'Whale' },
  { id: 'a-frog', category: 'Animals', glyph: '🐸', background: '#15803d', label: 'Frog' },

  // Robots
  { id: 'r-bot', category: 'Robots', glyph: '🤖', background: '#475569', label: 'Robot' },
  { id: 'r-alien', category: 'Robots', glyph: '👾', background: '#6d28d9', label: 'Invader' },
  { id: 'r-rocket', category: 'Robots', glyph: '🚀', background: '#1e40af', label: 'Rocket' },
  { id: 'r-satellite', category: 'Robots', glyph: '🛰️', background: '#334155', label: 'Satellite' },

  // Nature
  { id: 'n-leaf', category: 'Nature', glyph: '🍃', background: '#166534', label: 'Leaf' },
  { id: 'n-cactus', category: 'Nature', glyph: '🌵', background: '#4d7c0f', label: 'Cactus' },
  { id: 'n-wave', category: 'Nature', glyph: '🌊', background: '#0e7490', label: 'Wave' },
  { id: 'n-mountain', category: 'Nature', glyph: '🏔️', background: '#475569', label: 'Mountain' },
  { id: 'n-sun', category: 'Nature', glyph: '☀️', background: '#b45309', label: 'Sun' },
  { id: 'n-moon', category: 'Nature', glyph: '🌙', background: '#3730a3', label: 'Moon' },

  // Abstract
  { id: 'x-spark', category: 'Abstract', glyph: '✦', background: '#7c3aed', label: 'Spark' },
  { id: 'x-orbit', category: 'Abstract', glyph: '◉', background: '#0d9488', label: 'Orbit' },
  { id: 'x-prism', category: 'Abstract', glyph: '◈', background: '#be123c', label: 'Prism' },
  { id: 'x-wave', category: 'Abstract', glyph: '≈', background: '#0284c7', label: 'Ripple' },
  { id: 'x-hex', category: 'Abstract', glyph: '⬢', background: '#65a30d', label: 'Hex' },
  { id: 'x-bolt', category: 'Abstract', glyph: '⚡', background: '#a16207', label: 'Bolt' },
];

/** Stored form of a chosen preset, e.g. `preset:a-fox`. */
export const AVATAR_PRESET_PREFIX = 'preset:';

export function isAvatarPreset(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(AVATAR_PRESET_PREFIX);
}

export function findAvatarPreset(value: string | null | undefined): AvatarPreset | null {
  if (!isAvatarPreset(value)) return null;
  const id = value!.slice(AVATAR_PRESET_PREFIX.length);
  return AVATAR_PRESETS.find((preset) => preset.id === id) ?? null;
}
