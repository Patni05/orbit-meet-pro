import type { BlocklistEntry } from '@orbit/shared';
import type { MeetingParticipant } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/**
 * Per-meeting blocklist.
 *
 * Two deliberate choices shape this.
 *
 * **Scope is the meeting, not the product.** Being removed from one call says
 * nothing about any other, and a host of one meeting has no business banning
 * someone from everyone else's.
 *
 * **Identity is whatever the participant actually has.** A signed-in user is
 * matched on their account, which survives new tabs, new sessions and new
 * devices. An anonymous guest has only the meeting-scoped identity issued at
 * join time — weaker, and honestly so. The alternative is device
 * fingerprinting, which is invasive, wrong to do quietly, and defeated by any
 * determined visitor anyway. A guest who clears storage can return under a new
 * identity; a host who needs a firmer boundary should require sign-in, which
 * is exactly what the meeting's `requireAuth` setting is for.
 */

export function toBlocklistEntry(row: {
  id: string;
  scope: string;
  displayName: string;
  reason: string | null;
  createdAt: Date;
  userId: string | null;
  identity: string | null;
}): BlocklistEntry {
  return {
    id: row.id,
    scope: row.scope as BlocklistEntry['scope'],
    displayName: row.displayName,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    userId: row.userId,
    identity: row.identity,
  };
}

export async function listBlocklist(meetingId: string): Promise<BlocklistEntry[]> {
  const rows = await prisma.meetingBlocklistEntry.findMany({
    where: { meetingId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toBlocklistEntry);
}

/**
 * Blocks a participant.
 *
 * Idempotent: blocking someone twice updates the existing entry rather than
 * failing, because a host clicking twice should not see an error.
 */
export async function blockParticipant(input: {
  meetingId: string;
  participant: MeetingParticipant;
  blockedById: string;
  reason?: string;
}): Promise<BlocklistEntry> {
  const { meetingId, participant, blockedById, reason } = input;

  const scope = participant.userId ? 'USER' : 'GUEST_IDENTITY';
  const where =
    participant.userId != null
      ? { meetingId_userId: { meetingId, userId: participant.userId } }
      : { meetingId_identity: { meetingId, identity: participant.identity } };

  const row = await prisma.meetingBlocklistEntry.upsert({
    where: where as never,
    create: {
      meetingId,
      scope,
      userId: participant.userId,
      identity: participant.userId ? null : participant.identity,
      displayName: participant.displayName,
      reason: reason ?? null,
      blockedById,
    },
    update: { reason: reason ?? null, displayName: participant.displayName },
  });

  return toBlocklistEntry(row);
}

export async function unblock(meetingId: string, entryId: string): Promise<boolean> {
  const result = await prisma.meetingBlocklistEntry.deleteMany({
    where: { id: entryId, meetingId },
  });
  return result.count > 0;
}

/**
 * Whether this person is barred from the meeting.
 *
 * Called on every join attempt, before any token is minted — a blocked visitor
 * must never reach the point of holding SFU credentials. Both handles are
 * checked, so a signed-in user who was blocked as a guest (or the reverse)
 * still matches.
 */
export async function isBlocked(input: {
  meetingId: string;
  userId?: string | null;
  identity?: string | null;
}): Promise<boolean> {
  const { meetingId, userId, identity } = input;

  const conditions: { userId?: string; identity?: string }[] = [];
  if (userId) conditions.push({ userId });
  if (identity) conditions.push({ identity });
  if (conditions.length === 0) return false;

  const hit = await prisma.meetingBlocklistEntry.findFirst({
    where: { meetingId, OR: conditions },
    select: { id: true },
  });

  return hit !== null;
}
