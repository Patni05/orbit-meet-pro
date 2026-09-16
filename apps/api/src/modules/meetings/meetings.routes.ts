import type { FastifyPluginAsync } from 'fastify';
import {
  buildInvitationText,
  createMeetingSchema,
  historyQuerySchema,
  joinMeetingSchema,
  meetingCodeSchema,
  updateMeetingSchema,
} from '@orbit/shared';
import { forbidden, notFound, parseOrThrow, unauthorized } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { getUserById } from '../auth/auth.service';
import { joinMeeting } from './join.service';
import * as meetings from './meetings.service';

const meetingRoutes: FastifyPluginAsync = async (fastify) => {
  /** Creates an instant or scheduled meeting. */
  fastify.post('/', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const input = parseOrThrow(createMeetingSchema, request.body ?? {});
    const meeting = await meetings.createMeeting(request.auth!.userId, input);
    return reply.code(201).send({ meeting: meetings.toSummary(meeting) });
  });

  /** Meetings I host or attended, filtered for the dashboard. */
  fastify.get('/', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const query = parseOrThrow(historyQuerySchema, request.query ?? {});
    const list = await meetings.listForUser(request.auth!.userId, query.filter, query.take);
    return reply.send({ meetings: list });
  });

  fastify.get('/history', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const query = parseOrThrow(historyQuerySchema, { ...(request.query as object), filter: 'completed' });
    const list = await meetings.listForUser(request.auth!.userId, 'completed', query.take);
    return reply.send({ meetings: list });
  });

  /**
   * Public pre-join lookup.
   *
   * Rate limited hard: this is the endpoint an attacker would use to walk the
   * code space. It reveals only what a pre-join screen needs.
   */
  fastify.get(
    '/code/:code',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [fastify.optionalAuth],
    },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const parsed = parseOrThrow(meetingCodeSchema, code);
      const meeting = await meetings.findByCode(parsed);
      if (!meeting) throw notFound('We could not find that meeting. Check the code and try again.');
      return reply.send({ meeting: meetings.toPreview(meeting) });
    },
  );

  /**
   * Join. Returns either an admission ticket (LiveKit token + session token) or
   * a waiting-room placement. Every branch is decided server-side.
   */
  fastify.post(
    '/code/:code/join',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: [fastify.optionalAuth],
    },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const parsedCode = parseOrThrow(meetingCodeSchema, code);
      const input = parseOrThrow(joinMeetingSchema, request.body ?? {});

      const meeting = await meetings.requireMeetingByCode(parsedCode);
      const user = request.auth ? await getUserById(request.auth.userId) : null;

      const outcome = await joinMeeting({
        meeting,
        user,
        displayName: input.displayName,
        password: input.password,
        sessionId: input.sessionId,
        ip: request.ip,
        // Behind a proxy the Host header is the public one, so this is the
        // origin the browser actually used rather than the internal address.
        requestOrigin: `${request.headers['x-forwarded-proto'] ?? request.protocol}://${request.headers.host ?? ''}`,
      });

      return reply.send(outcome);
    },
  );

  /** Full detail. Restricted to the host and people who actually took part. */
  fastify.get('/:id', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const meeting = await meetings.findById(id);
    if (!meeting) throw notFound('Meeting not found.');

    const userId = request.auth!.userId;
    if (meeting.hostId !== userId) {
      const attended = await prisma.meetingParticipant.findFirst({
        where: { meetingId: id, userId },
        select: { id: true, role: true },
      });
      if (!attended) throw forbidden('You do not have access to this meeting.');
    }

    const participantCount = await prisma.meetingParticipant.count({ where: { meetingId: id } });
    return reply.send({ meeting: meetings.toSummary(meeting, { participantCount }) });
  });

  fastify.patch('/:id', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(updateMeetingSchema, request.body ?? {});
    const meeting = await meetings.updateMeeting(id, request.auth!.userId, input);
    return reply.send({ meeting: meetings.toSummary(meeting) });
  });

  fastify.post('/:id/cancel', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const meeting = await meetings.cancelMeeting(id, request.auth!.userId);
    return reply.send({ meeting: meetings.toSummary(meeting) });
  });

  /**
   * Ends the meeting for everyone. Host-only — the check is here, on the
   * server, not in whether the button was rendered.
   */
  fastify.post('/:id/end', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const meeting = await meetings.findById(id);
    if (!meeting) throw notFound('Meeting not found.');

    const userId = request.auth!.userId;
    if (meeting.hostId !== userId) {
      const participant = await prisma.meetingParticipant.findFirst({
        where: { meetingId: id, userId },
        select: { role: true },
      });
      if (participant?.role !== 'COHOST') throw forbidden('Only the host can end this meeting.');
    }

    const ended = await meetings.endMeeting(id, {
      userId,
      identity: null,
      name: request.auth!.name,
    });

    // Tell everyone still connected.
    fastify.realtime.broadcastMeetingEnded(ended.id, request.auth!.name, ended.endedAt!.toISOString());

    return reply.send({ meeting: meetings.toSummary(ended) });
  });

  /** Ready-to-paste invitation text plus its parts. */
  fastify.get('/:id/invitation', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const meeting = await meetings.findById(id);
    if (!meeting) throw notFound('Meeting not found.');
    if (meeting.hostId !== request.auth!.userId) {
      const attended = await prisma.meetingParticipant.findFirst({
        where: { meetingId: id, userId: request.auth!.userId },
        select: { id: true },
      });
      if (!attended) throw forbidden('You do not have access to this meeting.');
    }

    const joinUrl = meetings.joinUrlFor(meeting.code);
    return reply.send({
      joinUrl,
      code: meeting.code,
      hasPassword: Boolean(meeting.passwordHash),
      // The passcode itself is never returned — only the host knows it.
      text: buildInvitationText({
        title: meeting.title,
        joinUrl,
        code: meeting.code,
        scheduledAt: meeting.scheduledAt?.toISOString() ?? null,
        timezone: meeting.timezone,
        hostName: meeting.host.name,
      }),
    });
  });

  /** Chat transcript for a finished meeting. Participants only. */
  fastify.get('/:id/messages', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.auth!.userId;

    const meeting = await meetings.findById(id);
    if (!meeting) throw notFound('Meeting not found.');
    if (meeting.hostId !== userId) {
      const attended = await prisma.meetingParticipant.findFirst({
        where: { meetingId: id, userId },
        select: { id: true },
      });
      if (!attended) throw unauthorized('You do not have access to this meeting.');
    }

    const rows = await prisma.chatMessage.findMany({
      where: { meetingId: id, deletedAt: null },
      orderBy: { sentAt: 'asc' },
      take: 500,
    });

    return reply.send({
      messages: rows.map((m) => ({
        id: m.id,
        meetingId: m.meetingId,
        senderIdentity: m.senderIdentity,
        senderName: m.senderName,
        senderUserId: m.senderId,
        body: m.body,
        sentAt: m.sentAt.toISOString(),
      })),
    });
  });
};

export default meetingRoutes;
