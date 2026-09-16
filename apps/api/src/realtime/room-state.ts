import type { ChatMessagePayload, RoomParticipant, RoomState } from '@orbit/shared';
import { prisma } from '../lib/prisma';
import { toRoomParticipant, toWaitingParticipant } from '../modules/meetings/join.service';
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
    serverTime: new Date().toISOString(),
  };
}
