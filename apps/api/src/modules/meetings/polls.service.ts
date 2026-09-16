import type { PollPayload, PollStatus } from '@orbit/shared';
import { prisma } from '../../lib/prisma';

/**
 * Live polls.
 *
 * The rule that shapes this module: a participant is never sent a tally they
 * are not yet allowed to see. Hiding results in the UI would be pointless —
 * anyone can read a WebSocket frame — so an option's `votes` is genuinely
 * `null` on the wire until the poll closes or the host allows interim results.
 */

type PollWithRelations = NonNullable<Awaited<ReturnType<typeof loadPoll>>>;

export async function loadPoll(pollId: string) {
  return prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      options: { orderBy: { position: 'asc' } },
      votes: { select: { optionId: true, participantId: true } },
    },
  });
}

export interface PollView {
  /** The participant the payload is being built for. */
  participantId: string;
  /** Hosts always see the tally; it is their poll to run. */
  isHost: boolean;
}

/** Shapes a poll for one viewer, withholding anything they may not see yet. */
export function toPollPayload(poll: PollWithRelations, view: PollView): PollPayload {
  const closed = poll.status === 'CLOSED';
  const tallyVisible = closed || view.isHost || !poll.hideResultsUntilClosed;

  const countsByOption = new Map<string, number>();
  for (const vote of poll.votes) {
    countsByOption.set(vote.optionId, (countsByOption.get(vote.optionId) ?? 0) + 1);
  }

  // How many people answered, rather than how many options were ticked. Safe
  // to show at all times: it reveals participation, never preference.
  const responders = new Set(poll.votes.map((vote) => vote.participantId));

  return {
    id: poll.id,
    question: poll.question,
    status: poll.status as PollStatus,
    multiSelect: poll.multiSelect,
    anonymous: poll.anonymous,
    hideResultsUntilClosed: poll.hideResultsUntilClosed,
    options: poll.options.map((option) => ({
      id: option.id,
      label: option.label,
      position: option.position,
      votes: tallyVisible ? (countsByOption.get(option.id) ?? 0) : null,
    })),
    responseCount: responders.size,
    myOptionIds: poll.votes
      .filter((vote) => vote.participantId === view.participantId)
      .map((vote) => vote.optionId),
    createdAt: poll.createdAt.toISOString(),
    closedAt: poll.closedAt?.toISOString() ?? null,
  };
}

export async function createPoll(input: {
  meetingId: string;
  createdById: string;
  question: string;
  options: string[];
  multiSelect?: boolean;
  anonymous?: boolean;
  hideResultsUntilClosed?: boolean;
}) {
  const poll = await prisma.poll.create({
    data: {
      meetingId: input.meetingId,
      createdById: input.createdById,
      question: input.question,
      multiSelect: input.multiSelect ?? false,
      anonymous: input.anonymous ?? false,
      hideResultsUntilClosed: input.hideResultsUntilClosed ?? true,
      // Created open: a poll nobody can answer yet is a draft, and drafts are
      // a quiz-authoring concern rather than something this flow needs.
      status: 'OPEN',
      openedAt: new Date(),
      options: {
        create: input.options.map((label, position) => ({ label, position })),
      },
    },
  });

  return loadPoll(poll.id);
}

export async function closePoll(pollId: string) {
  await prisma.poll.update({
    where: { id: pollId },
    data: { status: 'CLOSED', closedAt: new Date() },
  });
  return loadPoll(pollId);
}

export type VoteResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'CLOSED' | 'INVALID_OPTION' | 'TOO_MANY' };

/**
 * Records a vote, replacing any previous one from the same participant.
 *
 * Every constraint is re-checked here rather than trusted from the client: the
 * poll must still be open, the options must belong to *this* poll, and a
 * single-select poll must receive exactly one choice. The delete-then-create
 * runs in a transaction so a re-vote can never leave someone counted twice.
 */
export async function castVote(input: {
  pollId: string;
  participantId: string;
  optionIds: string[];
}): Promise<VoteResult> {
  const poll = await prisma.poll.findUnique({
    where: { id: input.pollId },
    include: { options: { select: { id: true } } },
  });

  if (!poll) return { ok: false, code: 'NOT_FOUND' };
  if (poll.status !== 'OPEN') return { ok: false, code: 'CLOSED' };

  const valid = new Set(poll.options.map((option) => option.id));
  const chosen = [...new Set(input.optionIds)];

  if (chosen.some((id) => !valid.has(id))) return { ok: false, code: 'INVALID_OPTION' };
  if (!poll.multiSelect && chosen.length > 1) return { ok: false, code: 'TOO_MANY' };

  await prisma.$transaction([
    prisma.pollVote.deleteMany({
      where: { pollId: input.pollId, participantId: input.participantId },
    }),
    ...(chosen.length > 0
      ? [
          prisma.pollVote.createMany({
            data: chosen.map((optionId) => ({
              pollId: input.pollId,
              optionId,
              participantId: input.participantId,
            })),
          }),
        ]
      : []),
  ]);

  return { ok: true };
}

/** Polls to show someone entering the meeting: open ones, and closed results. */
export async function listPollsFor(meetingId: string, view: PollView): Promise<PollPayload[]> {
  const polls = await prisma.poll.findMany({
    where: { meetingId, status: { in: ['OPEN', 'CLOSED'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      options: { orderBy: { position: 'asc' } },
      votes: { select: { optionId: true, participantId: true } },
    },
  });

  return polls.map((poll) => toPollPayload(poll, view));
}
