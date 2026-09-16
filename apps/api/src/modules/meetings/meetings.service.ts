import type { Meeting, Prisma, User } from '@prisma/client';
import {
  DEFAULT_MEETING_SETTINGS,
  type CreateMeetingInput,
  type MeetingPreview,
  type MeetingSettings,
  type MeetingStatus,
  type MeetingSummary,
  type ParticipantRole,
  type UpdateMeetingInput,
} from '@orbit/shared';
import { env } from '../../config/env';
import { generateMeetingCode, hashPassword } from '../../lib/crypto';
import { forbidden, internal, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { deleteRoom } from '../../lib/livekit';

export type MeetingWithHost = Meeting & { host: Pick<User, 'id' | 'name' | 'avatarUrl'> };

const HOST_INCLUDE = { host: { select: { id: true, name: true, avatarUrl: true } } } as const;

export function settingsOf(meeting: Meeting): MeetingSettings {
  return {
    waitingRoomEnabled: meeting.waitingRoomEnabled,
    requireAuth: meeting.requireAuth,
    allowGuests: meeting.allowGuests,
    chatEnabled: meeting.chatEnabled,
    screenShareMode: meeting.screenShareMode,
    allowParticipantUnmute: meeting.allowParticipantUnmute,
    muteOnEntry: meeting.muteOnEntry,
    recordingEnabled: meeting.recordingEnabled,
  };
}

/** Maps the settings object onto Prisma columns, ignoring keys not supplied. */
export function settingsToColumns(patch: Partial<MeetingSettings>): Prisma.MeetingUpdateInput {
  const data: Prisma.MeetingUpdateInput = {};
  if (patch.waitingRoomEnabled !== undefined) data.waitingRoomEnabled = patch.waitingRoomEnabled;
  if (patch.requireAuth !== undefined) data.requireAuth = patch.requireAuth;
  if (patch.allowGuests !== undefined) data.allowGuests = patch.allowGuests;
  if (patch.chatEnabled !== undefined) data.chatEnabled = patch.chatEnabled;
  if (patch.screenShareMode !== undefined) data.screenShareMode = patch.screenShareMode;
  if (patch.allowParticipantUnmute !== undefined) data.allowParticipantUnmute = patch.allowParticipantUnmute;
  if (patch.muteOnEntry !== undefined) data.muteOnEntry = patch.muteOnEntry;
  if (patch.recordingEnabled !== undefined) data.recordingEnabled = patch.recordingEnabled;
  return data;
}

export function joinUrlFor(code: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}/room/${code}`;
}

export function toSummary(
  meeting: MeetingWithHost,
  extra?: { participantCount?: number; myRole?: ParticipantRole },
): MeetingSummary {
  return {
    id: meeting.id,
    code: meeting.code,
    title: meeting.title,
    description: meeting.description,
    status: meeting.status as MeetingStatus,
    locked: meeting.locked,
    hasPassword: Boolean(meeting.passwordHash),
    scheduledAt: meeting.scheduledAt?.toISOString() ?? null,
    durationMinutes: meeting.durationMinutes,
    timezone: meeting.timezone,
    startedAt: meeting.startedAt?.toISOString() ?? null,
    endedAt: meeting.endedAt?.toISOString() ?? null,
    createdAt: meeting.createdAt.toISOString(),
    host: { id: meeting.host.id, name: meeting.host.name, avatarUrl: meeting.host.avatarUrl },
    settings: settingsOf(meeting),
    joinUrl: joinUrlFor(meeting.code),
    ...(extra?.participantCount !== undefined ? { participantCount: extra.participantCount } : {}),
    ...(extra?.myRole !== undefined ? { myRole: extra.myRole } : {}),
  };
}

/**
 * The pre-join view. Deliberately minimal: it is reachable by anyone holding a
 * link, so it must not leak the participant list, chat, or whether specific
 * people are present.
 */
export function toPreview(meeting: MeetingWithHost): MeetingPreview {
  return {
    id: meeting.id,
    code: meeting.code,
    title: meeting.title,
    status: meeting.status as MeetingStatus,
    locked: meeting.locked,
    hasPassword: Boolean(meeting.passwordHash),
    requireAuth: meeting.requireAuth,
    allowGuests: meeting.allowGuests,
    waitingRoomEnabled: meeting.waitingRoomEnabled,
    hostName: meeting.host.name,
    scheduledAt: meeting.scheduledAt?.toISOString() ?? null,
    startedAt: meeting.startedAt?.toISOString() ?? null,
  };
}

/** Generates a code, retrying on the astronomically unlikely collision. */
async function allocateCode(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateMeetingCode();
    const clash = await prisma.meeting.findUnique({ where: { code }, select: { id: true } });
    if (!clash) return code;
  }
  throw internal('Could not allocate a meeting code.');
}

export async function createMeeting(hostId: string, input: CreateMeetingInput): Promise<MeetingWithHost> {
  const code = await allocateCode();
  const scheduled = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const settings = { ...DEFAULT_MEETING_SETTINGS, ...(input.settings ?? {}) };

  const meeting = await prisma.meeting.create({
    data: {
      code,
      hostId,
      title: input.title?.trim() || (scheduled ? 'Scheduled meeting' : 'Instant meeting'),
      description: input.description ?? null,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      scheduledAt: scheduled,
      durationMinutes: input.durationMinutes ?? null,
      timezone: input.timezone ?? null,
      // An instant meeting is live from creation; a scheduled one waits.
      status: scheduled ? 'SCHEDULED' : 'LIVE',
      startedAt: scheduled ? null : new Date(),
      waitingRoomEnabled: settings.waitingRoomEnabled,
      requireAuth: settings.requireAuth,
      allowGuests: settings.allowGuests,
      chatEnabled: settings.chatEnabled,
      screenShareMode: settings.screenShareMode,
      allowParticipantUnmute: settings.allowParticipantUnmute,
      muteOnEntry: settings.muteOnEntry,
      recordingEnabled: settings.recordingEnabled,
    },
    include: HOST_INCLUDE,
  });

  await recordEvent(meeting.id, hostId, null, 'meeting.created', { scheduled: Boolean(scheduled) });
  logger.info({ meetingId: meeting.id, hostId }, 'meeting created');

  return meeting;
}

export async function findByCode(code: string): Promise<MeetingWithHost | null> {
  return prisma.meeting.findUnique({ where: { code: code.toLowerCase() }, include: HOST_INCLUDE });
}

export async function findById(id: string): Promise<MeetingWithHost | null> {
  return prisma.meeting.findUnique({ where: { id }, include: HOST_INCLUDE });
}

export async function requireMeetingByCode(code: string): Promise<MeetingWithHost> {
  const meeting = await findByCode(code);
  if (!meeting) throw notFound('We could not find that meeting. Check the code and try again.');
  return meeting;
}

/**
 * Role resolution. The host of record always outranks any stored row, so a host
 * who rejoins after a disconnect recovers their privileges automatically.
 */
export async function resolveRole(meeting: Meeting, userId: string | null): Promise<ParticipantRole> {
  if (userId && userId === meeting.hostId) return 'HOST';
  if (!userId) return 'PARTICIPANT';

  const previous = await prisma.meetingParticipant.findFirst({
    where: { meetingId: meeting.id, userId },
    orderBy: { createdAt: 'desc' },
    select: { role: true },
  });

  // COHOST is sticky across rejoins; a demoted participant stays demoted.
  return previous?.role === 'COHOST' ? 'COHOST' : 'PARTICIPANT';
}

export async function isHostOrCohost(meetingId: string, identity: string): Promise<boolean> {
  const participant = await prisma.meetingParticipant.findUnique({
    where: { meetingId_identity: { meetingId, identity } },
    select: { role: true },
  });
  return participant?.role === 'HOST' || participant?.role === 'COHOST';
}

export async function listForUser(
  userId: string,
  filter: 'upcoming' | 'completed' | 'cancelled' | 'all',
  take: number,
): Promise<MeetingSummary[]> {
  const now = new Date();

  const statusFilter: Prisma.MeetingWhereInput =
    filter === 'upcoming'
      ? { OR: [{ status: 'SCHEDULED', scheduledAt: { gte: now } }, { status: 'LIVE' }] }
      : filter === 'completed'
        ? { status: 'ENDED' }
        : filter === 'cancelled'
          ? { status: 'CANCELLED' }
          : {};

  const meetings = await prisma.meeting.findMany({
    where: {
      AND: [
        statusFilter,
        {
          // Meetings I host, plus meetings I actually attended.
          OR: [{ hostId: userId }, { participants: { some: { userId, status: { in: ['ADMITTED', 'LEFT'] } } } }],
        },
      ],
    },
    include: {
      ...HOST_INCLUDE,
      _count: { select: { participants: true } },
      participants: { where: { userId }, select: { role: true }, take: 1 },
    },
    orderBy: filter === 'upcoming' ? [{ scheduledAt: 'asc' }, { createdAt: 'desc' }] : { createdAt: 'desc' },
    take,
  });

  return meetings.map((m) =>
    toSummary(m, {
      participantCount: m._count.participants,
      myRole: (m.participants[0]?.role as ParticipantRole | undefined) ?? (m.hostId === userId ? 'HOST' : undefined),
    }),
  );
}

export async function updateMeeting(
  meetingId: string,
  actorId: string,
  input: UpdateMeetingInput,
): Promise<MeetingWithHost> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw notFound('Meeting not found.');
  if (meeting.hostId !== actorId) throw forbidden('Only the meeting host can change this meeting.');

  const data: Prisma.MeetingUpdateInput = { ...settingsToColumns(input.settings ?? {}) };
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (input.durationMinutes !== undefined) data.durationMinutes = input.durationMinutes;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.status !== undefined) data.status = input.status;
  if (input.password !== undefined) {
    data.passwordHash = input.password ? await hashPassword(input.password) : null;
  }

  const updated = await prisma.meeting.update({ where: { id: meetingId }, data, include: HOST_INCLUDE });
  await recordEvent(meetingId, actorId, null, 'meeting.updated', {});
  return updated;
}

/**
 * Ends a meeting for everyone: marks it ended, closes out participant rows, and
 * tears down the SFU room so no straggler can keep publishing.
 */
export async function endMeeting(
  meetingId: string,
  actor: { userId: string | null; identity: string | null; name: string },
): Promise<MeetingWithHost> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: HOST_INCLUDE });
  if (!meeting) throw notFound('Meeting not found.');

  if (meeting.status === 'ENDED') return meeting;

  const endedAt = new Date();
  const [updated] = await prisma.$transaction([
    prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'ENDED', endedAt, locked: true },
      include: HOST_INCLUDE,
    }),
    prisma.meetingParticipant.updateMany({
      where: { meetingId, leftAt: null },
      data: { leftAt: endedAt, connected: false, status: 'LEFT' },
    }),
  ]);

  await deleteRoom(meeting.code);
  await recordEvent(meetingId, actor.userId, actor.identity, 'meeting.ended', { by: actor.name });
  logger.info({ meetingId }, 'meeting ended');

  return updated;
}

export async function cancelMeeting(meetingId: string, actorId: string): Promise<MeetingWithHost> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw notFound('Meeting not found.');
  if (meeting.hostId !== actorId) throw forbidden('Only the meeting host can cancel this meeting.');
  if (meeting.status === 'LIVE') throw forbidden('End the meeting instead — it is currently running.');

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'CANCELLED' },
    include: HOST_INCLUDE,
  });
  await recordEvent(meetingId, actorId, null, 'meeting.cancelled', {});
  return updated;
}

/** Marks a scheduled meeting live the first time somebody joins. */
export async function markLive(meetingId: string): Promise<void> {
  await prisma.meeting.updateMany({
    where: { id: meetingId, status: 'SCHEDULED' },
    data: { status: 'LIVE', startedAt: new Date() },
  });
}

export async function setLocked(meetingId: string, locked: boolean): Promise<void> {
  await prisma.meeting.update({ where: { id: meetingId }, data: { locked } });
}

/** Append-only audit trail. Never records message bodies or credentials. */
export async function recordEvent(
  meetingId: string,
  actorId: string | null,
  actorIdentity: string | null,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.meetingEvent.create({
      data: { meetingId, actorId, actorIdentity, type, payload: payload as Prisma.InputJsonValue },
    });
  } catch (error) {
    // Audit logging must never break the meeting itself.
    logger.warn({ err: error, meetingId, type }, 'failed to record meeting event');
  }
}
