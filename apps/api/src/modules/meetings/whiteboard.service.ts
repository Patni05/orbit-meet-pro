import type { WhiteboardMode, WhiteboardState, WhiteboardStrokePayload } from '@orbit/shared';
import { prisma } from '../../lib/prisma';

/**
 * Collaborative whiteboard.
 *
 * Stored as strokes rather than pixels. That choice is what makes the board
 * practical over a realtime socket: a stroke is a few hundred bytes, a bitmap
 * is megabytes, and sending the latter on every pointer move would saturate
 * the connection the meeting itself needs. It also means a late joiner
 * rebuilds the board exactly by replaying rows, and undo is a deletion rather
 * than a pixel diff.
 *
 * Points are normalised to 0–1 in both axes, so a stroke drawn on a phone
 * appears in the same place on a widescreen monitor.
 */

/** Keeps one board bounded; the oldest strokes are dropped past this. */
const MAX_STROKES = 5000;

export function toStrokePayload(row: {
  id: string;
  authorIdentity: string;
  authorName: string;
  tool: string;
  color: string;
  width: number;
  points: number[];
  text: string | null;
  seq: number;
}): WhiteboardStrokePayload {
  return {
    id: row.id,
    authorIdentity: row.authorIdentity,
    authorName: row.authorName,
    tool: row.tool as WhiteboardStrokePayload['tool'],
    color: row.color,
    width: row.width,
    points: row.points,
    text: row.text,
    seq: row.seq,
  };
}

/**
 * Whether this participant may draw right now.
 *
 * Decided here, on every stroke, rather than trusted from the client — the
 * toolbar being visible is a convenience, not permission. An explicit denial
 * always wins, so a host can silence one person without changing the policy
 * for everybody.
 */
export function canDraw(
  meeting: { whiteboardMode: string; whiteboardAllowed: string[]; whiteboardDenied: string[] },
  participant: { identity: string; role: string },
): boolean {
  // Individual decisions outrank the mode in both directions. The mode is the
  // default for people the host has said nothing about; once they have picked
  // somebody out, that choice should hold whatever the default later becomes.
  // Without this, granting access from the participant menu would silently do
  // nothing in hosts-only mode.
  if (meeting.whiteboardDenied.includes(participant.identity)) return false;
  if (meeting.whiteboardAllowed.includes(participant.identity)) return true;

  const isHost = participant.role === 'HOST' || participant.role === 'COHOST';
  if (isHost) return true;

  switch (meeting.whiteboardMode as WhiteboardMode) {
    case 'EVERYONE':
      return true;
    case 'HOSTS_ONLY':
      return false;
    case 'SELECTED':
      // Everyone allowed under this mode is on the list, which the check above
      // already covered.
      return false;
    default:
      return false;
  }
}

export async function loadBoard(
  meeting: {
    id: string;
    whiteboardMode: string;
    whiteboardAllowed: string[];
    whiteboardDenied: string[];
  },
  participant: { identity: string; role: string },
): Promise<WhiteboardState> {
  const strokes = await prisma.whiteboardStroke.findMany({
    where: { meetingId: meeting.id },
    orderBy: { seq: 'asc' },
    take: MAX_STROKES,
  });

  return {
    mode: meeting.whiteboardMode as WhiteboardMode,
    canDraw: canDraw(meeting, participant),
    allowed: meeting.whiteboardAllowed,
    denied: meeting.whiteboardDenied,
    strokes: strokes.map(toStrokePayload),
  };
}

/**
 * Appends a stroke.
 *
 * Allocating `seq` by reading the current maximum and writing max+1 is a race:
 * concurrent writers all read the same value and all claim it. On a shared
 * board that is not a rare edge case — it is what happens the moment two
 * people draw together, which is the whole point of the feature. Retrying on
 * the unique constraint helps at two writers and collapses at twenty, because
 * every retry re-reads the same contended maximum.
 *
 * So the allocation is serialised instead, with a Postgres advisory lock held
 * for the transaction. The lock is keyed on the meeting, so boards in
 * different meetings never wait on each other, and it is released
 * automatically when the transaction ends — including if it fails.
 */
export async function addStroke(input: {
  meetingId: string;
  authorIdentity: string;
  authorName: string;
  tool: string;
  color: string;
  width: number;
  points: number[];
  text?: string | null;
}): Promise<WhiteboardStrokePayload> {
  const row = await prisma.$transaction(async (tx) => {
    // hashtext maps the meeting id onto the integer key the lock API takes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.meetingId}))`;

    const last = await tx.whiteboardStroke.findFirst({
      where: { meetingId: input.meetingId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });

    return tx.whiteboardStroke.create({
      data: {
        meetingId: input.meetingId,
        authorIdentity: input.authorIdentity,
        authorName: input.authorName,
        tool: input.tool,
        color: input.color,
        width: input.width,
        points: input.points,
        text: input.text ?? null,
        seq: (last?.seq ?? 0) + 1,
      },
    });
  });

  return toStrokePayload(row);
}

/**
 * Removes this author's most recent stroke.
 *
 * Undo is scoped to the person who drew it: in a shared board, undoing
 * somebody else's work by pressing Ctrl+Z would be both surprising and rude.
 */
export async function undoLastStroke(
  meetingId: string,
  authorIdentity: string,
): Promise<string | null> {
  const last = await prisma.whiteboardStroke.findFirst({
    where: { meetingId, authorIdentity },
    orderBy: { seq: 'desc' },
    select: { id: true },
  });
  if (!last) return null;

  await prisma.whiteboardStroke.delete({ where: { id: last.id } });
  return last.id;
}

export async function clearBoard(meetingId: string): Promise<void> {
  await prisma.whiteboardStroke.deleteMany({ where: { meetingId } });
}

export async function setMode(meetingId: string, mode: WhiteboardMode): Promise<void> {
  await prisma.meeting.update({ where: { id: meetingId }, data: { whiteboardMode: mode } });
}

/** Grants or revokes drawing for one person, independent of the mode. */
export async function setPermission(
  meetingId: string,
  identity: string,
  allow: boolean,
): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { whiteboardAllowed: true, whiteboardDenied: true },
  });
  if (!meeting) return;

  const allowed = new Set(meeting.whiteboardAllowed);
  const denied = new Set(meeting.whiteboardDenied);

  if (allow) {
    allowed.add(identity);
    denied.delete(identity);
  } else {
    denied.add(identity);
    allowed.delete(identity);
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { whiteboardAllowed: [...allowed], whiteboardDenied: [...denied] },
  });
}
