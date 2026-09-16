import type { MeetingParticipant, User } from '@prisma/client';
import { isPrivateOrigin } from '../../lib/net';
import { isBlocked } from './blocklist.service';
import {
  ERROR_CODES,
  type JoinOutcome,
  type JoinTicket,
  type ParticipantRole,
  type RoomParticipant,
  type WaitingParticipant,
} from '@orbit/shared';
import { env } from '../../config/env';
import { AppError, forbidden, tooManyRequests } from '../../lib/errors';
import { generateIdentity, verifyPassword } from '../../lib/crypto';
import { signSessionToken } from '../../lib/jwt';
import { createParticipantToken } from '../../lib/livekit';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { bumpCounter } from '../../lib/redis';
import {
  markLive,
  recordEvent,
  resolveRole,
  settingsOf,
  toPreview,
  toSummary,
  type MeetingWithHost,
} from './meetings.service';

export interface JoinRequest {
  meeting: MeetingWithHost;
  user: User | null;
  displayName?: string;
  password?: string;
  /** Stable per-tab id from the client; the key to reconnecting without duplicates. */
  sessionId?: string;
  /** Built-in avatar chosen on the pre-join screen. */
  avatarUrl?: string | null;
  ip?: string;
  /** Origin the client used to reach us, e.g. https://192.168.1.35:8443. */
  requestOrigin?: string;
}

export function toRoomParticipant(p: MeetingParticipant): RoomParticipant {
  return {
    identity: p.identity,
    participantId: p.id,
    userId: p.userId,
    name: p.displayName,
    avatarUrl: p.avatarUrl,
    role: p.role as ParticipantRole,
    status: p.status,
    isGuest: p.isGuest,
    joinedAt: (p.joinedAt ?? p.createdAt).toISOString(),
    handRaisedAt: p.handRaisedAt?.toISOString() ?? null,
    micEnabled: p.micEnabled,
    cameraEnabled: p.cameraEnabled,
    screenSharing: p.screenSharing,
    connected: p.connected,
  };
}

export function toWaitingParticipant(p: MeetingParticipant): WaitingParticipant {
  return {
    participantId: p.id,
    identity: p.identity,
    name: p.displayName,
    avatarUrl: p.avatarUrl,
    userId: p.userId,
    requestedAt: p.createdAt.toISOString(),
  };
}

/**
 * Passcode attempts are counted per meeting *and* per client. Someone probing a
 * single meeting is slowed down, and someone spraying many meetings from one
 * address is slowed down too.
 */
async function assertPasswordAttemptAllowed(meetingId: string, ip: string | undefined): Promise<void> {
  const perMeeting = await bumpCounter('join-pw', `${meetingId}`, 300);
  if (perMeeting > 50) throw tooManyRequests('Too many failed attempts on this meeting. Try again shortly.');

  if (ip) {
    const perIp = await bumpCounter('join-pw-ip', ip, 300);
    if (perIp > 20) throw tooManyRequests('Too many join attempts. Please wait a moment.');
  }
}

/**
 * Finds the participant row this join should resume.
 *
 * Priority is the per-tab session id, so refreshing a page or riding out a
 * network drop lands on the same row and the same LiveKit identity. Signed-in
 * users fall back to their most recent row in the meeting. Guests without a
 * session id always get a new row — there is nothing to tie them to.
 */
async function findResumableParticipant(
  meetingId: string,
  sessionId: string | undefined,
  userId: string | null,
): Promise<MeetingParticipant | null> {
  if (sessionId) {
    const bySession = await prisma.meetingParticipant.findFirst({
      where: { meetingId, sessionId },
      orderBy: { createdAt: 'desc' },
    });
    if (bySession) return bySession;
  }

  if (userId) {
    return prisma.meetingParticipant.findFirst({
      where: { meetingId, userId, status: { in: ['ADMITTED', 'WAITING', 'LEFT'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  return null;
}

/** Builds the join ticket: LiveKit token, realtime session token, meeting summary. */
export async function issueTicket(
  meeting: MeetingWithHost,
  participant: MeetingParticipant,
  /** Origin the client used, so the SFU address it gets back is reachable. */
  requestOrigin?: string,
): Promise<JoinTicket> {
  const settings = settingsOf(meeting);
  const role = participant.role as ParticipantRole;

  const token = await createParticipantToken({
    meetingCode: meeting.code,
    identity: participant.identity,
    displayName: participant.displayName,
    role,
    settings,
    metadata: {
      role,
      participantId: participant.id,
      userId: participant.userId,
      avatarUrl: participant.avatarUrl,
      isGuest: participant.isGuest,
    },
  });

  const sessionToken = await signSessionToken({
    participantId: participant.id,
    meetingId: meeting.id,
    identity: participant.identity,
  });

  return {
    token,
    livekitUrl: livekitUrlFor(requestOrigin),
    identity: participant.identity,
    participantId: participant.id,
    role,
    sessionToken,
    meeting: toSummary(meeting),
  };
}

/**
 * The SFU address handed to this particular client.
 *
 * The same deployment can be reachable two ways at once: directly on localhost
 * during development, and through the LAN HTTPS proxy from a phone. A client
 * that arrived through the proxy must be sent back through it, because it has
 * only accepted that one certificate — pointing it at the direct ws:// address
 * would be blocked as insecure, and pointing a localhost client at the proxy
 * would fail on a certificate it has never seen.
 */
function livekitUrlFor(requestOrigin?: string): string {
  const configured = env.LIVEKIT_PUBLIC_URL;

  // A hosted SFU is publicly reachable and already has a valid certificate, so
  // clients go straight to it. Only a locally-run SFU needs to borrow the
  // proxy's origin to be reachable at all.
  if (!isPrivateOrigin(configured.replace(/^ws/, 'http'))) return configured;

  if (requestOrigin && env.PROXY_ORIGINS.includes(requestOrigin)) {
    // Signalling rides the origin the client already trusts; the proxy forwards
    // /livekit to the SFU. Media still goes direct, not through the proxy.
    return `${requestOrigin.replace(/^http/, 'ws')}/livekit`;
  }

  return configured;
}

export async function joinMeeting(request: JoinRequest): Promise<JoinOutcome> {
  const { meeting, user } = request;
  const settings = settingsOf(meeting);

  if (meeting.status === 'ENDED' || meeting.status === 'CANCELLED') {
    return { outcome: 'ENDED' };
  }

  if (settings.requireAuth && !user) {
    throw new AppError(401, 'AUTH_REQUIRED', 'The host requires you to sign in before joining.');
  }
  if (!settings.allowGuests && !user) {
    throw new AppError(401, 'AUTH_REQUIRED', 'This meeting is open to signed-in people only.');
  }

  const displayName = (request.displayName?.trim() || user?.name || '').trim();
  if (!displayName) {
    throw new AppError(400, ERROR_CODES.VALIDATION, 'Enter the name others will see.');
  }

  // ---- passcode ----
  if (meeting.passwordHash) {
    await assertPasswordAttemptAllowed(meeting.id, request.ip);
    const supplied = request.password ?? '';
    const ok = supplied.length > 0 && (await verifyPassword(meeting.passwordHash, supplied));
    if (!ok) {
      throw new AppError(403, ERROR_CODES.INVALID_PASSWORD, 'That passcode is not correct.');
    }
  }

  const existing = await findResumableParticipant(meeting.id, request.sessionId, user?.id ?? null);

  if (existing?.status === 'REMOVED') {
    return { outcome: 'REJECTED', reason: 'You were removed from this meeting by the host.' };
  }

  /**
   * Blocked people are turned away here, before a LiveKit token exists.
   *
   * Checking later — at the waiting room, or when the socket connects — would
   * still have minted SFU credentials for someone the host has barred, and a
   * token is all it takes to reach the media server directly.
   */
  if (
    await isBlocked({
      meetingId: meeting.id,
      userId: user?.id ?? null,
      identity: existing?.identity ?? null,
    })
  ) {
    return { outcome: 'REJECTED', reason: 'You can no longer join this meeting.' };
  }

  const role = await resolveRole(meeting, user?.id ?? null);
  const isHostLike = role === 'HOST' || role === 'COHOST';

  // ---- lock ----
  // A locked meeting still lets hosts in, and lets a previously admitted
  // participant reconnect after a drop — locking is about new arrivals.
  if (meeting.locked && !isHostLike && existing?.status !== 'ADMITTED') {
    return { outcome: 'LOCKED' };
  }

  // ---- waiting room ----
  const needsWaitingRoom =
    settings.waitingRoomEnabled && !isHostLike && existing?.status !== 'ADMITTED';

  const identity = existing?.identity ?? generateIdentity(user ? 'u' : 'g');

  const participant = existing
    ? await prisma.meetingParticipant.update({
        where: { id: existing.id },
        data: {
          displayName,
          avatarUrl: request.avatarUrl ?? user?.avatarUrl ?? existing.avatarUrl,
          role,
          status: needsWaitingRoom ? 'WAITING' : 'ADMITTED',
          sessionId: request.sessionId ?? existing.sessionId,
          userId: user?.id ?? existing.userId,
          isGuest: !user,
          leftAt: null,
          lastSeenAt: new Date(),
          ...(needsWaitingRoom ? {} : { joinedAt: existing.joinedAt ?? new Date() }),
        },
      })
    : await prisma.meetingParticipant.create({
        data: {
          meetingId: meeting.id,
          userId: user?.id ?? null,
          identity,
          sessionId: request.sessionId ?? null,
          displayName,
          avatarUrl: request.avatarUrl ?? user?.avatarUrl ?? null,
          isGuest: !user,
          role,
          status: needsWaitingRoom ? 'WAITING' : 'ADMITTED',
          joinedAt: needsWaitingRoom ? null : new Date(),
          micEnabled: false,
          cameraEnabled: false,
        },
      });

  if (needsWaitingRoom) {
    const sessionToken = await signSessionToken({
      participantId: participant.id,
      meetingId: meeting.id,
      identity: participant.identity,
    });
    await recordEvent(meeting.id, user?.id ?? null, participant.identity, 'participant.waiting', {
      name: displayName,
    });
    return {
      outcome: 'WAITING',
      participantId: participant.id,
      sessionToken,
      meeting: toPreview(meeting),
    };
  }

  await markLive(meeting.id);
  await recordEvent(meeting.id, user?.id ?? null, participant.identity, 'participant.joined', {
    name: displayName,
    role,
    resumed: Boolean(existing),
  });

  logger.info(
    { meetingId: meeting.id, identity: participant.identity, role, resumed: Boolean(existing) },
    'participant admitted',
  );

  const ticket = await issueTicket(meeting, participant, request.requestOrigin);
  return { outcome: 'ADMITTED', ticket };
}

/** Host admits somebody from the waiting room. Returns the now-joinable row. */
export async function admitParticipant(
  meeting: MeetingWithHost,
  participantId: string,
): Promise<MeetingParticipant> {
  const participant = await prisma.meetingParticipant.findUnique({ where: { id: participantId } });
  if (!participant || participant.meetingId !== meeting.id) {
    throw forbidden('That person is no longer waiting to join.');
  }

  const updated = await prisma.meetingParticipant.update({
    where: { id: participantId },
    data: { status: 'ADMITTED', joinedAt: new Date() },
  });

  await markLive(meeting.id);
  await recordEvent(meeting.id, null, participant.identity, 'participant.admitted', {
    name: participant.displayName,
  });

  return updated;
}

export async function rejectParticipant(
  meeting: MeetingWithHost,
  participantId: string,
): Promise<MeetingParticipant | null> {
  const participant = await prisma.meetingParticipant.findUnique({ where: { id: participantId } });
  if (!participant || participant.meetingId !== meeting.id) return null;

  const updated = await prisma.meetingParticipant.update({
    where: { id: participantId },
    data: { status: 'REJECTED' },
  });

  await recordEvent(meeting.id, null, participant.identity, 'participant.rejected', {
    name: participant.displayName,
  });

  return updated;
}

export async function listWaiting(meetingId: string): Promise<WaitingParticipant[]> {
  const rows = await prisma.meetingParticipant.findMany({
    where: { meetingId, status: 'WAITING' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toWaitingParticipant);
}
