'use client';

import {
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  LocalParticipant,
  Participant,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalTrackPublication,
  type RemoteTrack,
  type AudioCaptureOptions,
  type RemoteTrackPublication,
  type RoomOptions,
  type VideoCaptureOptions,
} from 'livekit-client';
import { io, type Socket } from 'socket.io-client';
import {
  RT_NAMESPACE,
  REACTION_EMOJI,
  type ClientEvents,
  type JoinTicket,
  type BlocklistEntry,
  type PollPayload,
  type ReactionKey,
  type RecordingPayload,
  type TodoPayload,
  type WhiteboardMode,
  type WhiteboardState,
  type WhiteboardStrokePayload,
  type RoomParticipant,
  type ServerEvents,
} from '@orbit/shared';
import { RT_URL } from './api';
import { capabilities } from './capabilities';
import { useRoomStore, type TrackBundle } from './room-store';

/**
 * The meeting client.
 *
 * Two connections, one job each:
 *   - LiveKit carries media through the SFU.
 *   - Socket.IO carries authority: chat, roles, moderation, waiting room.
 *
 * Both are owned here rather than by a component, so a React re-render, a route
 * transition or a fast refresh never tears down a live call. React reads state
 * from the store; this module writes it.
 */

type OrbitSocket = Socket<ServerEvents, ClientEvents>;

/**
 * LiveKit's capture options are a narrower shape than raw MediaTrackConstraints,
 * so the two are built here rather than reusing the getUserMedia constraints
 * from the pre-join screen.
 */
function lkAudioOptions(deviceId?: string): AudioCaptureOptions {
  return {
    ...(deviceId && deviceId !== 'default' ? { deviceId } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

function lkVideoOptions(deviceId?: string): VideoCaptureOptions {
  return {
    ...(deviceId && deviceId !== 'default' ? { deviceId } : {}),
    resolution: VideoPresets.h720.resolution,
  };
}

/**
 * How long a reaction stays in the store.
 *
 * Kept a little longer than the CSS rise (4.2s) plus its largest stagger
 * (220ms), so the element is always removed after it has finished animating
 * rather than during. The two are coupled: shortening the animation without
 * shortening this only leaves a finished reaction sitting invisible, but
 * shortening this without the animation makes reactions disappear in mid-air.
 */
const REACTION_LIFETIME_MS = 4600;

const roomOptions: RoomOptions = {
  /**
   * adaptiveStream drops the resolution of tracks rendered in small tiles and
   * pauses ones that are off-screen; dynacast stops the SFU forwarding layers
   * nobody is watching. Together they are what keeps a 12-person grid from
   * melting a laptop.
   */
  adaptiveStream: true,
  dynacast: true,

  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },
  audioCaptureDefaults: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  publishDefaults: {
    /**
     * Simulcast publishes three quality layers so each viewer gets what their
     * connection and tile size can handle.
     */
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    videoCodec: 'vp8',
    dtx: true,
    red: true,
    // Audio is the last thing that should degrade, so it gets priority.
    audioPreset: { maxBitrate: 32_000, priority: 'high' },
    screenShareEncoding: {
      maxBitrate: 1_500_000,
      maxFramerate: 15,
      priority: 'high',
    },
  },
  disconnectOnPageLeave: true,
  stopLocalTrackOnUnpublish: true,
};

export interface MeetingClientCallbacks {
  onRemoved?: (by: string) => void;
  onEnded?: (by: string) => void;
  onAdmitted?: () => void;
  onRejected?: (reason: string) => void;
}

class MeetingClient {
  room: Room | null = null;
  private socket: OrbitSocket | null = null;
  private ticket: JoinTicket | null = null;
  private callbacks: MeetingClientCallbacks = {};
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private reactionSeq = 0;
  /** Set while we are intentionally tearing down, so teardown is not treated as a drop. */
  private leaving = false;

  private get store() {
    return useRoomStore.getState();
  }

  // ------------------------------------------------------------------ connect

  /**
   * Joins the realtime channel only. Used by the waiting room, where there is
   * no media session yet — just a socket waiting to hear "you're in".
   */
  connectRealtimeOnly(sessionToken: string, callbacks: MeetingClientCallbacks = {}): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
    this.openSocket(sessionToken);
  }

  async connect(ticket: JoinTicket, options: {
    micEnabled: boolean;
    cameraEnabled: boolean;
    audioDeviceId?: string;
    videoDeviceId?: string;
    callbacks?: MeetingClientCallbacks;
  }): Promise<void> {
    this.leaving = false;
    this.ticket = ticket;
    this.callbacks = { ...this.callbacks, ...(options.callbacks ?? {}) };

    const store = this.store;
    store.setPhase('connecting');

    // The control channel comes up first so roster and chat are ready the
    // moment media connects.
    this.openSocket(ticket.sessionToken);

    const room = new Room({
      ...roomOptions,
      videoCaptureDefaults: {
        ...roomOptions.videoCaptureDefaults,
        ...(options.videoDeviceId ? { deviceId: options.videoDeviceId } : {}),
      },
      audioCaptureDefaults: {
        ...roomOptions.audioCaptureDefaults,
        ...(options.audioDeviceId ? { deviceId: options.audioDeviceId } : {}),
      },
    });
    this.room = room;
    this.bindRoomEvents(room);

    await room.connect(ticket.livekitUrl, ticket.token, { autoSubscribe: true });

    // Publish only what the user actually enabled on the pre-join screen.
    if (options.micEnabled) {
      await this.setMicrophone(true, options.audioDeviceId).catch(() => undefined);
    }
    if (options.cameraEnabled) {
      await this.setCamera(true, options.videoDeviceId).catch(() => undefined);
    }

    this.syncLocalTracks();
    this.startStatsLoop();
    store.setPhase('connected');
  }

  // ------------------------------------------------------------------- socket

  private openSocket(sessionToken: string): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }

    const socket: OrbitSocket = io(`${RT_URL}${RT_NAMESPACE}`, {
      path: '/realtime',
      transports: ['websocket', 'polling'],
      auth: { sessionToken },
      withCredentials: true,
      // Keep retrying with backoff: a phone changing networks should come back
      // on its own rather than needing the user to rejoin.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 6000,
      timeout: 12_000,
    });
    this.socket = socket;

    socket.on('connect_error', (error) => {
      const message = error.message ?? '';
      // An auth failure will never succeed on retry; stop and explain.
      if (message === 'UNAUTHORIZED' || message === 'FORBIDDEN') {
        socket.disconnect();
        this.store.setPhase('error', 'This meeting session is no longer valid. Please rejoin.');
      } else if (message === 'MEETING_ENDED') {
        socket.disconnect();
        this.store.setPhase('ended');
      }
    });

    socket.on('disconnect', (reason) => {
      if (this.leaving) return;
      if (reason === 'io server disconnect') return;
      // Media may still be flowing; surface it quietly rather than alarming.
      this.store.notify('warn', 'Reconnecting to the meeting…');
    });

    socket.on('room:state', (state) => {
      this.store.applySnapshot(state);
      this.syncLocalTracks();
    });

    socket.on('room:error', ({ message }) => {
      this.store.setPhase('error', message);
    });

    socket.on('participant:joined', (participant: RoomParticipant) => {
      this.store.upsertParticipant(participant);
      this.store.notify('info', `${participant.name} joined`);
    });

    socket.on('participant:left', ({ identity, name, reason }) => {
      this.store.removeParticipant(identity);
      if (reason === 'REMOVED') this.store.notify('warn', `${name} was removed`);
      else this.store.notify('info', `${name} left`);
    });

    socket.on('participant:updated', (patch) => {
      this.store.patchParticipant(patch.identity, patch);
    });

    socket.on('participant:role', ({ identity, role }) => {
      this.store.patchParticipant(identity, { role });
      if (identity === this.store.selfIdentity) this.store.setSelfRole(role);
    });

    socket.on('media:state', ({ identity, ...patch }) => {
      this.store.patchParticipant(identity, patch);
    });

    socket.on('media:force-mute', ({ by, kind }) => {
      void (async () => {
        if (kind === 'audio') {
          await this.setMicrophone(false);
          this.store.notify('warn', `${by} muted your microphone`);
        } else {
          await this.setCamera(false);
          this.store.notify('warn', `${by} turned off your camera`);
        }
      })();
    });

    socket.on('media:unmute-request', ({ by }) => {
      this.store.notify('info', `${by} asked you to unmute`);
    });

    socket.on('hand:updated', ({ identity, handRaisedAt, name }) => {
      this.store.patchParticipant(identity, { handRaisedAt });
      if (identity === this.store.selfIdentity) this.store.setHandRaised(Boolean(handRaisedAt));
      else if (handRaisedAt) this.store.notify('info', `${name} raised their hand`);
    });

    socket.on('reaction', ({ identity, name, reaction }) => {
      this.reactionSeq += 1;
      const id = `r${this.reactionSeq}`;
      this.store.pushReaction({ id, identity, name, reaction: reaction as ReactionKey });
      // Reactions are transient by design — they clear themselves. This must
      // outlast the rise animation plus its stagger, or the element is
      // unmounted mid-flight and the reaction vanishes halfway up the screen.
      setTimeout(() => this.store.dropReaction(id), REACTION_LIFETIME_MS);
    });

    socket.on('chat:message', (message) => {
      this.store.addMessage(message);
    });

    socket.on('waiting:updated', ({ waiting }) => {
      const previous = this.store.waiting.length;
      this.store.setWaiting(waiting);
      if (waiting.length > previous) {
        const newest = waiting[waiting.length - 1];
        if (newest) this.store.notify('info', `${newest.name} is waiting to join`);
      }
    });

    socket.on('waiting:admitted', () => {
      this.callbacks.onAdmitted?.();
    });

    socket.on('waiting:rejected', ({ reason }) => {
      this.callbacks.onRejected?.(reason);
    });

    socket.on('meeting:settings', ({ settings, locked }) => {
      this.store.setSettings(settings, locked);
    });

    socket.on('meeting:locked', ({ locked, by }) => {
      this.store.setLocked(locked);
      this.store.notify('info', locked ? `${by} locked the meeting` : `${by} unlocked the meeting`);
    });

    socket.on('meeting:recording', ({ active, startedAt, by }) => {
      this.store.setRecording(active, startedAt);
      this.store.notify(active ? 'warn' : 'info', active ? `${by} started recording` : `${by} stopped recording`);
    });

    socket.on('spotlight:updated', ({ identities, by }) => {
      this.store.setSpotlight(identities);
      this.store.notify('info', identities.length > 0 ? `${by} changed the spotlight` : `${by} cleared the spotlight`);
    });

    socket.on('announcement:posted', (announcement) => {
      this.store.setAnnouncement(announcement);
    });

    socket.on('announcement:cleared', () => {
      this.store.setAnnouncement(null);
    });

    socket.on('blocklist:updated', ({ entries }) => {
      this.store.setBlocklist(entries);
    });

    /**
     * A block is final for this meeting, so the client tears down rather than
     * retrying: leaving the socket to reconnect would just be refused, and the
     * person deserves a clear explanation instead of a spinner.
     */
    socket.on('you:blocked', ({ by, reason }) => {
      void this.teardown();
      useRoomStore.setState({
        phase: 'removed',
        endedBy: by,
        errorMessage: reason ? `You were blocked by ${by}: ${reason}` : `You were blocked by ${by}.`,
      });
    });

    socket.on('quiz:starting', ({ quizId, title, questionCount, startsInMs }) => {
      this.store.setQuizStarting({ quizId, title, questionCount, startsAt: Date.now() + startsInMs });
    });

    socket.on('quiz:started', (view) => {
      this.store.setQuiz(view);
    });

    socket.on('quiz:updated', (view) => {
      this.store.setQuiz(view);
    });

    socket.on('quiz:ended', () => {
      this.store.notify('info', 'The quiz has ended');
    });

    socket.on('quiz:results', (results) => {
      this.store.setQuizResults(results);
    });

    socket.on('quiz:progress', (progress) => {
      this.store.setQuizProgress(progress);
    });

    socket.on('poll:opened', (poll) => {
      this.store.upsertPoll(poll);
      this.store.notify('info', 'A poll has opened');
    });

    socket.on('poll:updated', (poll) => {
      this.store.upsertPoll(poll);
    });

    socket.on('poll:closed', (poll) => {
      this.store.upsertPoll(poll);
      this.store.notify('info', 'The poll has closed');
    });

    socket.on('meeting:ended', ({ by }) => {
      this.callbacks.onEnded?.(by);
      void this.teardown();
      useRoomStore.setState({ phase: 'ended', endedBy: by });
    });

    socket.on('you:removed', ({ by }) => {
      this.callbacks.onRemoved?.(by);
      void this.teardown();
      useRoomStore.setState({ phase: 'removed', endedBy: by });
    });

    socket.on('host:transferred', ({ name }) => {
      this.store.notify('info', `${name} is now the host`);
    });

    // ---------------------------------------------------- locks and tasks

    socket.on('locks:updated', ({ locks, by }) => {
      const previous = this.store.locks;
      this.store.setLocks(locks);

      // Only announce what actually changed, so flipping the camera lock does
      // not also claim something about the microphone.
      if (locks.micLocked !== previous.micLocked) {
        this.store.notify(
          locks.micLocked ? 'warn' : 'info',
          locks.micLocked
            ? `${by} locked microphones for participants`
            : `${by} unlocked microphones`,
        );
      }
      if (locks.cameraLocked !== previous.cameraLocked) {
        this.store.notify(
          locks.cameraLocked ? 'warn' : 'info',
          locks.cameraLocked ? `${by} locked cameras for participants` : `${by} unlocked cameras`,
        );
      }
    });

    socket.on('todos:updated', ({ todos }) => {
      this.store.setTodos(todos);
    });

    socket.on('todos:permission', ({ cohostsManageTodos }) => {
      this.store.setCohostsManageTodos(cohostsManageTodos);
    });

    socket.on('recordings:updated', ({ recordings }) => {
      this.store.setRecordings(recordings);
    });

    socket.on('recording:ready', ({ recording }) => {
      this.store.setRecordings([
        recording,
        ...this.store.recordings.filter((r) => r.id !== recording.id),
      ]);
      this.store.notify('success', 'The recording has finished processing and is ready to download.');
    });

    // ------------------------------------------------------ presence checks

    socket.on('presence:requested', ({ by, expiresAt }) => {
      this.store.setPresenceRequest({ by, expiresAt });
      this.store.setPresenceCheck('REQUESTED');
    });

    socket.on('presence:updated', ({ identity, state }) => {
      // Host-only: someone else's state changed. The host's own view of a
      // participant lives on the participant record.
      this.store.patchParticipant(identity, { presenceCheck: state });
    });

    socket.on('notice', ({ kind, message }) => {
      this.store.notify(kind, message);
    });
  }

  // -------------------------------------------------------------- room events

  private bindRoomEvents(room: Room): void {
    const store = () => useRoomStore.getState();

    room.on(RoomEvent.TrackSubscribed, (_track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      this.syncParticipantTracks(participant);
    });

    room.on(RoomEvent.TrackUnsubscribed, (_track, _pub, participant: RemoteParticipant) => {
      this.syncParticipantTracks(participant);
    });

    room.on(RoomEvent.TrackMuted, (_pub, participant) => this.syncParticipantTracks(participant));
    room.on(RoomEvent.TrackUnmuted, (_pub, participant) => this.syncParticipantTracks(participant));

    room.on(RoomEvent.LocalTrackPublished, () => this.syncLocalTracks());
    room.on(RoomEvent.LocalTrackUnpublished, () => this.syncLocalTracks());

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      this.syncParticipantTracks(participant);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      store().clearTracks(participant.identity);
    });

    /**
     * Active speaker detection is done by the SFU from real audio energy, then
     * smoothed there — so this fires on genuine speech, not every syllable.
     */
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      store().setSpeaking(speakers.map((s) => s.identity));
    });

    room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
      store().setQuality(participant.identity, quality);
    });

    room.on(RoomEvent.Reconnecting, () => {
      store().setPhase('reconnecting');
    });

    room.on(RoomEvent.Reconnected, () => {
      store().setPhase('connected');
      store().notify('success', 'Reconnected');
      this.syncLocalTracks();
      for (const participant of room.remoteParticipants.values()) {
        this.syncParticipantTracks(participant);
      }
    });

    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (this.leaving) return;

      // The server can close the connection deliberately; those cases are
      // already handled through the control channel, so do not also show a
      // generic error.
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        store().setPhase('error', 'You joined this meeting from another tab or device.');
        return;
      }
      if (reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED) return;

      store().setPhase('error', 'The connection to the meeting was lost. You can rejoin.');
    });

    room.on(RoomEvent.MediaDevicesError, (error: Error) => {
      store().notify('error', `Device problem: ${error.message}`);
    });
  }

  /** Mirrors LiveKit publications into the store for one participant. */
  private syncParticipantTracks(participant: Participant): void {
    const bundle: TrackBundle = { publications: {} };

    const camera = participant.getTrackPublication(Track.Source.Camera);
    const mic = participant.getTrackPublication(Track.Source.Microphone);
    const screen = participant.getTrackPublication(Track.Source.ScreenShare);
    const screenAudio = participant.getTrackPublication(Track.Source.ScreenShareAudio);

    if (camera?.track && !camera.isMuted) bundle.camera = camera.track;
    if (mic?.track) bundle.microphone = mic.track;
    if (screen?.track && !screen.isMuted) bundle.screen = screen.track;
    if (screenAudio?.track) bundle.screenAudio = screenAudio.track;

    bundle.publications = {
      camera: camera as RemoteTrackPublication | LocalTrackPublication | undefined,
      microphone: mic as RemoteTrackPublication | LocalTrackPublication | undefined,
      screen: screen as RemoteTrackPublication | LocalTrackPublication | undefined,
    };

    useRoomStore.getState().setTracks(participant.identity, bundle);

    // Keep the presenter slot in step with what is actually being published,
    // not only with what the control channel said.
    const isSharing = Boolean(screen?.track && !screen.isMuted);
    const store = useRoomStore.getState();
    if (isSharing && store.presenter !== participant.identity) {
      store.patchParticipant(participant.identity, { screenSharing: true });
    } else if (!isSharing && store.presenter === participant.identity) {
      store.patchParticipant(participant.identity, { screenSharing: false });
    }
  }

  private syncLocalTracks(): void {
    const room = this.room;
    if (!room) return;
    this.syncParticipantTracks(room.localParticipant);

    const local: LocalParticipant = room.localParticipant;
    useRoomStore.getState().setLocalMedia({
      mic: local.isMicrophoneEnabled,
      camera: local.isCameraEnabled,
      screen: local.isScreenShareEnabled,
    });
  }

  // ------------------------------------------------------------ media control

  async setMicrophone(enabled: boolean, deviceId?: string): Promise<void> {
    const room = this.room;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(
      enabled,
      enabled ? lkAudioOptions(deviceId) : undefined,
    );
    useRoomStore.getState().setLocalMedia({ mic: enabled });
    this.socket?.emit('media:update', { micEnabled: enabled });
  }

  async setCamera(enabled: boolean, deviceId?: string): Promise<void> {
    const room = this.room;
    if (!room) return;
    await room.localParticipant.setCameraEnabled(
      enabled,
      enabled ? lkVideoOptions(deviceId) : undefined,
    );
    useRoomStore.getState().setLocalMedia({ camera: enabled });
    this.socket?.emit('media:update', { cameraEnabled: enabled });
    this.syncLocalTracks();
  }

  /**
   * Starts or stops a screen share.
   *
   * The browser picker decides whether a screen, a window or a tab is shared;
   * cancelling it is a normal outcome, not an error.
   */
  async setScreenShare(enabled: boolean): Promise<{ ok: boolean; cancelled?: boolean; message?: string }> {
    const room = this.room;
    if (!room) return { ok: false, message: 'Not connected to the meeting.' };

    try {
      await room.localParticipant.setScreenShareEnabled(enabled, {
        audio: true,
        // 15fps is plenty for slides and code, and far kinder to bandwidth.
        contentHint: 'detail',
      });
      useRoomStore.getState().setLocalMedia({ screen: enabled });
      this.socket?.emit('media:update', { screenSharing: enabled });
      this.syncLocalTracks();
      return { ok: true };
    } catch (error) {
      const name = (error as DOMException)?.name;
      const mobile = capabilities().isMobile;

      /*
       * Telling a refusal apart from a cancellation.
       *
       * On a desktop browser `NotAllowedError` almost always means the user
       * dismissed the picker, which is a normal choice and deserves silence.
       * On a phone it usually means the browser has no screen capture at all
       * and rejected the call outright — there was no picker to dismiss. The
       * old code treated both as a cancellation, so tapping "Present" on
       * Android did nothing at all and said nothing about why.
       */
      if (name === 'AbortError' || (name === 'NotAllowedError' && !mobile)) {
        return { ok: false, cancelled: true };
      }

      if (name === 'NotSupportedError' || name === 'TypeError' || (name === 'NotAllowedError' && mobile)) {
        return {
          ok: false,
          message: mobile
            ? 'This phone or browser cannot share a screen. You can still present from a computer, or share a link in chat.'
            : 'This browser does not support screen sharing.',
        };
      }

      if (name === 'NotReadableError') {
        return { ok: false, message: 'The screen could not be captured. Another app may be blocking it.' };
      }

      return {
        ok: false,
        message: 'Screen sharing could not start. Your browser or the meeting settings may not allow it.',
      };
    }
  }

  /** Switches an input or output device without leaving the meeting. */
  async switchDevice(kind: MediaDeviceKind, deviceId: string): Promise<boolean> {
    const room = this.room;
    if (!room) return false;
    try {
      await room.switchActiveDevice(kind, deviceId);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------- control-plane calls

  setHandRaised(raised: boolean): void {
    this.socket?.emit('hand:set', { raised });
    useRoomStore.getState().setHandRaised(raised);
  }

  sendReaction(reaction: ReactionKey): void {
    if (!(reaction in REACTION_EMOJI)) return;
    this.socket?.emit('reaction:send', { reaction });
  }

  sendChat(body: string): Promise<{ ok: boolean; message?: string }> {
    return new Promise((resolve) => {
      const socket = this.socket;
      if (!socket) return resolve({ ok: false, message: 'Not connected.' });

      socket.emit('chat:send', { body, clientId: `${Date.now()}` }, (res) => {
        if (res.ok) resolve({ ok: true });
        else resolve({ ok: false, message: res.message });
      });
    });
  }

  /** Generic host action helper; the server re-checks the caller's role. */
  private hostAction<E extends keyof ClientEvents>(
    event: E,
    payload: Parameters<ClientEvents[E]>[0],
  ): Promise<{ ok: boolean; message?: string }> {
    return new Promise((resolve) => {
      const socket = this.socket;
      if (!socket) return resolve({ ok: false, message: 'Not connected.' });

      const ack = (res: { ok: true; data: unknown } | { ok: false; code: string; message: string }) => {
        if (res.ok) resolve({ ok: true });
        else {
          useRoomStore.getState().notify('error', res.message);
          resolve({ ok: false, message: res.message });
        }
      };

      (socket.emit as (e: string, p: unknown, a: typeof ack) => void)(event as string, payload, ack);
    });
  }

  /**
   * Like `hostAction`, but hands back the server's payload.
   *
   * Used where the reply matters rather than just its success — a vote comes
   * back with the poll as this viewer is allowed to see it, which is not
   * something the client could reconstruct on its own.
   */
  private request<T>(
    event: keyof ClientEvents,
    payload: unknown,
  ): Promise<{ ok: boolean; data?: T; message?: string }> {
    return new Promise((resolve) => {
      const socket = this.socket;
      if (!socket) return resolve({ ok: false, message: 'Not connected.' });

      const ack = (res: { ok: true; data: unknown } | { ok: false; code: string; message: string }) => {
        if (res.ok) resolve({ ok: true, data: res.data as T });
        else {
          useRoomStore.getState().notify('error', res.message);
          resolve({ ok: false, message: res.message });
        }
      };

      (socket.emit as (e: string, p: unknown, a: typeof ack) => void)(event as string, payload, ack);
    });
  }

  muteParticipant = (identity: string, kind: 'audio' | 'video') =>
    this.hostAction('host:mute', { identity, kind });
  muteEveryone = (includeHosts = false) => this.hostAction('host:mute-all', { includeHosts });
  requestUnmute = (identity: string) => this.hostAction('host:request-unmute', { identity });
  removeParticipant = (identity: string) => this.hostAction('host:remove', { identity });
  setRole = (identity: string, role: 'COHOST' | 'PARTICIPANT') =>
    this.hostAction('host:set-role', { identity, role });
  lowerHand = (identity: string) => this.hostAction('host:lower-hand', { identity });
  stopShare = (identity: string) => this.hostAction('host:stop-share', { identity });
  setLocked = (locked: boolean) => this.hostAction('host:lock', { locked });
  updateSettings = (settings: Record<string, unknown>) =>
    this.hostAction('host:settings', { settings: settings as never });
  admit = (participantId: string) => this.hostAction('host:admit', { participantId });
  admitAll = () => this.hostAction('host:admit-all', {});
  reject = (participantId: string) => this.hostAction('host:reject', { participantId });
  endForEveryone = () => this.hostAction('host:end-meeting', {});
  setRecording = (action: 'start' | 'stop') => this.hostAction('host:recording', { action });
  setSpotlight = (identity: string, on: boolean) => this.hostAction('host:spotlight', { identity, on });
  announce = (body: string) => this.hostAction('host:announce', { body });
  clearAnnouncement = (id: string) => this.hostAction('host:announce-clear', { id });
  blockParticipant = (identity: string, reason?: string) =>
    this.hostAction('host:block', { identity, reason });
  unblock = (entryId: string) => this.hostAction('host:unblock', { entryId });

  /** Loads the blocklist on demand; the server refuses this for non-hosts. */
  async loadBlocklist(): Promise<void> {
    const result = await this.request<BlocklistEntry[]>('host:blocklist', {});
    if (result.ok && Array.isArray(result.data)) this.store.setBlocklist(result.data);
  }

  // ------------------------------------------------------- media locks

  /**
   * Locks or unlocks a device for every ordinary participant.
   *
   * The server applies the lock and refuses `media:update` while it holds;
   * this call only asks. Nothing here disables anything locally, because a
   * client that decided its own locks would be a lock in name only.
   */
  setMediaLock = (kind: 'mic' | 'camera', locked: boolean) =>
    this.hostAction('host:media-lock', { kind, locked });

  // ------------------------------------------------------------- tasks

  createTodo = (text: string) => this.request<TodoPayload>('host:todo-create', { text });
  updateTodo = (id: string, patch: { text?: string; completed?: boolean }) =>
    this.request<TodoPayload>('host:todo-update', { id, ...patch });
  deleteTodo = (id: string) => this.hostAction('host:todo-delete', { id });
  /** Lets co-hosts manage the list too. The host alone may change this. */
  setTodoPermission = (allow: boolean) => this.hostAction('host:todo-permission', { allow });

  // -------------------------------------------------------- recordings

  /** Loads the recording list on demand; the server refuses this for non-hosts. */
  async loadRecordings(): Promise<void> {
    const result = await this.request<RecordingPayload[]>('host:recordings', {});
    if (result.ok && Array.isArray(result.data)) this.store.setRecordings(result.data);
  }

  // --------------------------------------------------- presence checks

  /**
   * Records this participant's own answer to "may the host check you are
   * here?".
   *
   * Consent is given by the participant and by nobody else — there is no host
   * call that sets it, which is why this one is not a `hostAction`.
   */
  async setPresenceConsent(allow: boolean): Promise<{ ok: boolean; message?: string }> {
    const result = await this.hostAction('presence:consent', { allow });
    if (result.ok) this.store.setPresenceCheck(allow ? 'ALLOWED' : 'DENIED');
    return result;
  }

  /** Asks one participant to confirm they are there. They may still ignore it. */
  requestPresence = (identity: string) => this.hostAction('host:presence-request', { identity });

  /** The participant's own answer to an outstanding prompt. */
  async confirmPresence(): Promise<{ ok: boolean; message?: string }> {
    const result = await this.hostAction('presence:confirm', {});
    if (result.ok) this.store.setPresenceCheck('CONFIRMED');
    return result;
  }

  createPoll = (payload: {
    question: string;
    options: string[];
    multiSelect?: boolean;
    anonymous?: boolean;
    hideResultsUntilClosed?: boolean;
  }) => this.hostAction('host:poll-create', payload);

  closePoll = (pollId: string) => this.hostAction('host:poll-close', { pollId });

  // ------------------------------------------------------------------- quiz

  createQuiz = (payload: unknown) =>
    this.request<{ quizId: string }>('host:quiz-create', payload);
  startQuiz = (quizId: string) => this.hostAction('host:quiz-start', { quizId });
  nextQuizQuestion = (quizId: string) => this.hostAction('host:quiz-next', { quizId });
  extendQuiz = (quizId: string, seconds: number) =>
    this.hostAction('host:quiz-extend', { quizId, seconds });
  endQuiz = (quizId: string) => this.hostAction('host:quiz-end', { quizId });
  listQuizzes = () => this.request<unknown[]>('host:quiz-list', {});
  exportQuiz = (quizId: string, detailed = false) =>
    this.request<{ filename: string; csv: string }>('host:quiz-export', { quizId, detailed });

  /** Participant side. Answering is open to everyone, so not a host action. */
  joinQuiz = (quizId: string) => this.request<unknown>('quiz:join', { quizId });
  answerQuiz = (quizId: string, questionId: string, optionIds: string[]) =>
    this.request('quiz:answer', { quizId, questionId, optionIds });
  submitQuiz = (quizId: string) => this.request('quiz:submit', { quizId });
  fetchQuizResults = (quizId: string) => this.request<unknown>('quiz:results', { quizId });
  reportQuizAway = (quizId: string) => this.request('quiz:away', { quizId });

  // ------------------------------------------------------------- whiteboard

  loadWhiteboard = async (): Promise<WhiteboardState | null> => {
    const result = await this.request<WhiteboardState>('whiteboard:load', {});
    return result.ok ? (result.data ?? null) : null;
  };

  drawStroke = (stroke: {
    tool: string;
    color: string;
    width: number;
    points: number[];
    text?: string | null;
  }) => this.request<WhiteboardStrokePayload>('whiteboard:draw', stroke);

  undoWhiteboard = () => this.request('whiteboard:undo', {});
  clearWhiteboard = () => this.hostAction('host:whiteboard-clear', {});
  setWhiteboardMode = (mode: WhiteboardMode) => this.hostAction('host:whiteboard-mode', { mode });
  setWhiteboardPermission = (identity: string, canDraw: boolean) =>
    this.hostAction('host:whiteboard-permission', { identity, canDraw });

  /**
   * Subscribes to board updates.
   *
   * Strokes are deliberately not mirrored into the room store: a board can
   * accumulate thousands of them, and holding that in global state would make
   * every unrelated re-render walk the whole list. The panel owns them, and
   * this returns an unsubscribe so nothing is left behind when it closes.
   */
  onWhiteboard(handlers: {
    stroke?: (stroke: WhiteboardStrokePayload) => void;
    undo?: (payload: { strokeId: string }) => void;
    cleared?: (payload: { by: string }) => void;
    permissions?: (payload: {
      mode: WhiteboardMode;
      canDraw: boolean;
      allowed: string[];
      denied: string[];
    }) => void;
  }): () => void {
    const socket = this.socket;
    if (!socket) return () => undefined;

    const bound: [string, (payload: never) => void][] = [];
    const bind = <T>(event: string, handler: ((payload: T) => void) | undefined) => {
      if (!handler) return;
      socket.on(event as never, handler as never);
      bound.push([event, handler as (payload: never) => void]);
    };

    bind('whiteboard:stroke', handlers.stroke);
    bind('whiteboard:undo', handlers.undo);
    bind('whiteboard:cleared', handlers.cleared);
    bind('whiteboard:permissions', handlers.permissions);

    return () => {
      for (const [event, handler] of bound) socket.off(event as never, handler as never);
    };
  }

  /** Voting is open to everyone, so it is not a host action. */
  vote = (pollId: string, optionIds: string[]) =>
    this.request<PollPayload>('poll:vote', { pollId, optionIds });

  // ------------------------------------------------------------------- stats

  /**
   * Samples WebRTC statistics for the connection indicator and the diagnostics
   * panel. Deliberately infrequent — this is a health signal, not telemetry.
   */
  private startStatsLoop(): void {
    this.stopStatsLoop();
    let lastBytesSent = 0;
    let lastBytesReceived = 0;
    let lastSampleAt = Date.now();

    this.statsTimer = setInterval(() => {
      void (async () => {
        const room = this.room;
        if (!room || room.state !== ConnectionState.Connected) return;

        try {
          let packetsLost = 0;
          let packetsTotal = 0;
          let jitter = 0;
          let rtt = 0;
          let bytesSent = 0;
          let bytesReceived = 0;

          const publications = [
            ...room.localParticipant.trackPublications.values(),
          ];
          for (const pub of publications) {
            const sender = (pub as LocalTrackPublication).track?.sender;
            if (!sender?.getStats) continue;
            const report = await sender.getStats();
            report.forEach((stat) => {
              if (stat.type === 'outbound-rtp') bytesSent += Number(stat.bytesSent ?? 0);
              if (stat.type === 'remote-inbound-rtp') {
                packetsLost += Number(stat.packetsLost ?? 0);
                jitter = Math.max(jitter, Number(stat.jitter ?? 0) * 1000);
                rtt = Math.max(rtt, Number(stat.roundTripTime ?? 0) * 1000);
              }
            });
          }

          for (const participant of room.remoteParticipants.values()) {
            for (const pub of participant.trackPublications.values()) {
              const receiver = (pub as RemoteTrackPublication).track?.receiver;
              if (!receiver?.getStats) continue;
              const report = await receiver.getStats();
              report.forEach((stat) => {
                if (stat.type === 'inbound-rtp') {
                  bytesReceived += Number(stat.bytesReceived ?? 0);
                  packetsLost += Number(stat.packetsLost ?? 0);
                  packetsTotal += Number(stat.packetsReceived ?? 0) + Number(stat.packetsLost ?? 0);
                  jitter = Math.max(jitter, Number(stat.jitter ?? 0) * 1000);
                }
              });
            }
          }

          const now = Date.now();
          const elapsed = Math.max(1, (now - lastSampleAt) / 1000);
          const outboundKbps = Math.max(0, ((bytesSent - lastBytesSent) * 8) / 1000 / elapsed);
          const inboundKbps = Math.max(0, ((bytesReceived - lastBytesReceived) * 8) / 1000 / elapsed);
          lastBytesSent = bytesSent;
          lastBytesReceived = bytesReceived;
          lastSampleAt = now;

          useRoomStore.getState().setNetworkStats({
            quality: room.localParticipant.connectionQuality,
            packetLoss: packetsTotal > 0 ? (packetsLost / packetsTotal) * 100 : 0,
            latencyMs: Math.round(rtt),
            jitterMs: Math.round(jitter),
            outboundKbps: Math.round(outboundKbps),
            inboundKbps: Math.round(inboundKbps),
          });
        } catch {
          // Statistics are best-effort; never let them break the call.
        }
      })();
    }, 3000);
  }

  private stopStatsLoop(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  // ---------------------------------------------------------------- teardown

  /**
   * Releases everything: camera and microphone hardware, the SFU connection,
   * the socket, and every timer. Called on leave, on removal, on meeting end
   * and on unmount, so devices never stay lit after the meeting.
   */
  async teardown(options: { notifyServer?: boolean } = {}): Promise<void> {
    this.leaving = true;
    this.stopStatsLoop();

    if (options.notifyServer && this.socket?.connected) {
      this.socket.emit('room:leave', {});
      // Give the event a moment to reach the server before closing.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    if (this.room) {
      this.room.removeAllListeners();
      try {
        await this.room.disconnect(true);
      } catch {
        // Already gone.
      }
      this.room = null;
    }

    this.ticket = null;
    this.leaving = false;
  }

  get connected(): boolean {
    return this.room?.state === ConnectionState.Connected;
  }

  get currentTicket(): JoinTicket | null {
    return this.ticket;
  }
}

/** One client per tab. */
export const meetingClient = new MeetingClient();
