'use client';

import type {
  AnnouncementPayload,
  BlocklistEntry,
  ChatMessagePayload,
  MeetingSettings,
  MeetingSummary,
  ParticipantRole,
  PollPayload,
  QuizLiveView,
  QuizProgress,
  QuizResults,
  ReactionKey,
  RoomParticipant,
  WaitingParticipant,
} from '@orbit/shared';
import type { ConnectionQuality, LocalTrackPublication, RemoteTrackPublication, Track } from 'livekit-client';
import { create } from 'zustand';

/**
 * Meeting state.
 *
 * Split into independent slices so a single change touches as little of the UI
 * as possible: an audio-level flip updates one tile, a chat message updates the
 * chat panel and the unread badge, and neither re-renders the video grid.
 *
 * Media *tracks* are held here as LiveKit objects rather than copied, because
 * attaching a track to a <video> element is a DOM operation, not a render.
 */

export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'waiting'
  | 'left'
  | 'ended'
  | 'removed'
  | 'locked'
  | 'error';

export type LayoutMode = 'grid' | 'speaker';
export type PanelId = 'chat' | 'people' | 'info' | 'diagnostics' | 'polls' | 'blocklist' | 'quiz' | null;

export interface TrackBundle {
  camera?: Track;
  microphone?: Track;
  screen?: Track;
  screenAudio?: Track;
  publications: {
    camera?: RemoteTrackPublication | LocalTrackPublication;
    microphone?: RemoteTrackPublication | LocalTrackPublication;
    screen?: RemoteTrackPublication | LocalTrackPublication;
  };
}

export interface FloatingReaction {
  id: string;
  identity: string;
  name: string;
  reaction: ReactionKey;
}

export interface Notice {
  id: string;
  kind: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface NetworkStats {
  quality: ConnectionQuality | 'unknown';
  packetLoss: number;
  latencyMs: number;
  jitterMs: number;
  outboundKbps: number;
  inboundKbps: number;
}

interface RoomState {
  phase: ConnectionPhase;
  /** Set when phase is 'error'; a message already written for an end user. */
  errorMessage: string | null;
  endedBy: string | null;

  meeting: MeetingSummary | null;
  selfIdentity: string | null;
  selfRole: ParticipantRole;
  selfParticipantId: string | null;

  participants: Record<string, RoomParticipant>;
  order: string[];
  tracks: Record<string, TrackBundle>;
  speaking: Record<string, boolean>;
  quality: Record<string, ConnectionQuality | 'unknown'>;

  waiting: WaitingParticipant[];
  messages: ChatMessagePayload[];
  unreadCount: number;

  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  blurEnabled: boolean;
  handRaised: boolean;

  recording: { active: boolean; startedAt: string | null };

  /** Identities the host promoted for everyone. Distinct from a personal pin. */
  spotlight: string[];
  /** Newest announcement banner, or null when there is none. */
  announcement: AnnouncementPayload | null;
  polls: PollPayload[];
  /** Host-only; empty for everyone else because the server never sends it. */
  blocklist: BlocklistEntry[];
  /** Polls opened since the panel was last looked at. */
  unreadPolls: number;

  /** The quiz this participant is currently taking, as the server shaped it. */
  quiz: QuizLiveView | null;
  /** Lobby countdown before the first question. */
  quizStarting: { quizId: string; title: string; questionCount: number; startsAt: number } | null;
  quizResults: QuizResults | null;
  /** Host-only: how many have joined and submitted. */
  quizProgress: QuizProgress | null;

  activeSpeaker: string | null;
  presenter: string | null;

  layout: LayoutMode;
  panel: PanelId;
  pinned: string | null;
  fullscreenIdentity: string | null;
  /** Hides everything but the speaker and the essential controls. */
  focusMode: boolean;

  reactions: FloatingReaction[];
  notices: Notice[];
  networkStats: NetworkStats;

  /** Server time at snapshot, used to keep the meeting timer honest. */
  serverTimeOffsetMs: number;

  // -- actions -------------------------------------------------------------
  setPhase: (phase: ConnectionPhase, errorMessage?: string | null) => void;
  applySnapshot: (payload: {
    meeting: MeetingSummary;
    self: RoomParticipant;
    participants: RoomParticipant[];
    waiting: WaitingParticipant[];
    messages: ChatMessagePayload[];
    recording: { active: boolean; startedAt: string | null };
    spotlight?: string[];
    announcement?: AnnouncementPayload | null;
    polls?: PollPayload[];
    serverTime: string;
  }) => void;
  upsertParticipant: (participant: RoomParticipant) => void;
  patchParticipant: (identity: string, patch: Partial<RoomParticipant>) => void;
  removeParticipant: (identity: string) => void;
  setTracks: (identity: string, bundle: TrackBundle) => void;
  clearTracks: (identity: string) => void;
  setSpeaking: (identities: string[]) => void;
  setQuality: (identity: string, quality: ConnectionQuality) => void;
  setWaiting: (waiting: WaitingParticipant[]) => void;
  addMessage: (message: ChatMessagePayload) => void;
  setSettings: (settings: MeetingSettings, locked: boolean) => void;
  setLocked: (locked: boolean) => void;
  setRecording: (active: boolean, startedAt: string | null) => void;
  setSpotlight: (identities: string[]) => void;
  setAnnouncement: (announcement: AnnouncementPayload | null) => void;
  upsertPoll: (poll: PollPayload) => void;
  setBlocklist: (entries: BlocklistEntry[]) => void;
  setQuiz: (quiz: QuizLiveView | null) => void;
  setQuizStarting: (payload: { quizId: string; title: string; questionCount: number; startsAt: number } | null) => void;
  setQuizResults: (results: QuizResults | null) => void;
  setQuizProgress: (progress: QuizProgress | null) => void;
  setLocalMedia: (patch: { mic?: boolean; camera?: boolean; screen?: boolean; blur?: boolean }) => void;
  setHandRaised: (raised: boolean) => void;
  setSelfRole: (role: ParticipantRole) => void;
  pushReaction: (reaction: FloatingReaction) => void;
  dropReaction: (id: string) => void;
  notify: (kind: Notice['kind'], message: string) => void;
  dismissNotice: (id: string) => void;
  setLayout: (layout: LayoutMode) => void;
  setPanel: (panel: PanelId) => void;
  togglePin: (identity: string) => void;
  setFullscreenIdentity: (identity: string | null) => void;
  toggleFocusMode: () => void;
  setNetworkStats: (stats: Partial<NetworkStats>) => void;
  reset: () => void;
}

const initialNetwork: NetworkStats = {
  quality: 'unknown',
  packetLoss: 0,
  latencyMs: 0,
  jitterMs: 0,
  outboundKbps: 0,
  inboundKbps: 0,
};

const initial = {
  phase: 'idle' as ConnectionPhase,
  errorMessage: null,
  endedBy: null,
  meeting: null,
  selfIdentity: null,
  selfRole: 'PARTICIPANT' as ParticipantRole,
  selfParticipantId: null,
  participants: {} as Record<string, RoomParticipant>,
  order: [] as string[],
  tracks: {} as Record<string, TrackBundle>,
  speaking: {} as Record<string, boolean>,
  quality: {} as Record<string, ConnectionQuality | 'unknown'>,
  waiting: [] as WaitingParticipant[],
  messages: [] as ChatMessagePayload[],
  unreadCount: 0,
  micEnabled: false,
  cameraEnabled: false,
  screenSharing: false,
  blurEnabled: false,
  handRaised: false,
  recording: { active: false, startedAt: null as string | null },
  spotlight: [] as string[],
  announcement: null as AnnouncementPayload | null,
  polls: [] as PollPayload[],
  blocklist: [] as BlocklistEntry[],
  unreadPolls: 0,
  quiz: null as QuizLiveView | null,
  quizStarting: null as { quizId: string; title: string; questionCount: number; startsAt: number } | null,
  quizResults: null as QuizResults | null,
  quizProgress: null as QuizProgress | null,
  activeSpeaker: null,
  presenter: null,
  layout: 'grid' as LayoutMode,
  panel: null as PanelId,
  pinned: null,
  focusMode: false,
  fullscreenIdentity: null,
  reactions: [] as FloatingReaction[],
  notices: [] as Notice[],
  networkStats: initialNetwork,
  serverTimeOffsetMs: 0,
};

let noticeSeq = 0;

export const useRoomStore = create<RoomState>((set, get) => ({
  ...initial,

  setPhase(phase, errorMessage = null) {
    set({ phase, ...(errorMessage !== undefined ? { errorMessage } : {}) });
  },

  applySnapshot(payload) {
    const participants: Record<string, RoomParticipant> = {};
    const order: string[] = [];
    for (const p of payload.participants) {
      participants[p.identity] = p;
      order.push(p.identity);
    }
    // The snapshot may arrive before or after the local participant row.
    if (!participants[payload.self.identity]) {
      participants[payload.self.identity] = payload.self;
      order.unshift(payload.self.identity);
    }

    const presenter = payload.participants.find((p) => p.screenSharing)?.identity ?? null;

    set((state) => ({
      meeting: payload.meeting,
      selfIdentity: payload.self.identity,
      selfRole: payload.self.role,
      selfParticipantId: payload.self.participantId,
      participants,
      order,
      waiting: payload.waiting,
      messages: payload.messages,
      // Rejoining should not resurrect an old unread badge.
      unreadCount: state.panel === 'chat' ? 0 : state.unreadCount,
      recording: payload.recording,
      spotlight: payload.spotlight ?? [],
      announcement: payload.announcement ?? null,
      polls: payload.polls ?? [],
      handRaised: Boolean(payload.self.handRaisedAt),
      presenter,
      layout: presenter ? 'speaker' : state.layout,
      serverTimeOffsetMs: new Date(payload.serverTime).getTime() - Date.now(),
    }));
  },

  upsertParticipant(participant) {
    set((state) => ({
      participants: { ...state.participants, [participant.identity]: participant },
      order: state.order.includes(participant.identity)
        ? state.order
        : [...state.order, participant.identity],
    }));
  },

  patchParticipant(identity, patch) {
    set((state) => {
      const existing = state.participants[identity];
      if (!existing) return {};
      const updated = { ...existing, ...patch };

      // Screen sharing drives the presenter slot and the automatic layout swap.
      let presenter = state.presenter;
      if (patch.screenSharing === true) presenter = identity;
      else if (patch.screenSharing === false && state.presenter === identity) presenter = null;

      return {
        participants: { ...state.participants, [identity]: updated },
        presenter,
        layout: presenter && !state.presenter ? 'speaker' : state.layout,
      };
    });
  },

  removeParticipant(identity) {
    set((state) => {
      const participants = { ...state.participants };
      delete participants[identity];
      const tracks = { ...state.tracks };
      delete tracks[identity];
      const speaking = { ...state.speaking };
      delete speaking[identity];

      return {
        participants,
        tracks,
        speaking,
        order: state.order.filter((id) => id !== identity),
        pinned: state.pinned === identity ? null : state.pinned,
        presenter: state.presenter === identity ? null : state.presenter,
        activeSpeaker: state.activeSpeaker === identity ? null : state.activeSpeaker,
        fullscreenIdentity: state.fullscreenIdentity === identity ? null : state.fullscreenIdentity,
      };
    });
  },

  setTracks(identity, bundle) {
    set((state) => ({ tracks: { ...state.tracks, [identity]: bundle } }));
  },

  clearTracks(identity) {
    set((state) => {
      const tracks = { ...state.tracks };
      delete tracks[identity];
      return { tracks };
    });
  },

  /**
   * Active speakers come from the SFU, which already smooths them over a short
   * window — so a cough or a keystroke does not steal the main tile.
   */
  setSpeaking(identities) {
    const speaking: Record<string, boolean> = {};
    for (const id of identities) speaking[id] = true;
    set((state) => ({
      speaking,
      activeSpeaker: identities[0] ?? state.activeSpeaker,
    }));
  },

  setQuality(identity, quality) {
    set((state) => ({ quality: { ...state.quality, [identity]: quality } }));
  },

  setWaiting(waiting) {
    set({ waiting });
  },

  addMessage(message) {
    set((state) => {
      // Guard against a message arriving twice after a reconnect.
      if (state.messages.some((m) => m.id === message.id)) return {};
      const isOwn = message.senderIdentity === state.selfIdentity;
      const chatOpen = state.panel === 'chat';
      return {
        messages: [...state.messages, message],
        unreadCount: chatOpen || isOwn ? state.unreadCount : state.unreadCount + 1,
      };
    });
  },

  setSettings(settings, locked) {
    set((state) =>
      state.meeting ? { meeting: { ...state.meeting, settings, locked } } : {},
    );
  },

  setLocked(locked) {
    set((state) => (state.meeting ? { meeting: { ...state.meeting, locked } } : {}));
  },

  setRecording(active, startedAt) {
    set({ recording: { active, startedAt } });
  },

  setSpotlight(identities) {
    set({ spotlight: identities });
  },

  setAnnouncement(announcement) {
    set({ announcement });
  },

  /**
   * Polls arrive per viewer and can update on every vote, so the list is keyed
   * by id and replaced in place. Newest first, matching how the server sends
   * them, so an opening poll appears at the top rather than below old results.
   */
  upsertPoll(poll) {
    set((state) => {
      const existing = state.polls.findIndex((p) => p.id === poll.id);
      const polls =
        existing >= 0
          ? state.polls.map((p, index) => (index === existing ? poll : p))
          : [poll, ...state.polls];

      const isNew = existing < 0 && poll.status === 'OPEN';
      return {
        polls,
        unreadPolls: isNew && state.panel !== 'polls' ? state.unreadPolls + 1 : state.unreadPolls,
      };
    });
  },

  setBlocklist(entries) {
    set({ blocklist: entries });
  },

  setQuiz(quiz) {
    // A running quiz takes the panel, because missing the start of a timed
    // quiz because a different panel was open would be unfair.
    set((state) => ({
      quiz,
      panel: quiz && quiz.status === 'RUNNING' ? 'quiz' : state.panel,
      quizStarting: null,
    }));
  },

  setQuizStarting(payload) {
    // `undefined` in a Zustand partial overwrites rather than being ignored, so
    // the panel is only named when there is actually a quiz to show — clearing
    // the lobby must leave whatever panel the user had open alone.
    set((state) => ({
      quizStarting: payload,
      quizResults: null,
      panel: payload ? 'quiz' : state.panel,
    }));
  },

  setQuizResults(results) {
    set({ quizResults: results });
  },

  setQuizProgress(progress) {
    set({ quizProgress: progress });
  },

  setLocalMedia(patch) {
    set((state) => ({
      micEnabled: patch.mic ?? state.micEnabled,
      cameraEnabled: patch.camera ?? state.cameraEnabled,
      screenSharing: patch.screen ?? state.screenSharing,
      blurEnabled: patch.blur ?? state.blurEnabled,
    }));
  },

  setHandRaised(handRaised) {
    set({ handRaised });
  },

  setSelfRole(selfRole) {
    set({ selfRole });
  },

  pushReaction(reaction) {
    set((state) => ({ reactions: [...state.reactions, reaction] }));
  },

  dropReaction(id) {
    set((state) => ({ reactions: state.reactions.filter((r) => r.id !== id) }));
  },

  /** Collapses repeats so a burst of joins does not stack identical toasts. */
  notify(kind, message) {
    const state = get();
    if (state.notices.some((n) => n.message === message)) return;
    noticeSeq += 1;
    const id = `n${noticeSeq}`;
    set({ notices: [...state.notices.slice(-3), { id, kind, message }] });
  },

  dismissNotice(id) {
    set((state) => ({ notices: state.notices.filter((n) => n.id !== id) }));
  },

  setLayout(layout) {
    set({ layout });
  },

  setPanel(panel) {
    set((state) => ({
      panel,
      unreadCount: panel === 'chat' ? 0 : state.unreadCount,
      unreadPolls: panel === 'polls' ? 0 : state.unreadPolls,
    }));
  },

  togglePin(identity) {
    set((state) => ({
      pinned: state.pinned === identity ? null : identity,
      layout: state.pinned === identity ? state.layout : 'speaker',
    }));
  },

  setFullscreenIdentity(fullscreenIdentity) {
    set({ fullscreenIdentity });
  },

  toggleFocusMode() {
    // Focus mode also closes any open panel: the point is fewer things on
    // screen, and leaving chat open would defeat it.
    set((state) => ({ focusMode: !state.focusMode, panel: state.focusMode ? state.panel : null }));
  },

  setNetworkStats(stats) {
    set((state) => ({ networkStats: { ...state.networkStats, ...stats } }));
  },

  reset() {
    set({ ...initial, participants: {}, tracks: {}, speaking: {}, quality: {}, messages: [], order: [] });
  },
}));

// ------------------------------------------------------------------ selectors

export const selectParticipant = (identity: string) => (state: RoomState) => state.participants[identity];
export const selectTracks = (identity: string) => (state: RoomState) => state.tracks[identity];
export const selectIsSpeaking = (identity: string) => (state: RoomState) => Boolean(state.speaking[identity]);

export const selectIsHost = (state: RoomState): boolean =>
  state.selfRole === 'HOST' || state.selfRole === 'COHOST';

/** Raised hands, oldest first — the order they should be called on. */
/**
 * Derivations, deliberately not store selectors.
 *
 * Zustand v5 compares selector results by reference, so a selector that builds
 * a new array on every call never settles: React re-reads the snapshot, gets a
 * different array, and re-renders until it throws "getSnapshot should be
 * cached". These are therefore plain functions over an already-subscribed
 * slice, to be wrapped in `useMemo` at the call site — which makes the
 * caching requirement impossible to forget.
 */
export function raisedHandsFrom(
  participants: Record<string, RoomParticipant>,
): RoomParticipant[] {
  return Object.values(participants)
    .filter((p) => p.handRaisedAt)
    .sort((a, b) => new Date(a.handRaisedAt!).getTime() - new Date(b.handRaisedAt!).getTime());
}

export function visibleParticipantsFrom(
  order: string[],
  participants: Record<string, RoomParticipant>,
): RoomParticipant[] {
  return order.map((id) => participants[id]).filter((p): p is RoomParticipant => Boolean(p));
}
