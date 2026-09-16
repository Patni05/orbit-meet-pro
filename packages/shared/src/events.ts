import type {
  AnnouncementPayload,
  BlocklistEntry,
  ChatMessagePayload,
  MeetingSettings,
  ParticipantRole,
  PollPayload,
  QuizLiveView,
  QuizProgress,
  QuizResults,
  QuizSummary,
  WhiteboardMode,
  WhiteboardState,
  WhiteboardStrokePayload,
  MediaLocks,
  PresenceCheckState,
  RecordingPayload,
  TodoPayload,
  ReactionEvent,
  RoomParticipant,
  RoomState,
  WaitingParticipant,
} from './types';

/**
 * Realtime control-plane contract (Socket.IO).
 *
 * Media flows through the LiveKit SFU; this channel carries *authority* —
 * anything that needs server-side role enforcement or must persist.
 * Every `client -> server` action is re-authorized on the server.
 */

export const RT_NAMESPACE = '/rt';

/** server -> client */
export interface ServerEvents {
  'room:state': (state: RoomState) => void;
  'room:error': (payload: { code: string; message: string }) => void;

  'participant:joined': (p: RoomParticipant) => void;
  'participant:left': (payload: {
    identity: string;
    name: string;
    reason: 'LEFT' | 'REMOVED' | 'DISCONNECTED';
  }) => void;
  'participant:updated': (payload: Partial<RoomParticipant> & { identity: string }) => void;
  'participant:role': (payload: { identity: string; role: ParticipantRole }) => void;

  'media:state': (payload: {
    identity: string;
    micEnabled?: boolean;
    cameraEnabled?: boolean;
    screenSharing?: boolean;
  }) => void;
  /** Host asked this client to mute. The SFU mute is applied server-side too. */
  'media:force-mute': (payload: { by: string; kind: 'audio' | 'video' }) => void;
  'media:unmute-request': (payload: { by: string }) => void;

  'hand:updated': (payload: { identity: string; name: string; handRaisedAt: string | null }) => void;
  reaction: (payload: ReactionEvent) => void;

  'chat:message': (message: ChatMessagePayload) => void;
  'chat:cleared': () => void;

  'waiting:updated': (payload: { waiting: WaitingParticipant[] }) => void;
  'waiting:admitted': (payload: { participantId: string }) => void;
  'waiting:rejected': (payload: { participantId: string; reason: string }) => void;

  'meeting:settings': (payload: { settings: MeetingSettings; locked: boolean }) => void;
  'meeting:locked': (payload: { locked: boolean; by: string }) => void;
  'meeting:ended': (payload: { by: string; endedAt: string }) => void;
  'meeting:recording': (payload: {
    active: boolean;
    recordingId: string | null;
    startedAt: string | null;
    by: string;
  }) => void;

  'host:transferred': (payload: { identity: string; name: string }) => void;
  notice: (payload: { kind: 'info' | 'warn'; message: string }) => void;
  'you:removed': (payload: { by: string }) => void;
  'pong:rt': (payload: { serverTime: string }) => void;

  /** The host changed who is spotlighted for everyone. */
  'spotlight:updated': (payload: { identities: string[]; by: string }) => void;

  'announcement:posted': (payload: AnnouncementPayload) => void;
  'announcement:cleared': (payload: { id: string }) => void;

  /** Delivered only to the person blocked, immediately before disconnection. */
  'you:blocked': (payload: { by: string; reason: string | null }) => void;
  /** Host-only: the blocklist changed. */
  'blocklist:updated': (payload: { entries: BlocklistEntry[] }) => void;

  'poll:opened': (poll: PollPayload) => void;
  'poll:updated': (poll: PollPayload) => void;
  'poll:closed': (poll: PollPayload) => void;

  /** A quiz is about to begin; clients show a countdown. */
  'quiz:starting': (payload: { quizId: string; title: string; questionCount: number; startsInMs: number }) => void;
  'quiz:started': (view: QuizLiveView) => void;
  /** Sent when the host advances a one-at-a-time quiz, or extends the clock. */
  'quiz:updated': (view: QuizLiveView) => void;
  'quiz:ended': (payload: { quizId: string }) => void;
  'quiz:results': (results: QuizResults) => void;
  /** Host-only live progress while a quiz runs. */
  'quiz:progress': (progress: QuizProgress) => void;

  'whiteboard:stroke': (stroke: WhiteboardStrokePayload) => void;
  'whiteboard:undo': (payload: { strokeId: string }) => void;
  'whiteboard:cleared': (payload: { by: string }) => void;
  /** Permission or mode changed; carries this viewer's own recomputed rights. */
  'whiteboard:permissions': (payload: {
    mode: WhiteboardMode;
    canDraw: boolean;
    allowed: string[];
    denied: string[];
  }) => void;

  /** Meeting-wide microphone or camera lock changed. */
  'locks:updated': (payload: { locks: MediaLocks; by: string }) => void;

  'todos:updated': (payload: { todos: TodoPayload[] }) => void;
  /** Who may change the task list changed. Sent to the whole room. */
  'todos:permission': (payload: { cohostsManageTodos: boolean }) => void;

  'recording:ready': (payload: { recording: RecordingPayload }) => void;
  /** Host-only: the recording list changed. */
  'recordings:updated': (payload: { recordings: RecordingPayload[] }) => void;

  /** The host is asking this participant to confirm they are present. */
  'presence:requested': (payload: { by: string; expiresAt: string }) => void;
  /** Host-only: somebody's presence-check state changed. */
  'presence:updated': (payload: { identity: string; state: PresenceCheckState }) => void;
}

/** Acks report authorization failures instead of silently dropping the action. */
export type Ack<T = void> = (
  res: { ok: true; data: T } | { ok: false; code: string; message: string },
) => void;

/** client -> server */
export interface ClientEvents {
  'room:join': (payload: { sessionToken: string }, ack: Ack<RoomState>) => void;
  'room:leave': (payload: Record<string, never>, ack?: Ack) => void;

  'media:update': (
    payload: { micEnabled?: boolean; cameraEnabled?: boolean; screenSharing?: boolean },
    ack?: Ack,
  ) => void;

  'hand:set': (payload: { raised: boolean }, ack?: Ack) => void;
  'reaction:send': (payload: { reaction: string }, ack?: Ack) => void;
  'chat:send': (payload: { body: string; clientId: string }, ack?: Ack<ChatMessagePayload>) => void;

  'host:mute': (payload: { identity: string; kind: 'audio' | 'video' }, ack?: Ack) => void;
  'host:mute-all': (payload: { includeHosts?: boolean }, ack?: Ack) => void;
  'host:request-unmute': (payload: { identity: string }, ack?: Ack) => void;
  'host:remove': (payload: { identity: string }, ack?: Ack) => void;
  'host:set-role': (payload: { identity: string; role: ParticipantRole }, ack?: Ack) => void;
  'host:lower-hand': (payload: { identity: string }, ack?: Ack) => void;
  'host:stop-share': (payload: { identity: string }, ack?: Ack) => void;
  'host:lock': (payload: { locked: boolean }, ack?: Ack) => void;
  'host:settings': (payload: { settings: Partial<MeetingSettings> }, ack?: Ack) => void;
  'host:admit': (payload: { participantId: string }, ack?: Ack) => void;
  'host:admit-all': (payload: Record<string, never>, ack?: Ack) => void;
  'host:reject': (payload: { participantId: string }, ack?: Ack) => void;
  'host:end-meeting': (payload: Record<string, never>, ack?: Ack) => void;
  'host:recording': (payload: { action: 'start' | 'stop' }, ack?: Ack) => void;

  'host:spotlight': (payload: { identity: string; on: boolean }, ack?: Ack) => void;
  'host:announce': (payload: { body: string }, ack?: Ack<AnnouncementPayload>) => void;
  'host:announce-clear': (payload: { id: string }, ack?: Ack) => void;

  'host:block': (payload: { identity: string; reason?: string }, ack?: Ack) => void;
  'host:unblock': (payload: { entryId: string }, ack?: Ack) => void;
  'host:blocklist': (payload: Record<string, never>, ack?: Ack<BlocklistEntry[]>) => void;

  'host:poll-create': (
    payload: {
      question: string;
      options: string[];
      multiSelect?: boolean;
      anonymous?: boolean;
      hideResultsUntilClosed?: boolean;
    },
    ack?: Ack<PollPayload>,
  ) => void;
  'host:poll-close': (payload: { pollId: string }, ack?: Ack<PollPayload>) => void;
  'poll:vote': (payload: { pollId: string; optionIds: string[] }, ack?: Ack<PollPayload>) => void;

  'host:quiz-create': (payload: unknown, ack?: Ack<{ quizId: string }>) => void;
  'host:quiz-start': (payload: { quizId: string }, ack?: Ack<QuizLiveView>) => void;
  'host:quiz-next': (payload: { quizId: string }, ack?: Ack) => void;
  'host:quiz-extend': (payload: { quizId: string; seconds: number }, ack?: Ack) => void;
  'host:quiz-end': (payload: { quizId: string }, ack?: Ack) => void;
  'host:quiz-list': (payload: Record<string, never>, ack?: Ack<QuizSummary[]>) => void;
  'host:quiz-export': (payload: { quizId: string; detailed?: boolean }, ack?: Ack<{ filename: string; csv: string }>) => void;

  'quiz:join': (payload: { quizId: string }, ack?: Ack<QuizLiveView>) => void;
  'quiz:answer': (payload: { quizId: string; questionId: string; optionIds: string[] }, ack?: Ack) => void;
  'quiz:submit': (payload: { quizId: string }, ack?: Ack) => void;
  'quiz:results': (payload: { quizId: string }, ack?: Ack<QuizResults>) => void;
  /** Informational only: how often the tab lost focus during the quiz. */
  'quiz:away': (payload: { quizId: string }, ack?: Ack) => void;

  'whiteboard:load': (payload: Record<string, never>, ack?: Ack<WhiteboardState>) => void;
  'whiteboard:draw': (payload: unknown, ack?: Ack<WhiteboardStrokePayload>) => void;
  'whiteboard:undo': (payload: Record<string, never>, ack?: Ack) => void;
  'host:whiteboard-clear': (payload: Record<string, never>, ack?: Ack) => void;
  'host:whiteboard-mode': (payload: { mode: WhiteboardMode }, ack?: Ack) => void;
  'host:whiteboard-permission': (payload: { identity: string; canDraw: boolean }, ack?: Ack) => void;

  'host:media-lock': (payload: { kind: 'mic' | 'camera'; locked: boolean }, ack?: Ack) => void;

  'host:todo-create': (payload: { text: string }, ack?: Ack<TodoPayload>) => void;
  'host:todo-update': (
    payload: { id: string; text?: string; completed?: boolean },
    ack?: Ack<TodoPayload>,
  ) => void;
  'host:todo-delete': (payload: { id: string }, ack?: Ack) => void;
  'host:todo-permission': (payload: { allow: boolean }, ack?: Ack) => void;

  'host:recordings': (payload: Record<string, never>, ack?: Ack<RecordingPayload[]>) => void;

  /** The participant answers the consent question; nothing is assumed. */
  'presence:consent': (payload: { allow: boolean }, ack?: Ack) => void;
  'host:presence-request': (payload: { identity: string }, ack?: Ack) => void;
  /** The participant confirms they are present, having enabled their camera. */
  'presence:confirm': (payload: Record<string, never>, ack?: Ack) => void;

  'ping:rt': (payload: Record<string, never>, ack?: Ack<{ serverTime: string }>) => void;
}

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  MEETING_ENDED: 'MEETING_ENDED',
  MEETING_LOCKED: 'MEETING_LOCKED',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  WAITING_REJECTED: 'WAITING_REJECTED',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION: 'VALIDATION',
  CHAT_DISABLED: 'CHAT_DISABLED',
  SHARE_NOT_ALLOWED: 'SHARE_NOT_ALLOWED',
  SFU_UNAVAILABLE: 'SFU_UNAVAILABLE',
  RECORDING_UNAVAILABLE: 'RECORDING_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
