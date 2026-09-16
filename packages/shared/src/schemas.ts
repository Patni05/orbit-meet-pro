import { z } from 'zod';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  MEETING_CODE_REGEX,
  MEETING_TITLE_MAX_LENGTH,
  REACTIONS,
} from './constants';

/** Shared validation. The API validates with these; web forms reuse them so messages match. */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter')
  .refine((v) => /[0-9]/.test(v), 'Include at least one number');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(DISPLAY_NAME_MAX_LENGTH, `Name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`);

export const registerSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: displayNameSchema.optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
});

export const meetingSettingsSchema = z.object({
  waitingRoomEnabled: z.boolean(),
  requireAuth: z.boolean(),
  allowGuests: z.boolean(),
  chatEnabled: z.boolean(),
  screenShareMode: z.enum(['EVERYONE', 'HOSTS_ONLY']),
  allowParticipantUnmute: z.boolean(),
  muteOnEntry: z.boolean(),
  recordingEnabled: z.boolean(),
});

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1).max(MEETING_TITLE_MAX_LENGTH).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  password: z.string().min(4).max(64).nullable().optional(),
  settings: meetingSettingsSchema.partial().optional(),
});

export const updateMeetingSchema = createMeetingSchema.extend({
  status: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
});

export const meetingCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(MEETING_CODE_REGEX, 'That does not look like a valid meeting code');

export const joinMeetingSchema = z.object({
  displayName: displayNameSchema.optional(),
  password: z.string().max(64).optional(),
  /**
   * Stable per-browser-tab id. Lets a refresh or a network blip resume the same
   * participant row instead of creating a duplicate.
   */
  sessionId: z.string().min(8).max(64).optional(),
  /**
   * A built-in avatar id, such as "preset:a-fox". Constrained to that shape on
   * purpose: accepting an arbitrary URL here would let anyone point every
   * participant list at a server of their choosing, which is both a tracking
   * beacon and a way to smuggle in unexpected content.
   */
  avatarUrl: z
    .string()
    .regex(/^preset:[a-z0-9-]{1,32}$/, 'Choose one of the built-in avatars.')
    .nullable()
    .optional(),
});

export const chatMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message is empty').max(CHAT_MESSAGE_MAX_LENGTH),
  clientId: z.string().min(1).max(64),
});

export const reactionSchema = z.object({ reaction: z.enum(REACTIONS) });

export const historyQuerySchema = z.object({
  filter: z.enum(['upcoming', 'completed', 'cancelled', 'all']).default('all'),
  take: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;
export type JoinMeetingInput = z.infer<typeof joinMeetingSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

// ---------------------------------------------------------------------------
// Moderation, announcements and polls
// ---------------------------------------------------------------------------

/**
 * Every privileged payload is validated here before the server acts on it.
 * Bounds are deliberately tight: an announcement is a banner rather than an
 * essay, and a poll with two hundred options is an attempt to exhaust
 * something rather than to ask a question.
 */
export const announcementSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something to announce.')
    .max(280, 'Keep announcements under 280 characters.'),
});

export const blockSchema = z.object({
  identity: z.string().trim().min(1).max(128),
  reason: z.string().trim().max(200).optional(),
});

export const spotlightSchema = z.object({
  identity: z.string().trim().min(1).max(128),
  on: z.boolean(),
});

export const pollCreateSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question.').max(300),
  options: z
    .array(z.string().trim().min(1, 'Options cannot be blank.').max(120))
    .min(2, 'Give people at least two options.')
    .max(10, 'Ten options is the maximum.'),
  multiSelect: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  hideResultsUntilClosed: z.boolean().optional(),
});

export const pollVoteSchema = z.object({
  pollId: z.string().uuid(),
  /**
   * An empty array is a valid "clear my vote". The upper bound matches the
   * maximum number of options a poll can have, so a caller cannot send a
   * thousand ids and make the server do a thousand lookups.
   */
  optionIds: z.array(z.string().uuid()).max(10),
});

// ---------------------------------------------------------------------------
// Live quiz
// ---------------------------------------------------------------------------

export const quizQuestionInputSchema = z.object({
  kind: z.enum(['SINGLE', 'MULTI', 'TRUE_FALSE']),
  prompt: z.string().trim().min(1, 'Every question needs text.').max(500),
  points: z.number().int().min(1).max(100).optional(),
  seconds: z.number().int().min(5).max(600).optional(),
  explanation: z.string().trim().max(500).nullable().optional(),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Options cannot be blank.').max(200),
        isCorrect: z.boolean(),
      }),
    )
    .min(2, 'Each question needs at least two options.')
    .max(8, 'Eight options is the maximum.'),
});

export const quizCreateSchema = z.object({
  title: z.string().trim().min(1, 'Give the quiz a name.').max(150),
  settings: z
    .object({
      timerMode: z.enum(['PER_QUESTION', 'TOTAL']).optional(),
      flow: z.enum(['ONE_AT_A_TIME', 'ALL_AT_ONCE']).optional(),
      totalSeconds: z.number().int().min(10).max(7200).optional(),
      shuffleQuestions: z.boolean().optional(),
      shuffleOptions: z.boolean().optional(),
      negativeMarking: z.boolean().optional(),
      negativePoints: z.number().int().min(0).max(50).optional(),
      allowLateJoin: z.boolean().optional(),
      allowAnswerChange: z.boolean().optional(),
      resultVisibility: z
        .enum(['LEADERBOARD_AND_ANSWERS', 'LEADERBOARD_ONLY', 'OWN_ONLY', 'HOST_ONLY'])
        .optional(),
      revealMode: z.enum(['AFTER_EACH_QUESTION', 'AT_END', 'NEVER']).optional(),
    })
    .default({}),
  // A hard ceiling on question count keeps one request from creating hundreds
  // of rows, and matches what a live quiz can realistically get through.
  questions: z.array(quizQuestionInputSchema).min(1, 'Add at least one question.').max(50),
});

export const quizAnswerSchema = z.object({
  quizId: z.string().uuid(),
  questionId: z.string().uuid(),
  optionIds: z.array(z.string().uuid()).max(8),
});

export const quizIdSchema = z.object({ quizId: z.string().uuid() });

export const quizExtendSchema = z.object({
  quizId: z.string().uuid(),
  seconds: z.number().int().min(5).max(1800),
});
