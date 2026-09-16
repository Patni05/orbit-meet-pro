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
  /**
   * This participant's consent to presence checks, and the state of any check.
   *
   * Only ever a state machine value — never an image, a device or a location.
   * A host uses it to know who may be asked; it does not let them look.
   */
  presenceCheck: PresenceCheckState;
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
  /** Meeting-wide media locks, enforced server-side. */
  locks: MediaLocks;
  /** The host's task list. Visible to everyone; only hosts may change it. */
  todos: TodoPayload[];
  /** Whether co-hosts may change the task list. The host alone sets this. */
  cohostsManageTodos: boolean;
  /** Recordings for this meeting. Host-only; empty for everyone else. */
  recordings: RecordingPayload[];
  /** This participant's own presence-check consent and state. */
  presenceCheck: PresenceCheckState;
  /** Whether only the host may end the meeting for everyone. */
  hostOnlyExit: boolean;
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

// ---------------------------------------------------------------------------
// Live quiz / exam
// ---------------------------------------------------------------------------

export type QuizStatus = 'DRAFT' | 'RUNNING' | 'ENDED';
export type QuizTimerMode = 'PER_QUESTION' | 'TOTAL';
export type QuizFlow = 'ONE_AT_A_TIME' | 'ALL_AT_ONCE';
export type QuizQuestionKind = 'SINGLE' | 'MULTI' | 'TRUE_FALSE';
export type QuizResultVisibility =
  | 'LEADERBOARD_AND_ANSWERS'
  | 'LEADERBOARD_ONLY'
  | 'OWN_ONLY'
  | 'HOST_ONLY';
export type QuizRevealMode = 'AFTER_EACH_QUESTION' | 'AT_END' | 'NEVER';

export interface QuizSettings {
  timerMode: QuizTimerMode;
  flow: QuizFlow;
  totalSeconds: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  negativeMarking: boolean;
  negativePoints: number;
  allowLateJoin: boolean;
  allowAnswerChange: boolean;
  resultVisibility: QuizResultVisibility;
  revealMode: QuizRevealMode;
}

/** An option as a participant sees it: no correctness flag. */
export interface QuizOptionView {
  id: string;
  label: string;
}

/** An option as the host sees it, or as everyone sees it after the reveal. */
export interface QuizOptionKeyed extends QuizOptionView {
  isCorrect: boolean;
}

export interface QuizQuestionView {
  id: string;
  position: number;
  kind: QuizQuestionKind;
  prompt: string;
  points: number;
  seconds: number;
  options: QuizOptionView[];
  /**
   * Present only once the quiz's reveal rules allow it. Its absence is the
   * mechanism, not a UI choice — the answer key is simply not in the payload.
   */
  correctOptionIds?: string[];
  explanation?: string | null;
}

/** What a participant taking the quiz receives. */
export interface QuizLiveView {
  id: string;
  title: string;
  status: QuizStatus;
  settings: QuizSettings;
  questionCount: number;
  totalPoints: number;

  /** Server instants. Clients derive a countdown from these, never their own. */
  startedAt: string | null;
  endsAt: string | null;
  serverTime: string;

  /** For ONE_AT_A_TIME flow. */
  currentQuestionIndex: number;
  currentQuestionEndsAt: string | null;

  /** Questions this participant may currently see, in their own order. */
  questions: QuizQuestionView[];
  /** This participant's own saved answers, so a refresh restores them. */
  myAnswers: Record<string, string[]>;
  mySubmittedAt: string | null;
}

export interface QuizScoreRow {
  rank: number;
  participantId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  accuracy: number;
  timeTakenMs: number;
  submittedAt: string | null;
}

export interface QuizQuestionAnalytics {
  questionId: string;
  position: number;
  prompt: string;
  correctOptionIds: string[];
  explanation: string | null;
  /** How many chose each option. */
  optionCounts: { optionId: string; label: string; count: number }[];
  correctCount: number;
  totalAnswered: number;
  accuracy: number;
  averageResponseMs: number;
}

export interface QuizResults {
  quizId: string;
  title: string;
  status: QuizStatus;
  endedAt: string | null;
  participantCount: number;
  questionCount: number;
  totalResponses: number;
  correctResponses: number;
  wrongResponses: number;
  unansweredResponses: number;
  averageScore: number;
  averageAccuracy: number;
  highestScore: number;
  lowestScore: number;
  averageCompletionMs: number;
  easiest: { position: number; prompt: string; accuracy: number } | null;
  hardest: { position: number; prompt: string; accuracy: number } | null;
  leaderboard: QuizScoreRow[];
  /** Host-only, and omitted entirely when the visibility rules forbid it. */
  questions?: QuizQuestionAnalytics[];
  /** The viewer's own row, always included when they took part. */
  me: QuizScoreRow | null;
}

/** Live progress, for the host while a quiz runs. */
export interface QuizProgress {
  quizId: string;
  joined: number;
  submitted: number;
  /** Deliberately no per-option breakdown: a host watching answers arrive
   *  could steer the room. */
}

/** A row in the meeting's quiz history. */
export interface QuizSummary {
  id: string;
  title: string;
  status: QuizStatus;
  questionCount: number;
  participantCount: number;
  averageScore: number;
  topName: string | null;
  createdAt: string;
  endedAt: string | null;
}

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

export type WhiteboardMode = 'EVERYONE' | 'HOSTS_ONLY' | 'SELECTED';
export type WhiteboardTool = 'pen' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'text';

/**
 * One drawing operation.
 *
 * Points are normalised to 0–1 in both axes, so a stroke drawn on a phone
 * lands in the same place on a widescreen monitor instead of being clipped or
 * squashed.
 */
export interface WhiteboardStrokePayload {
  id: string;
  authorIdentity: string;
  authorName: string;
  tool: WhiteboardTool;
  color: string;
  width: number;
  points: number[];
  text?: string | null;
  seq: number;
}

export interface WhiteboardState {
  mode: WhiteboardMode;
  /** Whether *this* viewer may currently draw, decided by the server. */
  canDraw: boolean;
  allowed: string[];
  denied: string[];
  strokes: WhiteboardStrokePayload[];
}

// ---------------------------------------------------------------------------
// Global media locks, todos, presence checks and recordings
// ---------------------------------------------------------------------------

/**
 * Meeting-wide media locks.
 *
 * Distinct from muting everyone once: a lock persists, and while it is on the
 * server refuses an ordinary participant's attempt to publish. The client
 * greys the control out as a courtesy, but that is not what enforces it.
 */
export interface MediaLocks {
  micLocked: boolean;
  cameraLocked: boolean;
}

export type PresenceCheckState =
  | 'NOT_ASKED'
  | 'ALLOWED'
  | 'DENIED'
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'EXPIRED';

export interface TodoPayload {
  id: string;
  text: string;
  completed: boolean;
  completedAt: string | null;
  createdByName: string;
  position: number;
  createdAt: string;
}

export interface RecordingPayload {
  id: string;
  status: RecordingStatus;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
  audioOnly: boolean;
  fileName: string | null;
  mimeType: string | null;
  /** Present only for someone allowed to download it. */
  downloadUrl?: string | null;
}
