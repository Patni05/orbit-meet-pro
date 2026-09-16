import type { ReactionKey } from './constants';

export type ParticipantRole = 'HOST' | 'COHOST' | 'PARTICIPANT';
export type ParticipantStatus = 'WAITING' | 'ADMITTED' | 'REJECTED' | 'LEFT' | 'REMOVED';
export type MeetingStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
export type RecordingStatus = 'STARTING' | 'ACTIVE' | 'STOPPING' | 'COMPLETED' | 'FAILED';
export type SystemRole = 'USER' | 'ADMIN';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: SystemRole;
  createdAt: string;
  lastActiveAt: string | null;
}

/** Host-configurable meeting policy. Enforced server-side, never trusted from the client. */
export interface MeetingSettings {
  waitingRoomEnabled: boolean;
  requireAuth: boolean;
  allowGuests: boolean;
  chatEnabled: boolean;
  screenShareMode: 'EVERYONE' | 'HOSTS_ONLY';
  allowParticipantUnmute: boolean;
  muteOnEntry: boolean;
  recordingEnabled: boolean;
}

export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  waitingRoomEnabled: false,
  requireAuth: false,
  allowGuests: true,
  chatEnabled: true,
  screenShareMode: 'EVERYONE',
  allowParticipantUnmute: true,
  muteOnEntry: false,
  recordingEnabled: false,
};

export interface MeetingSummary {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: MeetingStatus;
  locked: boolean;
  hasPassword: boolean;
  scheduledAt: string | null;
  durationMinutes: number | null;
  timezone: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  host: { id: string; name: string; avatarUrl: string | null };
  settings: MeetingSettings;
  joinUrl: string;
  /** Present on history rows. */
  participantCount?: number;
  myRole?: ParticipantRole;
}

/** What the server tells a client *before* it joins — no secrets, no participant list. */
export interface MeetingPreview {
  id: string;
  code: string;
  title: string;
  status: MeetingStatus;
  locked: boolean;
  hasPassword: boolean;
  requireAuth: boolean;
  allowGuests: boolean;
  waitingRoomEnabled: boolean;
  hostName: string;
  scheduledAt: string | null;
  startedAt: string | null;
}

export interface RoomParticipant {
  /** Stable LiveKit identity, also used as the realtime participant key. */
  identity: string;
  participantId: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  role: ParticipantRole;
  status: ParticipantStatus;
  isGuest: boolean;
  joinedAt: string;
  handRaisedAt: string | null;
  /** Server-side view of media state, mirrored from realtime events. */
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  connected: boolean;
}

export interface WaitingParticipant {
  participantId: string;
  identity: string;
  name: string;
  avatarUrl: string | null;
  userId: string | null;
  requestedAt: string;
}

export interface ChatMessagePayload {
  id: string;
  meetingId: string;
  senderIdentity: string;
  senderName: string;
  senderUserId: string | null;
  /** Plain text. Never HTML — the client renders it as text. */
  body: string;
  sentAt: string;
}

export interface RoomState {
  meeting: MeetingSummary;
  self: RoomParticipant;
  participants: RoomParticipant[];
  waiting: WaitingParticipant[];
  messages: ChatMessagePayload[];
  recording: { active: boolean; recordingId: string | null; startedAt: string | null };
  /** Identities the host has spotlighted; everyone sees these promoted. */
  spotlight: string[];
  /** Newest undismissed announcement, if any. */
  announcement: AnnouncementPayload | null;
  /** Polls this viewer is allowed to see: open ones, plus closed ones. */
  polls: PollPayload[];
  /** Server clock, so clients can compute meeting duration without trusting local time. */
  serverTime: string;
}

export interface JoinTicket {
  /** Short-lived LiveKit access token, minted by the API only. */
  token: string;
  livekitUrl: string;
  identity: string;
  participantId: string;
  role: ParticipantRole;
  /** Opaque session token for the realtime (Socket.IO) channel. */
  sessionToken: string;
  meeting: MeetingSummary;
}

export type JoinOutcome =
  | { outcome: 'ADMITTED'; ticket: JoinTicket }
  | { outcome: 'WAITING'; participantId: string; sessionToken: string; meeting: MeetingPreview }
  | { outcome: 'REJECTED'; reason: string }
  | { outcome: 'LOCKED' }
  | { outcome: 'ENDED' };

export interface ReactionEvent {
  identity: string;
  name: string;
  reaction: ReactionKey;
  at: string;
}

export interface AuthTokens {
  accessToken: string;
  /** Refresh token is also set as an httpOnly cookie; returned for non-browser clients. */
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  checks: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    livekit: 'ok' | 'error' | 'unknown';
  };
  metrics: {
    activeMeetings: number;
    connectedParticipants: number;
  };
}

// ---------------------------------------------------------------------------
// Moderation, announcements and polls
// ---------------------------------------------------------------------------

export type BlockScope = 'USER' | 'GUEST_IDENTITY';

/**
 * A blocked participant, as shown in the host's management panel.
 *
 * Deliberately carries no network information. A host needs to recognise who
 * they blocked, not to be handed an address they never asked for.
 */
export interface BlocklistEntry {
  id: string;
  scope: BlockScope;
  displayName: string;
  reason: string | null;
  createdAt: string;
  /** Present only for signed-in accounts, and never shown to participants. */
  userId: string | null;
  identity: string | null;
}

export interface AnnouncementPayload {
  id: string;
  body: string;
  byName: string;
  createdAt: string;
}

export type PollStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

export interface PollOptionPayload {
  id: string;
  label: string;
  position: number;
  /**
   * Tally for this option. Withheld — left as null — while the poll is open
   * and the host chose to hide interim results, so nobody can be nudged by a
   * running total.
   */
  votes: number | null;
}

export interface PollPayload {
  id: string;
  question: string;
  status: PollStatus;
  multiSelect: boolean;
  anonymous: boolean;
  hideResultsUntilClosed: boolean;
  options: PollOptionPayload[];
  /** Total participants who have answered, always safe to show. */
  responseCount: number;
  /** This viewer's own selections. */
  myOptionIds: string[];
  createdAt: string;
  closedAt: string | null;
}
