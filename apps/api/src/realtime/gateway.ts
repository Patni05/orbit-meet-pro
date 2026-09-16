import type { Server as HttpServer } from 'node:http';
import { Server, type Namespace, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { MeetingParticipant } from '@prisma/client';
import {
  ACTIVE_SPEAKER_DEBOUNCE_MS,
  CHAT_MESSAGE_MAX_LENGTH,
  ERROR_CODES,
  HOST_DISCONNECT_GRACE_MS,
  RECONNECT_GRACE_MS,
  REACTIONS,
  RT_NAMESPACE,
  announcementSchema,
  blockSchema,
  chatMessageSchema,
  meetingSettingsSchema,
  pollCreateSchema,
  pollVoteSchema,
  quizAnswerSchema,
  quizCreateSchema,
  quizExtendSchema,
  spotlightSchema,
  type Ack,
  type ClientEvents,
  type MeetingSettings,
  type ParticipantRole,
  type ServerEvents,
} from '@orbit/shared';
import { env, isProd } from '../config/env';
import { isPrivateOrigin } from '../lib/net';
import { verifySessionToken } from '../lib/jwt';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { KEYS, bumpCounter, createRedis, redis } from '../lib/redis';
import {
  deleteRoom,
  muteParticipantTracks,
  removeParticipant as removeFromSfu,
  startRoomRecording,
  stopParticipantScreenShare,
  stopRoomRecording,
  updateParticipantMetadata,
} from '../lib/livekit';
import { toRoomParticipant } from '../modules/meetings/join.service';
import { blockParticipant, listBlocklist, unblock } from '../modules/meetings/blocklist.service';
import { castVote, closePoll, createPoll, loadPoll, toPollPayload } from '../modules/meetings/polls.service';
import {
  advanceQuestion,
  buildLiveView,
  buildResults,
  createQuiz,
  detailedCsv,
  endQuiz,
  extendQuiz,
  findExpiredQuizzes,
  finishAttempt,
  joinQuiz,
  listQuizzes,
  loadQuiz,
  quizProgress,
  resultsCsv,
  startQuiz,
  submitAnswer,
} from '../modules/meetings/quiz.service';
import {
  endMeeting,
  findById,
  recordEvent,
  settingsOf,
  settingsToColumns,
  type MeetingWithHost,
} from '../modules/meetings/meetings.service';
import { buildRoomState, toChatPayload } from './room-state';

interface SocketData {
  participantId: string;
  meetingId: string;
  identity: string;
}

type OrbitSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
type OrbitServer = Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
type OrbitNamespace = Namespace<ClientEvents, ServerEvents, Record<string, never>, SocketData>;

const meetingRoom = (meetingId: string) => `m:${meetingId}`;
const hostsRoom = (meetingId: string) => `h:${meetingId}`;
const participantRoom = (participantId: string) => `p:${participantId}`;

function ackOk<T>(ack: Ack<T> | undefined, data: T): void {
  ack?.({ ok: true, data });
}

function ackErr(ack: Ack<never> | Ack<unknown> | undefined, code: string, message: string): void {
  (ack as Ack<unknown> | undefined)?.({ ok: false, code, message });
}

/**
 * Removes control characters that would let a message break the transcript or
 * smuggle terminal escapes. Messages are stored and delivered as plain text;
 * the client renders them into a text node, never as HTML — that is what keeps
 * chat free of XSS, not a blocklist.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeText(input: string): string {
  return input
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, CHAT_MESSAGE_MAX_LENGTH);
}

export interface RealtimeGateway {
  io: OrbitServer;
  broadcastMeetingEnded: (meetingId: string, byName: string, endedAt: string) => void;
  connectedParticipants: () => number;
  activeMeetings: () => Promise<number>;
  close: () => Promise<void>;
}

export async function createRealtime(httpServer: HttpServer): Promise<RealtimeGateway> {
  const io: OrbitServer = new Server(httpServer, {
    path: '/realtime',
    serveClient: false,
    cors: {
      /**
       * Mirrors the HTTP CORS policy: configured origins always, plus
       * private-network origins in development so the app can be opened from a
       * phone on the same Wi-Fi without editing configuration.
       */
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        if (!isProd && isPrivateOrigin(origin)) return callback(null, true);
        callback(new Error('Origin not allowed'), false);
      },
      credentials: true,
    },
    // Generous timeouts: a phone switching from Wi-Fi to cellular should
    // reconnect into the same session rather than be declared gone.
    pingInterval: 20_000,
    pingTimeout: 25_000,
    connectionStateRecovery: {
      maxDisconnectionDuration: RECONNECT_GRACE_MS,
      skipMiddlewares: false,
    },
  });

  // Horizontal scale: every API instance sees every room event.
  // Pub/sub connections must never drop a subscription mid-reconnect, so they
  // are the one place unlimited command retries are correct.
  const pubClient = createRedis('socket-pub', { pubsub: true });
  const subClient = createRedis('socket-sub', { pubsub: true });
  io.adapter(createAdapter(pubClient, subClient));

  const nsp: OrbitNamespace = io.of(RT_NAMESPACE);

  /** Timers for participants who dropped and may still come back. */
  const leaveTimers = new Map<string, NodeJS.Timeout>();
  /** Timers for absent hosts, before host rights are transferred. */
  const hostTimers = new Map<string, NodeJS.Timeout>();

  // ---------------------------------------------------------------- helpers

  async function loadContext(socket: OrbitSocket): Promise<{
    participant: MeetingParticipant;
    meeting: MeetingWithHost;
  } | null> {
    const { participantId, meetingId } = socket.data;
    const [participant, meeting] = await Promise.all([
      prisma.meetingParticipant.findUnique({ where: { id: participantId } }),
      findById(meetingId),
    ]);
    if (!participant || !meeting) return null;
    return { participant, meeting };
  }

  /**
   * Re-reads the caller's role from the database for every privileged action.
   * Roles are never taken from the socket handshake or the client payload, so a
   * demoted co-host loses their powers immediately rather than at reconnect.
   */
  async function requireHost(socket: OrbitSocket): Promise<{
    participant: MeetingParticipant;
    meeting: MeetingWithHost;
  } | null> {
    const ctx = await loadContext(socket);
    if (!ctx) return null;
    const role = ctx.participant.role as ParticipantRole;
    if (role !== 'HOST' && role !== 'COHOST') return null;
    return ctx;
  }

  function emitToParticipant<E extends keyof ServerEvents>(
    participantId: string,
    event: E,
    ...args: Parameters<ServerEvents[E]>
  ): void {
    nsp.to(participantRoom(participantId)).emit(event, ...args);
  }

  /**
   * Sends a poll to everyone, shaped per recipient.
   *
   * A single broadcast will not do: hosts may see the running tally while
   * participants may not, and each person needs their own selections marked.
   * Hiding a tally client-side would be theatre — the number would still be
   * sitting in the frame.
   */
  async function broadcastPoll(
    pollId: string,
    event: 'poll:opened' | 'poll:updated' | 'poll:closed',
  ): Promise<void> {
    const poll = await loadPoll(pollId);
    if (!poll) return;

    const participants = await prisma.meetingParticipant.findMany({
      where: { meetingId: poll.meetingId, status: 'ADMITTED' },
      select: { id: true, role: true },
    });

    for (const person of participants) {
      const isHost = person.role === 'HOST' || person.role === 'COHOST';
      emitToParticipant(person.id, event, toPollPayload(poll, { participantId: person.id, isHost }));
    }
  }

  /** Lobby countdown before the first question, so starts feel simultaneous. */
  const QUIZ_LOBBY_MS = 3000;

  /** Pending auto-end timers, keyed by quiz id. */
  const quizTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Sends a quiz to everyone, shaped per recipient.
   *
   * Each participant needs their own question order, their own saved answers,
   * and — crucially — a payload with no answer key in it. One broadcast cannot
   * satisfy that, so the view is built per person.
   */
  async function broadcastQuiz(
    quizId: string,
    event: 'quiz:started' | 'quiz:updated',
  ): Promise<void> {
    const quiz = await loadQuiz(quizId);
    if (!quiz) return;

    const participants = await prisma.meetingParticipant.findMany({
      where: { meetingId: quiz.meetingId, status: 'ADMITTED' },
      select: { id: true, role: true },
    });

    for (const person of participants) {
      const isHost = person.role === 'HOST' || person.role === 'COHOST';
      const view = await buildLiveView(quiz, { participantId: person.id, isHost });
      emitToParticipant(person.id, event, view);
    }
  }

  /** Host-only progress: how many joined, how many submitted. */
  async function publishQuizProgress(quizId: string): Promise<void> {
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { meetingId: true } });
    if (!quiz) return;
    nsp.to(hostsRoom(quiz.meetingId)).emit('quiz:progress', await quizProgress(quizId));
  }

  /**
   * Ends a quiz, grades every outstanding attempt, and publishes results.
   *
   * Results are built per viewer because the host's visibility setting decides
   * whether a participant receives the leaderboard, only their own row, or
   * nothing at all.
   */
  async function finishQuizAndPublish(quizId: string): Promise<void> {
    clearTimeout(quizTimers.get(quizId));
    quizTimers.delete(quizId);

    const ended = await endQuiz(quizId);
    if (!ended) return;

    nsp.to(meetingRoom(ended.meetingId)).emit('quiz:ended', { quizId });

    const participants = await prisma.meetingParticipant.findMany({
      where: { meetingId: ended.meetingId, status: 'ADMITTED' },
      select: { id: true, role: true },
    });

    for (const person of participants) {
      const isHost = person.role === 'HOST' || person.role === 'COHOST';
      if (ended.resultVisibility === 'HOST_ONLY' && !isHost) continue;

      const results = await buildResults(quizId, { participantId: person.id, isHost });
      if (results) emitToParticipant(person.id, 'quiz:results', results);
    }

    logger.info({ quizId, meetingId: ended.meetingId }, 'quiz ended and graded');
  }

  /**
   * Arms the server-side deadline.
   *
   * The quiz must end on time even if every participant has closed their
   * laptop, so the authority is a timer here rather than a countdown in a
   * browser. A missed timer — a restart, say — is caught by the periodic sweep
   * below.
   */
  function scheduleQuizExpiry(quizId: string, endsAt: Date | null): void {
    clearTimeout(quizTimers.get(quizId));
    if (!endsAt) return;

    const delay = Math.max(0, endsAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      void finishQuizAndPublish(quizId);
    }, delay);
    timer.unref();
    quizTimers.set(quizId, timer);
  }

  /**
   * Safety net for quizzes whose in-process timer was lost — after a restart,
   * or when the timer was armed on a different API instance.
   */
  const quizSweep = setInterval(() => {
    void (async () => {
      for (const quiz of await findExpiredQuizzes().catch(() => [])) {
        if (!quizTimers.has(quiz.id)) await finishQuizAndPublish(quiz.id);
      }
    })();
  }, 15_000);
  quizSweep.unref();

  async function refreshWaitingList(meeting: MeetingWithHost): Promise<void> {
    const rows = await prisma.meetingParticipant.findMany({
      where: { meetingId: meeting.id, status: 'WAITING' },
      orderBy: { createdAt: 'asc' },
    });
    nsp.to(hostsRoom(meeting.id)).emit('waiting:updated', {
      waiting: rows.map((p) => ({
        participantId: p.id,
        identity: p.identity,
        name: p.displayName,
        avatarUrl: p.avatarUrl,
        userId: p.userId,
        requestedAt: p.createdAt.toISOString(),
      })),
    });
  }

  /**
   * Host absence handling.
   *
   * A host losing their connection must not end the meeting. After a grace
   * period without the host, the longest-standing co-host — or failing that the
   * earliest participant — is promoted so the room is never left unmoderated.
   */
  function scheduleHostTransfer(meetingId: string): void {
    clearTimeout(hostTimers.get(meetingId));
    const timer = setTimeout(() => {
      void (async () => {
        hostTimers.delete(meetingId);
        try {
          const meeting = await findById(meetingId);
          if (!meeting || meeting.status === 'ENDED') return;

          const hostPresent = await prisma.meetingParticipant.findFirst({
            where: { meetingId, role: 'HOST', connected: true, status: 'ADMITTED' },
          });
          if (hostPresent) return;

          const successor = await prisma.meetingParticipant.findFirst({
            where: { meetingId, status: 'ADMITTED', connected: true, role: { not: 'HOST' } },
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }], // COHOST sorts before PARTICIPANT
          });
          if (!successor) return;

          await prisma.meetingParticipant.update({ where: { id: successor.id }, data: { role: 'HOST' } });
          await updateParticipantMetadata(
            meeting.code,
            successor.identity,
            {
              role: 'HOST',
              participantId: successor.id,
              userId: successor.userId,
              avatarUrl: successor.avatarUrl,
              isGuest: successor.isGuest,
            },
            settingsOf(meeting),
          );

          const sockets = await nsp.in(participantRoom(successor.id)).fetchSockets();
          for (const s of sockets) s.join(hostsRoom(meetingId));

          nsp.to(meetingRoom(meetingId)).emit('participant:role', {
            identity: successor.identity,
            role: 'HOST',
          });
          nsp.to(meetingRoom(meetingId)).emit('host:transferred', {
            identity: successor.identity,
            name: successor.displayName,
          });
          await recordEvent(meetingId, successor.userId, successor.identity, 'host.transferred', {
            reason: 'host_absent',
          });
          await refreshWaitingList(meeting);
          logger.info({ meetingId, to: successor.identity }, 'host transferred after absence');
        } catch (error) {
          logger.error({ err: error, meetingId }, 'host transfer failed');
        }
      })();
    }, HOST_DISCONNECT_GRACE_MS);

    hostTimers.set(meetingId, timer);
  }

  // ------------------------------------------------------------ auth middleware

  nsp.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.sessionToken ?? socket.handshake.query?.sessionToken) as
        | string
        | undefined;
      if (!token) return next(new Error(ERROR_CODES.UNAUTHORIZED));

      const claims = await verifySessionToken(token);

      const participant = await prisma.meetingParticipant.findUnique({ where: { id: claims.sub } });
      if (!participant || participant.meetingId !== claims.meetingId) {
        return next(new Error(ERROR_CODES.UNAUTHORIZED));
      }
      if (participant.status === 'REMOVED' || participant.status === 'REJECTED') {
        return next(new Error(ERROR_CODES.FORBIDDEN));
      }

      const meeting = await findById(claims.meetingId);
      if (!meeting) return next(new Error(ERROR_CODES.NOT_FOUND));
      if (meeting.status === 'ENDED' || meeting.status === 'CANCELLED') {
        return next(new Error(ERROR_CODES.MEETING_ENDED));
      }

      (socket as unknown as OrbitSocket).data = {
        participantId: participant.id,
        meetingId: meeting.id,
        identity: participant.identity,
      };
      next();
    } catch (error) {
      logger.debug({ err: error }, 'realtime handshake rejected');
      next(new Error(ERROR_CODES.UNAUTHORIZED));
    }
  });

  // ---------------------------------------------------------------- connection

  nsp.on('connection', (socket: OrbitSocket) => {
    void (async () => {
      const ctx = await loadContext(socket);
      if (!ctx) {
        socket.emit('room:error', { code: ERROR_CODES.NOT_FOUND, message: 'This meeting is no longer available.' });
        socket.disconnect(true);
        return;
      }

      const { participant, meeting } = ctx;
      const { meetingId, participantId, identity } = socket.data;

      /**
       * One live socket per participant. A refresh or a flaky network can leave
       * a stale socket behind; closing it here is what stops the same person
       * appearing twice in the roster.
       */
      const existing = await nsp.in(participantRoom(participantId)).fetchSockets();
      for (const stale of existing) {
        if (stale.id !== socket.id) {
          stale.emit('notice', { kind: 'info', message: 'This meeting was opened in another tab.' });
          stale.disconnect(true);
        }
      }

      socket.join(participantRoom(participantId));

      // A person still in the waiting room gets no room data at all — only the
      // channel on which admission will arrive.
      if (participant.status === 'WAITING') {
        await refreshWaitingList(meeting);
        socket.on('disconnect', () => {
          void refreshWaitingList(meeting).catch(() => undefined);
        });
        return;
      }

      // Cancel any pending "they left" announcement — they came back.
      const pending = leaveTimers.get(participantId);
      if (pending) {
        clearTimeout(pending);
        leaveTimers.delete(participantId);
      }

      socket.join(meetingRoom(meetingId));
      const role = participant.role as ParticipantRole;
      if (role === 'HOST' || role === 'COHOST') socket.join(hostsRoom(meetingId));
      if (role === 'HOST') {
        clearTimeout(hostTimers.get(meetingId));
        hostTimers.delete(meetingId);
      }

      const wasConnected = participant.connected;
      const updated = await prisma.meetingParticipant.update({
        where: { id: participantId },
        data: { connected: true, lastSeenAt: new Date(), status: 'ADMITTED', leftAt: null },
      });

      await redis.sadd(KEYS.presence(meetingId), identity).catch(() => undefined);
      await redis.sadd(KEYS.liveMeetings, meetingId).catch(() => undefined);

      const state = await buildRoomState(meeting, participantId);
      if (state) socket.emit('room:state', state);

      // Announce only genuinely new arrivals; a reconnect just flips the dot.
      if (!wasConnected) {
        socket.to(meetingRoom(meetingId)).emit('participant:joined', toRoomParticipant(updated));
      } else {
        socket.to(meetingRoom(meetingId)).emit('participant:updated', { identity, connected: true });
      }

      if (role === 'HOST' || role === 'COHOST') await refreshWaitingList(meeting);

      // ------------------------------------------------------ media + presence

      socket.on('media:update', async (payload, ack) => {
        const current = await loadContext(socket);
        if (!current) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'Meeting unavailable.');

        const data: Partial<MeetingParticipant> = {};
        if (typeof payload.micEnabled === 'boolean') data.micEnabled = payload.micEnabled;
        if (typeof payload.cameraEnabled === 'boolean') data.cameraEnabled = payload.cameraEnabled;

        if (typeof payload.screenSharing === 'boolean') {
          const settings = settingsOf(current.meeting);
          const r = current.participant.role as ParticipantRole;
          const mayShare = settings.screenShareMode === 'EVERYONE' || r === 'HOST' || r === 'COHOST';
          if (payload.screenSharing && !mayShare) {
            return ackErr(ack, ERROR_CODES.SHARE_NOT_ALLOWED, 'The host has limited screen sharing.');
          }
          data.screenSharing = payload.screenSharing;
        }

        await prisma.meetingParticipant.update({
          where: { id: participantId },
          data: { ...data, lastSeenAt: new Date() },
        });

        nsp.to(meetingRoom(meetingId)).emit('media:state', { identity, ...payload });
        ackOk(ack, undefined as never);
      });

      socket.on('hand:set', async (payload, ack) => {
        const handRaisedAt = payload.raised ? new Date() : null;
        await prisma.meetingParticipant.update({ where: { id: participantId }, data: { handRaisedAt } });
        nsp.to(meetingRoom(meetingId)).emit('hand:updated', {
          identity,
          name: participant.displayName,
          handRaisedAt: handRaisedAt ? handRaisedAt.toISOString() : null,
        });
        ackOk(ack, undefined as never);
      });

      socket.on('reaction:send', async (payload, ack) => {
        const key = String(payload?.reaction ?? '');
        if (!REACTIONS.includes(key as never)) {
          return ackErr(ack, ERROR_CODES.VALIDATION, 'Unknown reaction.');
        }
        // Reactions are cheap to send and easy to abuse; cap the rate.
        const count = await bumpCounter('reaction', participantId, 10);
        if (count > 8) return ackErr(ack, ERROR_CODES.RATE_LIMITED, 'Slow down a moment.');

        nsp.to(meetingRoom(meetingId)).emit('reaction', {
          identity,
          name: participant.displayName,
          reaction: key as never,
          at: new Date().toISOString(),
        });
        ackOk(ack, undefined as never);
      });

      // ----------------------------------------------------------------- chat

      socket.on('chat:send', async (payload, ack) => {
        const current = await loadContext(socket);
        if (!current) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'Meeting unavailable.');
        if (!current.meeting.chatEnabled) {
          return ackErr(ack, ERROR_CODES.CHAT_DISABLED, 'The host has turned chat off.');
        }

        const parsed = chatMessageSchema.safeParse(payload);
        if (!parsed.success) {
          return ackErr(ack, ERROR_CODES.VALIDATION, parsed.error.issues[0]?.message ?? 'Invalid message.');
        }

        const body = sanitizeText(parsed.data.body);
        if (!body) return ackErr(ack, ERROR_CODES.VALIDATION, 'Message is empty.');

        const burst = await bumpCounter('chat', participantId, 10);
        if (burst > 15) return ackErr(ack, ERROR_CODES.RATE_LIMITED, 'You are sending messages too quickly.');

        const row = await prisma.chatMessage.create({
          data: {
            meetingId,
            senderId: current.participant.userId,
            senderIdentity: identity,
            senderName: current.participant.displayName,
            body,
          },
        });

        const message = toChatPayload(row);
        nsp.to(meetingRoom(meetingId)).emit('chat:message', message);
        ackOk(ack, message);
      });

      // ---------------------------------------------------------- host actions

      socket.on('host:mute', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const target = await prisma.meetingParticipant.findUnique({
          where: { meetingId_identity: { meetingId, identity: payload.identity } },
        });
        if (!target) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person has already left.');

        await muteParticipantTracks(host.meeting.code, target.identity, payload.kind);
        await prisma.meetingParticipant.update({
          where: { id: target.id },
          data: payload.kind === 'audio' ? { micEnabled: false } : { cameraEnabled: false },
        });

        emitToParticipant(target.id, 'media:force-mute', {
          by: host.participant.displayName,
          kind: payload.kind,
        });
        nsp.to(meetingRoom(meetingId)).emit('media:state', {
          identity: target.identity,
          ...(payload.kind === 'audio' ? { micEnabled: false } : { cameraEnabled: false }),
        });
        await recordEvent(meetingId, host.participant.userId, identity, 'host.mute', {
          target: target.identity,
          kind: payload.kind,
        });
        ackOk(ack, undefined as never);
      });

      socket.on('host:mute-all', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const targets = await prisma.meetingParticipant.findMany({
          where: {
            meetingId,
            status: 'ADMITTED',
            micEnabled: true,
            id: { not: host.participant.id },
            ...(payload?.includeHosts ? {} : { role: 'PARTICIPANT' }),
          },
        });

        await Promise.all(
          targets.map(async (t) => {
            await muteParticipantTracks(host.meeting.code, t.identity, 'audio');
            emitToParticipant(t.id, 'media:force-mute', { by: host.participant.displayName, kind: 'audio' });
          }),
        );

        await prisma.meetingParticipant.updateMany({
          where: { id: { in: targets.map((t) => t.id) } },
          data: { micEnabled: false },
        });

        for (const t of targets) {
          nsp.to(meetingRoom(meetingId)).emit('media:state', { identity: t.identity, micEnabled: false });
        }
        nsp.to(meetingRoom(meetingId)).emit('notice', {
          kind: 'info',
          message: `${host.participant.displayName} muted everyone.`,
        });
        await recordEvent(meetingId, host.participant.userId, identity, 'host.mute_all', {
          count: targets.length,
        });
        ackOk(ack, undefined as never);
      });

      socket.on('host:request-unmute', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');
        const target = await prisma.meetingParticipant.findUnique({
          where: { meetingId_identity: { meetingId, identity: payload.identity } },
        });
        if (!target) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person has already left.');

        // A request, never a command: only the participant can turn their own
        // microphone back on.
        emitToParticipant(target.id, 'media:unmute-request', { by: host.participant.displayName });
        ackOk(ack, undefined as never);
      });

      socket.on('host:stop-share', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const target = await prisma.meetingParticipant.findUnique({
          where: { meetingId_identity: { meetingId, identity: payload.identity } },
        });
        if (!target) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person has already left.');

        await stopParticipantScreenShare(host.meeting.code, target.identity);
        await prisma.meetingParticipant.update({ where: { id: target.id }, data: { screenSharing: false } });
        nsp.to(meetingRoom(meetingId)).emit('media:state', { identity: target.identity, screenSharing: false });
        emitToParticipant(target.id, 'notice', {
          kind: 'warn',
          message: `${host.participant.displayName} stopped your presentation.`,
        });
        ackOk(ack, undefined as never);
      });

      socket.on('host:remove', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const target = await prisma.meetingParticipant.findUnique({
          where: { meetingId_identity: { meetingId, identity: payload.identity } },
        });
        if (!target) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person has already left.');
        if (target.role === 'HOST') {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'The meeting host cannot be removed.');
        }

        await prisma.meetingParticipant.update({
          where: { id: target.id },
          data: { status: 'REMOVED', connected: false, leftAt: new Date() },
        });
        await removeFromSfu(host.meeting.code, target.identity);

        emitToParticipant(target.id, 'you:removed', { by: host.participant.displayName });
        nsp.to(meetingRoom(meetingId)).emit('participant:left', {
          identity: target.identity,
          name: target.displayName,
          reason: 'REMOVED',
        });

        const sockets = await nsp.in(participantRoom(target.id)).fetchSockets();
        for (const s of sockets) s.disconnect(true);

        await recordEvent(meetingId, host.participant.userId, identity, 'host.remove', {
          target: target.identity,
        });
        ackOk(ack, undefined as never);
      });

      socket.on('host:set-role', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');
        // Only the meeting owner may hand out or revoke co-host.
        if (host.participant.role !== 'HOST') {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only the meeting host can change roles.');
        }
        if (payload.role === 'HOST') {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Transferring ownership is not supported here.');
        }

        const target = await prisma.meetingParticipant.findUnique({
          where: { meetingId_identity: { meetingId, identity: payload.identity } },
        });
        if (!target || target.role === 'HOST') {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person cannot be changed.');
        }

        const updatedTarget = await prisma.meetingParticipant.update({
          where: { id: target.id },
          data: { role: payload.role },
        });

        await updateParticipantMetadata(
          host.meeting.code,
          target.identity,
          {
            role: payload.role,
            participantId: target.id,
            userId: target.userId,
            avatarUrl: target.avatarUrl,
            isGuest: target.isGuest,
          },
          settingsOf(host.meeting),
        );

        const sockets = await nsp.in(participantRoom(target.id)).fetchSockets();
        for (const s of sockets) {
          if (payload.role === 'COHOST') s.join(hostsRoom(meetingId));
          else s.leave(hostsRoom(meetingId));
        }

        nsp.to(meetingRoom(meetingId)).emit('participant:role', {
          identity: target.identity,
          role: payload.role,
        });
        emitToParticipant(target.id, 'notice', {
          kind: 'info',
          message:
            payload.role === 'COHOST'
              ? 'You are now a co-host.'
              : 'You are no longer a co-host.',
        });
        if (payload.role === 'COHOST') await refreshWaitingList(host.meeting);

        await recordEvent(meetingId, host.participant.userId, identity, 'host.set_role', {
          target: target.identity,
          role: updatedTarget.role,
        });
        ackOk(ack, undefined as never);
      });

      socket.on('host:lower-hand', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');
        const target = await prisma.meetingParticipant.findUnique({
          where: { meetingId_identity: { meetingId, identity: payload.identity } },
        });
        if (!target) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person has already left.');

        await prisma.meetingParticipant.update({ where: { id: target.id }, data: { handRaisedAt: null } });
        nsp.to(meetingRoom(meetingId)).emit('hand:updated', {
          identity: target.identity,
          name: target.displayName,
          handRaisedAt: null,
        });
        ackOk(ack, undefined as never);
      });

      socket.on('host:lock', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        await prisma.meeting.update({ where: { id: meetingId }, data: { locked: Boolean(payload.locked) } });
        nsp.to(meetingRoom(meetingId)).emit('meeting:locked', {
          locked: Boolean(payload.locked),
          by: host.participant.displayName,
        });
        await recordEvent(meetingId, host.participant.userId, identity, 'meeting.lock', {
          locked: Boolean(payload.locked),
        });
        ackOk(ack, undefined as never);
      });

      socket.on('host:settings', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const parsed = meetingSettingsSchema.partial().safeParse(payload?.settings ?? {});
        if (!parsed.success) return ackErr(ack, ERROR_CODES.VALIDATION, 'Those settings are not valid.');

        const updated = await prisma.meeting.update({
          where: { id: meetingId },
          data: settingsToColumns(parsed.data),
          include: { host: { select: { id: true, name: true, avatarUrl: true } } },
        });

        const settings: MeetingSettings = settingsOf(updated);

        // Screen-share policy lives in the SFU grant, so refresh every
        // participant's permissions rather than only the UI.
        if (parsed.data.screenShareMode) {
          const everyone = await prisma.meetingParticipant.findMany({
            where: { meetingId, status: 'ADMITTED' },
          });
          await Promise.all(
            everyone.map((p) =>
              updateParticipantMetadata(
                updated.code,
                p.identity,
                {
                  role: p.role as ParticipantRole,
                  participantId: p.id,
                  userId: p.userId,
                  avatarUrl: p.avatarUrl,
                  isGuest: p.isGuest,
                },
                settings,
              ),
            ),
          );
        }

        nsp.to(meetingRoom(meetingId)).emit('meeting:settings', { settings, locked: updated.locked });
        await recordEvent(meetingId, host.participant.userId, identity, 'meeting.settings', parsed.data);
        ackOk(ack, undefined as never);
      });

      // ------------------------------------------------------- waiting room

      socket.on('host:admit', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const target = await prisma.meetingParticipant.findUnique({ where: { id: payload.participantId } });
        if (!target || target.meetingId !== meetingId || target.status !== 'WAITING') {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person is no longer waiting.');
        }

        await prisma.meetingParticipant.update({
          where: { id: target.id },
          data: { status: 'ADMITTED', joinedAt: new Date() },
        });
        emitToParticipant(target.id, 'waiting:admitted', { participantId: target.id });
        await refreshWaitingList(host.meeting);
        await recordEvent(meetingId, host.participant.userId, identity, 'host.admit', {
          target: target.identity,
        });
        ackOk(ack, undefined as never);
      });

      socket.on('host:admit-all', async (_payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const waiting = await prisma.meetingParticipant.findMany({
          where: { meetingId, status: 'WAITING' },
        });
        await prisma.meetingParticipant.updateMany({
          where: { meetingId, status: 'WAITING' },
          data: { status: 'ADMITTED', joinedAt: new Date() },
        });
        for (const w of waiting) emitToParticipant(w.id, 'waiting:admitted', { participantId: w.id });
        await refreshWaitingList(host.meeting);
        ackOk(ack, undefined as never);
      });

      socket.on('host:reject', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const target = await prisma.meetingParticipant.findUnique({ where: { id: payload.participantId } });
        if (!target || target.meetingId !== meetingId) {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person is no longer waiting.');
        }

        await prisma.meetingParticipant.update({ where: { id: target.id }, data: { status: 'REJECTED' } });
        emitToParticipant(target.id, 'waiting:rejected', {
          participantId: target.id,
          reason: 'The host declined your request to join.',
        });
        const sockets = await nsp.in(participantRoom(target.id)).fetchSockets();
        for (const s of sockets) s.disconnect(true);
        await refreshWaitingList(host.meeting);
        ackOk(ack, undefined as never);
      });

      // ------------------------------------------------------------ recording

      socket.on('host:recording', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');
        if (!host.meeting.recordingEnabled) {
          return ackErr(ack, ERROR_CODES.RECORDING_UNAVAILABLE, 'Recording is turned off for this meeting.');
        }

        try {
          if (payload.action === 'start') {
            const existingRec = await prisma.recording.findFirst({
              where: { meetingId, status: { in: ['STARTING', 'ACTIVE'] } },
            });
            if (existingRec) return ackErr(ack, 'ALREADY_RECORDING', 'A recording is already running.');

            const { egressId, fileLocation } = await startRoomRecording({
              meetingCode: host.meeting.code,
              meetingId,
            });
            const rec = await prisma.recording.create({
              data: {
                meetingId,
                egressId,
                fileLocation,
                status: 'ACTIVE',
                startedById: host.participant.userId,
              },
            });

            // Everyone is told, always. Recording is never silent.
            nsp.to(meetingRoom(meetingId)).emit('meeting:recording', {
              active: true,
              recordingId: rec.id,
              startedAt: rec.startedAt.toISOString(),
              by: host.participant.displayName,
            });
            await recordEvent(meetingId, host.participant.userId, identity, 'recording.started', {});
          } else {
            const rec = await prisma.recording.findFirst({
              where: { meetingId, status: { in: ['STARTING', 'ACTIVE'] } },
              orderBy: { startedAt: 'desc' },
            });
            if (!rec) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'No recording is running.');

            if (rec.egressId) await stopRoomRecording(rec.egressId);
            const endedAt = new Date();
            await prisma.recording.update({
              where: { id: rec.id },
              data: {
                status: 'COMPLETED',
                endedAt,
                durationSec: Math.round((endedAt.getTime() - rec.startedAt.getTime()) / 1000),
              },
            });

            nsp.to(meetingRoom(meetingId)).emit('meeting:recording', {
              active: false,
              recordingId: rec.id,
              startedAt: rec.startedAt.toISOString(),
              by: host.participant.displayName,
            });
            await recordEvent(meetingId, host.participant.userId, identity, 'recording.stopped', {});
          }
          ackOk(ack, undefined as never);
        } catch (error) {
          const message =
            error instanceof Error && 'exposeMessage' in error
              ? error.message
              : 'The recording service is unavailable.';
          logger.error({ err: error, meetingId }, 'recording action failed');
          ackErr(ack, ERROR_CODES.RECORDING_UNAVAILABLE, message);
        }
      });

      // ---------------------------------------------------------- end meeting

      socket.on('host:end-meeting', async (_payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const ended = await endMeeting(meetingId, {
          userId: host.participant.userId,
          identity,
          name: host.participant.displayName,
        });

        nsp.to(meetingRoom(meetingId)).emit('meeting:ended', {
          by: host.participant.displayName,
          endedAt: (ended.endedAt ?? new Date()).toISOString(),
        });
        await redis.srem(KEYS.liveMeetings, meetingId).catch(() => undefined);
        await deleteRoom(ended.code);
        ackOk(ack, undefined as never);
      });

      // ------------------------------------------------------- spotlight

      socket.on('host:spotlight', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const parsed = spotlightSchema.safeParse(payload);
        if (!parsed.success) return ackErr(ack, ERROR_CODES.VALIDATION, 'Invalid request.');

        const target = await prisma.meetingParticipant.findUnique({
          where: { meetingId_identity: { meetingId, identity: parsed.data.identity } },
        });
        if (!target) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person has already left.');

        const current = new Set(host.meeting.spotlightIdentities);
        if (parsed.data.on) current.add(parsed.data.identity);
        else current.delete(parsed.data.identity);

        const identities = [...current];
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { spotlightIdentities: identities },
        });

        nsp.to(meetingRoom(meetingId)).emit('spotlight:updated', {
          identities,
          by: host.participant.displayName,
        });
        await recordEvent(meetingId, host.participant.userId, host.participant.identity, 'SPOTLIGHT_CHANGED', {
          identities,
        });
        ackOk(ack, undefined as never);
      });

      // ---------------------------------------------------- announcements

      socket.on('host:announce', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const parsed = announcementSchema.safeParse(payload);
        if (!parsed.success) {
          return ackErr(ack, ERROR_CODES.VALIDATION, parsed.error.issues[0]?.message ?? 'Invalid announcement.');
        }

        // Announcements are shown to everyone, so they get the same control
        // character stripping as chat. They are rendered as text, never HTML.
        const body = sanitizeText(parsed.data.body);
        if (!body) return ackErr(ack, ERROR_CODES.VALIDATION, 'Write something to announce.');

        const hostUserId = host.participant.userId;
        if (!hostUserId) {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only a signed-in host can post an announcement.');
        }

        // Only the newest announcement is displayed; retire the previous one
        // so a stale banner cannot linger behind the new one.
        await prisma.meetingAnnouncement.updateMany({
          where: { meetingId, dismissedAt: null },
          data: { dismissedAt: new Date() },
        });

        const row = await prisma.meetingAnnouncement.create({
          data: { meetingId, body, createdById: hostUserId },
        });

        const announcement = {
          id: row.id,
          body: row.body,
          byName: host.participant.displayName,
          createdAt: row.createdAt.toISOString(),
        };

        nsp.to(meetingRoom(meetingId)).emit('announcement:posted', announcement);
        ackOk(ack, announcement);
      });

      socket.on('host:announce-clear', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        await prisma.meetingAnnouncement.updateMany({
          where: { id: payload.id, meetingId, dismissedAt: null },
          data: { dismissedAt: new Date() },
        });

        nsp.to(meetingRoom(meetingId)).emit('announcement:cleared', { id: payload.id });
        ackOk(ack, undefined as never);
      });

      // -------------------------------------------------------- blocklist

      socket.on('host:block', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const parsed = blockSchema.safeParse(payload);
        if (!parsed.success) return ackErr(ack, ERROR_CODES.VALIDATION, 'Invalid request.');

        const target = await prisma.meetingParticipant.findUnique({
          where: { meetingId_identity: { meetingId, identity: parsed.data.identity } },
        });
        if (!target) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That person has already left.');

        // The meeting owner is not blockable, and a co-host cannot block the
        // person who appointed them. Hierarchy is enforced here, not in the UI.
        if (target.role === 'HOST') {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'The meeting host cannot be blocked.');
        }
        if (host.participant.role === 'COHOST' && target.role === 'COHOST') {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only the host can block a co-host.');
        }
        if (target.id === host.participant.id) {
          return ackErr(ack, ERROR_CODES.VALIDATION, 'You cannot block yourself.');
        }

        const hostUserId = host.participant.userId;
        if (!hostUserId) {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only a signed-in host can block someone.');
        }

        await blockParticipant({
          meetingId,
          participant: target,
          blockedById: hostUserId,
          reason: parsed.data.reason,
        });

        // Tell them why before the connection goes, then remove them from the
        // SFU so media stops even if the socket lingers.
        emitToParticipant(target.id, 'you:blocked', {
          by: host.participant.displayName,
          reason: parsed.data.reason ?? null,
        });

        await prisma.meetingParticipant.update({
          where: { id: target.id },
          data: { status: 'REMOVED', connected: false, leftAt: new Date() },
        });
        await removeFromSfu(host.meeting.code, target.identity).catch(() => undefined);

        nsp.to(meetingRoom(meetingId)).emit('participant:left', {
          identity: target.identity,
          name: target.displayName,
          reason: 'REMOVED',
        });

        const entries = await listBlocklist(meetingId);
        nsp.to(hostsRoom(meetingId)).emit('blocklist:updated', { entries });

        await recordEvent(meetingId, host.participant.userId, host.participant.identity, 'PARTICIPANT_BLOCKED', {
          target: target.identity,
        });
        logger.info(
          { meetingId, by: host.participant.identity, target: target.identity },
          'participant blocked',
        );
        ackOk(ack, undefined as never);
      });

      socket.on('host:unblock', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const removed = await unblock(meetingId, payload.entryId);
        if (!removed) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That entry is already gone.');

        const entries = await listBlocklist(meetingId);
        nsp.to(hostsRoom(meetingId)).emit('blocklist:updated', { entries });
        ackOk(ack, undefined as never);
      });

      socket.on('host:blocklist', async (_payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');
        ackOk(ack, await listBlocklist(meetingId));
      });

      // ------------------------------------------------------------ polls

      socket.on('host:poll-create', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const parsed = pollCreateSchema.safeParse(payload);
        if (!parsed.success) {
          return ackErr(ack, ERROR_CODES.VALIDATION, parsed.error.issues[0]?.message ?? 'Invalid poll.');
        }

        const hostUserId = host.participant.userId;
        if (!hostUserId) {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only a signed-in host can start a poll.');
        }

        const poll = await createPoll({
          meetingId,
          createdById: hostUserId,
          question: sanitizeText(parsed.data.question),
          options: parsed.data.options.map((option: string) => sanitizeText(option)),
          multiSelect: parsed.data.multiSelect,
          anonymous: parsed.data.anonymous,
          hideResultsUntilClosed: parsed.data.hideResultsUntilClosed,
        });
        if (!poll) return ackErr(ack, ERROR_CODES.INTERNAL, 'The poll could not be created.');

        // Each side gets its own view: hosts see the tally, participants do not
        // until the poll closes.
        await broadcastPoll(poll.id, 'poll:opened');
        ackOk(ack, toPollPayload(poll, { participantId: host.participant.id, isHost: true }));
      });

      socket.on('host:poll-close', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const existing = await loadPoll(payload.pollId);
        if (!existing || existing.meetingId !== meetingId) {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That poll no longer exists.');
        }

        const closed = await closePoll(payload.pollId);
        if (!closed) return ackErr(ack, ERROR_CODES.INTERNAL, 'The poll could not be closed.');

        await broadcastPoll(closed.id, 'poll:closed');
        ackOk(ack, toPollPayload(closed, { participantId: host.participant.id, isHost: true }));
      });

      socket.on('poll:vote', async (payload, ack) => {
        const ctx = await loadContext(socket);
        if (!ctx) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'You are no longer in this meeting.');

        const parsed = pollVoteSchema.safeParse(payload);
        if (!parsed.success) return ackErr(ack, ERROR_CODES.VALIDATION, 'Invalid vote.');

        // Voting is rate limited like chat: a poll is a small target for a
        // flood, and every vote is a write.
        const votes = await bumpCounter('poll-vote', ctx.participant.id, 60);
        if (votes > 40) return ackErr(ack, ERROR_CODES.RATE_LIMITED, 'Slow down a moment.');

        const existing = await loadPoll(parsed.data.pollId);
        if (!existing || existing.meetingId !== meetingId) {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That poll no longer exists.');
        }

        const result = await castVote({
          pollId: parsed.data.pollId,
          participantId: ctx.participant.id,
          optionIds: parsed.data.optionIds,
        });

        if (!result.ok) {
          const message =
            result.code === 'CLOSED'
              ? 'That poll has closed.'
              : result.code === 'TOO_MANY'
                ? 'This poll allows one answer.'
                : 'That option is not part of this poll.';
          return ackErr(ack, ERROR_CODES.VALIDATION, message);
        }

        const updated = await loadPoll(parsed.data.pollId);
        if (!updated) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That poll no longer exists.');

        await broadcastPoll(updated.id, 'poll:updated');
        ackOk(
          ack,
          toPollPayload(updated, {
            participantId: ctx.participant.id,
            isHost: ctx.participant.role === 'HOST' || ctx.participant.role === 'COHOST',
          }),
        );
      });

      // ------------------------------------------------------------- quiz

      socket.on('host:quiz-create', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can create a quiz.');

        const parsed = quizCreateSchema.safeParse(payload);
        if (!parsed.success) {
          return ackErr(ack, ERROR_CODES.VALIDATION, parsed.error.issues[0]?.message ?? 'Invalid quiz.');
        }

        // Every question must have a usable answer key, or grading is a lie.
        for (const [index, question] of parsed.data.questions.entries()) {
          const correct = question.options.filter((option) => option.isCorrect).length;
          if (correct === 0) {
            return ackErr(ack, ERROR_CODES.VALIDATION, `Question ${index + 1} has no correct answer.`);
          }
          if (question.kind !== 'MULTI' && correct > 1) {
            return ackErr(
              ack,
              ERROR_CODES.VALIDATION,
              `Question ${index + 1} is single-choice but marks several answers correct.`,
            );
          }
        }

        const hostUserId = host.participant.userId;
        if (!hostUserId) {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only a signed-in host can create a quiz.');
        }

        const quiz = await createQuiz({
          meetingId,
          createdById: hostUserId,
          title: sanitizeText(parsed.data.title),
          settings: parsed.data.settings,
          questions: parsed.data.questions.map((question) => ({
            ...question,
            prompt: sanitizeText(question.prompt),
            explanation: question.explanation ? sanitizeText(question.explanation) : null,
            options: question.options.map((option) => ({
              label: sanitizeText(option.label),
              isCorrect: option.isCorrect,
            })),
          })),
        });

        if (!quiz) return ackErr(ack, ERROR_CODES.INTERNAL, 'The quiz could not be created.');
        ackOk(ack, { quizId: quiz.id });
      });

      socket.on('host:quiz-start', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can start a quiz.');

        const existing = await loadQuiz(payload.quizId);
        if (!existing || existing.meetingId !== meetingId) {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That quiz no longer exists.');
        }
        if (existing.status !== 'DRAFT') {
          return ackErr(ack, ERROR_CODES.VALIDATION, 'That quiz has already run.');
        }

        // A short lobby countdown, so everybody's first question appears at
        // roughly the same moment rather than whenever their socket woke up.
        nsp.to(meetingRoom(meetingId)).emit('quiz:starting', {
          quizId: existing.id,
          title: existing.title,
          questionCount: existing.questions.length,
          startsInMs: QUIZ_LOBBY_MS,
        });

        setTimeout(() => {
          void (async () => {
            const started = await startQuiz(payload.quizId);
            if (!started) return;
            await broadcastQuiz(started.id, 'quiz:started');
            scheduleQuizExpiry(started.id, started.endsAt);
          })();
        }, QUIZ_LOBBY_MS);

        const view = await buildLiveView(existing, {
          participantId: host.participant.id,
          isHost: true,
        });
        ackOk(ack, view);
      });

      socket.on('host:quiz-next', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const result = await advanceQuestion(payload.quizId);
        if (!result) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That quiz is not running.');

        if (result.finished) {
          await finishQuizAndPublish(payload.quizId);
        } else {
          await broadcastQuiz(payload.quizId, 'quiz:updated');
        }
        ackOk(ack, undefined as never);
      });

      socket.on('host:quiz-extend', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const parsed = quizExtendSchema.safeParse(payload);
        if (!parsed.success) return ackErr(ack, ERROR_CODES.VALIDATION, 'Invalid request.');

        const extended = await extendQuiz(parsed.data.quizId, parsed.data.seconds);
        if (!extended) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That quiz is not running.');

        // One deadline, changed once, broadcast to everyone — nobody gets a
        // different amount of extra time.
        await broadcastQuiz(extended.id, 'quiz:updated');
        scheduleQuizExpiry(extended.id, extended.endsAt);
        ackOk(ack, undefined as never);
      });

      socket.on('host:quiz-end', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');

        const existing = await loadQuiz(payload.quizId);
        if (!existing || existing.meetingId !== meetingId) {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That quiz no longer exists.');
        }

        await finishQuizAndPublish(payload.quizId);
        ackOk(ack, undefined as never);
      });

      socket.on('host:quiz-list', async (_payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can do that.');
        ackOk(ack, await listQuizzes(meetingId));
      });

      socket.on('host:quiz-export', async (payload, ack) => {
        const host = await requireHost(socket);
        if (!host) return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Only hosts can export results.');

        const existing = await loadQuiz(payload.quizId);
        if (!existing || existing.meetingId !== meetingId) {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That quiz no longer exists.');
        }

        const csv = payload.detailed
          ? await detailedCsv(payload.quizId)
          : await resultsCsv(payload.quizId);

        const safeTitle = existing.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
        ackOk(ack, {
          filename: `${safeTitle || 'quiz'}-${payload.detailed ? 'detailed' : 'results'}.csv`,
          csv,
        });
      });

      // ---- participant side ----

      socket.on('quiz:join', async (payload, ack) => {
        const ctx = await loadContext(socket);
        if (!ctx) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'You are no longer in this meeting.');

        const quiz = await loadQuiz(payload.quizId);
        if (!quiz || quiz.meetingId !== meetingId) {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That quiz no longer exists.');
        }

        const joined = await joinQuiz({
          quizId: payload.quizId,
          participantId: ctx.participant.id,
          displayName: ctx.participant.displayName,
          avatarUrl: ctx.participant.avatarUrl,
        });

        if (!joined.ok) {
          return ackErr(
            ack,
            ERROR_CODES.VALIDATION,
            joined.code === 'LATE_JOIN_CLOSED'
              ? 'This quiz is closed to late entries.'
              : 'That quiz is not running.',
          );
        }

        const isHost = ctx.participant.role === 'HOST' || ctx.participant.role === 'COHOST';
        ackOk(ack, await buildLiveView(quiz, { participantId: ctx.participant.id, isHost }));
        await publishQuizProgress(payload.quizId);
      });

      socket.on('quiz:answer', async (payload, ack) => {
        const ctx = await loadContext(socket);
        if (!ctx) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'You are no longer in this meeting.');

        const parsed = quizAnswerSchema.safeParse(payload);
        if (!parsed.success) return ackErr(ack, ERROR_CODES.VALIDATION, 'Invalid answer.');

        // Answer submission is rate limited: a quiz is a small, hot target and
        // each answer is a write.
        const rate = await bumpCounter('quiz-answer', ctx.participant.id, 60);
        if (rate > 120) return ackErr(ack, ERROR_CODES.RATE_LIMITED, 'Slow down a moment.');

        const result = await submitAnswer({
          quizId: parsed.data.quizId,
          participantId: ctx.participant.id,
          questionId: parsed.data.questionId,
          optionIds: parsed.data.optionIds,
        });

        if (!result.ok) {
          const message =
            result.code === 'EXPIRED'
              ? 'Time is up for that question.'
              : result.code === 'ALREADY_SUBMITTED'
                ? 'You have already submitted this quiz.'
                : result.code === 'LOCKED'
                  ? 'Answers cannot be changed in this quiz.'
                  : result.code === 'NOT_OPEN'
                    ? 'That question is not open.'
                    : 'That answer could not be recorded.';
          return ackErr(ack, ERROR_CODES.VALIDATION, message);
        }

        ackOk(ack, undefined as never);
      });

      socket.on('quiz:submit', async (payload, ack) => {
        const ctx = await loadContext(socket);
        if (!ctx) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'You are no longer in this meeting.');

        const finished = await finishAttempt(payload.quizId, ctx.participant.id);
        if (!finished) {
          return ackErr(ack, ERROR_CODES.VALIDATION, 'You have already submitted this quiz.');
        }

        await publishQuizProgress(payload.quizId);
        ackOk(ack, undefined as never);
      });

      socket.on('quiz:results', async (payload, ack) => {
        const ctx = await loadContext(socket);
        if (!ctx) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'You are no longer in this meeting.');

        const quiz = await loadQuiz(payload.quizId);
        if (!quiz || quiz.meetingId !== meetingId) {
          return ackErr(ack, ERROR_CODES.NOT_FOUND, 'That quiz no longer exists.');
        }

        const isHost = ctx.participant.role === 'HOST' || ctx.participant.role === 'COHOST';

        // Results stay closed until the quiz ends, whatever the client asks.
        if (quiz.status !== 'ENDED' && !isHost) {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'Results are not available yet.');
        }
        if (quiz.resultVisibility === 'HOST_ONLY' && !isHost) {
          return ackErr(ack, ERROR_CODES.FORBIDDEN, 'The host is keeping these results private.');
        }

        const results = await buildResults(payload.quizId, {
          participantId: ctx.participant.id,
          isHost,
        });
        if (!results) return ackErr(ack, ERROR_CODES.NOT_FOUND, 'Results are not available.');
        ackOk(ack, results);
      });

      socket.on('quiz:away', async (payload, ack) => {
        const ctx = await loadContext(socket);
        if (!ctx) return;
        // Recorded as a plain count and never acted on automatically. It is a
        // note for the host, not an accusation.
        await prisma.quizParticipant
          .updateMany({
            where: { quizId: payload.quizId, participantId: ctx.participant.id },
            data: { awayCount: { increment: 1 } },
          })
          .catch(() => undefined);
        ackOk(ack, undefined as never);
      });

      socket.on('ping:rt', (_payload, ack) => {
        ackOk(ack, { serverTime: new Date().toISOString() });
      });

      socket.on('room:leave', async (_payload, ack) => {
        await handleDeparture(socket, 'LEFT');
        ackOk(ack, undefined as never);
        socket.disconnect(true);
      });

      // ------------------------------------------------------------ disconnect

      socket.on('disconnect', (reason) => {
        void (async () => {
          try {
            const stillHere = await nsp.in(participantRoom(participantId)).fetchSockets();
            // Another tab took over; nothing to announce.
            if (stillHere.some((s) => s.id !== socket.id)) return;

            await prisma.meetingParticipant.update({
              where: { id: participantId },
              data: { connected: false, lastSeenAt: new Date() },
            });
            nsp.to(meetingRoom(meetingId)).emit('participant:updated', { identity, connected: false });
            await redis.srem(KEYS.presence(meetingId), identity).catch(() => undefined);

            if (participant.role === 'HOST') scheduleHostTransfer(meetingId);

            /**
             * Grace period. A dropped connection is treated as "reconnecting",
             * not as leaving — the roster entry stays put so the person returns
             * to the same tile instead of appearing as a second participant.
             */
            const timer = setTimeout(() => {
              void (async () => {
                leaveTimers.delete(participantId);
                const current = await prisma.meetingParticipant.findUnique({ where: { id: participantId } });
                if (!current || current.connected || current.status !== 'ADMITTED') return;

                await prisma.meetingParticipant.update({
                  where: { id: participantId },
                  data: { status: 'LEFT', leftAt: new Date() },
                });
                nsp.to(meetingRoom(meetingId)).emit('participant:left', {
                  identity,
                  name: current.displayName,
                  reason: 'DISCONNECTED',
                });
                await recordEvent(meetingId, current.userId, identity, 'participant.left', {
                  reason: 'disconnected',
                });
              })();
            }, RECONNECT_GRACE_MS);

            leaveTimers.set(participantId, timer);
            logger.debug({ meetingId, identity, reason }, 'participant disconnected');
          } catch (error) {
            logger.error({ err: error, meetingId, identity }, 'disconnect handling failed');
          }
        })();
      });
    })().catch((error) => {
      logger.error({ err: error }, 'realtime connection handler failed');
      socket.emit('room:error', { code: ERROR_CODES.INTERNAL, message: 'Something went wrong. Try rejoining.' });
      socket.disconnect(true);
    });
  });

  /** Explicit, intentional departure. */
  async function handleDeparture(socket: OrbitSocket, reason: 'LEFT' | 'REMOVED'): Promise<void> {
    const { participantId, meetingId, identity } = socket.data;
    const pending = leaveTimers.get(participantId);
    if (pending) {
      clearTimeout(pending);
      leaveTimers.delete(participantId);
    }

    const current = await prisma.meetingParticipant.findUnique({ where: { id: participantId } });
    if (!current) return;

    await prisma.meetingParticipant.update({
      where: { id: participantId },
      data: { status: reason, connected: false, leftAt: new Date(), handRaisedAt: null, screenSharing: false },
    });
    await redis.srem(KEYS.presence(meetingId), identity).catch(() => undefined);

    nsp.to(meetingRoom(meetingId)).emit('participant:left', {
      identity,
      name: current.displayName,
      reason,
    });
    await recordEvent(meetingId, current.userId, identity, 'participant.left', { reason: 'explicit' });

    if (current.role === 'HOST') scheduleHostTransfer(meetingId);
  }

  logger.info({ debounceMs: ACTIVE_SPEAKER_DEBOUNCE_MS }, 'realtime gateway ready');

  return {
    io,
    broadcastMeetingEnded(meetingId, byName, endedAt) {
      nsp.to(meetingRoom(meetingId)).emit('meeting:ended', { by: byName, endedAt });
    },
    connectedParticipants() {
      return nsp.sockets.size;
    },
    async activeMeetings() {
      try {
        return await redis.scard(KEYS.liveMeetings);
      } catch {
        return 0;
      }
    },
    async close() {
      for (const timer of leaveTimers.values()) clearTimeout(timer);
      for (const timer of hostTimers.values()) clearTimeout(timer);
      leaveTimers.clear();
      hostTimers.clear();
      await io.close();
      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    },
  };
}
