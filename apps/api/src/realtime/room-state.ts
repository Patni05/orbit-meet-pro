import type { ChatMessagePayload, RoomParticipant, RoomState } from '@orbit/shared';
import { prisma } from '../lib/prisma';
import { toRoomParticipant, toWaitingParticipant } from '../modules/meetings/join.service';
import { listPollsFor } from '../modules/meetings/polls.service';
import { listTodos } from '../modules/meetings/todos.service';
import { listRecordings } from '../modules/meetings/recordings.service';
import { toSummary, type MeetingWithHost } from '../modules/meetings/meetings.service';

/** How much backlog a joiner receives. Enough for context, not a full archive. */
const CHAT_BACKLOG = 200;

export function toChatPayload(row: {
  id: string;
  meetingId: string;
  senderIdentity: string;
  senderName: string;
  senderId: string | null;
  body: string;
  sentAt: Date;
}): ChatMessagePayload {
  return {
    id: row.id,
    meetingId: row.meetingId,
    senderIdentity: row.senderIdentity,
    senderName: row.senderName,
    senderUserId: row.senderId,
    body: row.body,
    sentAt: row.sentAt.toISOString(),
  };
}

/**
 * Builds the snapshot a client receives on connect (and on reconnect).
 *
 * Everything the UI needs to rebuild itself is here, which is what makes a page
 * refresh mid-meeting recoverable: the client re-fetches this rather than
 * trying to replay events it missed.
 */
export async function buildRoomState(
  meeting: MeetingWithHost,
  selfParticipantId: string,
): Promise<RoomState | null> {
  const [participants, self, messages, recording] = await Promise.all([
    prisma.meetingParticipant.findMany({
      where: { meetingId: meeting.id, status: { in: ['ADMITTED', 'WAITING'] } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.meetingParticipant.findUnique({ where: { id: selfParticipantId } }),
    meeting.chatEnabled
      ? prisma.chatMessage.findMany({
          where: { meetingId: meeting.id, deletedAt: null },
          orderBy: { sentAt: 'desc' },
          take: CHAT_BACKLOG,
        })
      : Promise.resolve([]),
    prisma.recording.findFirst({
      where: { meetingId: meeting.id, status: { in: ['STARTING', 'ACTIVE'] } },
      orderBy: { startedAt: 'desc' },
    }),
  ]);

  if (!self) return null;

  const admitted: RoomParticipant[] = participants
    .filter((p) => p.status === 'ADMITTED')
    .map(toRoomParticipant);

  // The waiting list is host-only information; strip it for everyone else.
  const isHostLike = self.role === 'HOST' || self.role === 'COHOST';
  const waiting = isHostLike
    ? participants.filter((p) => p.status === 'WAITING').map(toWaitingParticipant)
    : [];

  // Polls are shaped per viewer: an open poll's tally stays hidden from
  // participants until it closes, so the payload itself has to differ.
  const [announcement, polls, todos, recordings] = await Promise.all([
    prisma.meetingAnnouncement.findFirst({
      where: { meetingId: meeting.id, dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true } } },
    }),
    listPollsFor(meeting.id, { participantId: self.id, isHost: isHostLike }),
    listTodos(meeting.id),
    isHostLike ? listRecordings(meeting.id) : Promise.resolve([]),
  ]);

  return {
    meeting: toSummary(meeting, { participantCount: admitted.length }),
    self: toRoomParticipant(self),
    participants: admitted,
    waiting,
    messages: messages.reverse().map(toChatPayload),
    recording: {
      active: Boolean(recording),
      recordingId: recording?.id ?? null,
      startedAt: recording?.startedAt.toISOString() ?? null,
    },
    locks: { micLocked: meeting.micLocked, cameraLocked: meeting.cameraLocked },
    todos,
    // Recordings are the host's: a participant's payload simply does not
    // contain them, so there is no id to guess at.
    recordings: isHostLike ? recordings : [],
    presenceCheck: self.presenceCheck as RoomState['presenceCheck'],
    hostOnlyExit: meeting.hostOnlyExit,
    spotlight: meeting.spotlightIdentities,
    announcement: announcement
      ? {
          id: announcement.id,
          body: announcement.body,
          byName: announcement.createdBy.name,
          createdAt: announcement.createdAt.toISOString(),
        }
      : null,
    polls,
    serverTime: new Date().toISOString(),
  };
}
