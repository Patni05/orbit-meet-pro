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
