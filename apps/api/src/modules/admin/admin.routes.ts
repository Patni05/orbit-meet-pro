import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/errors';
import { countActiveRooms } from '../../lib/livekit';
import { prisma } from '../../lib/prisma';
import { toSummary } from '../meetings/meetings.service';

/**
 * Administration.
 *
 * Every route here is gated by `requireAdmin`, which re-verifies the caller's
 * platform role from their signed token. Admins can see operational metadata —
 * counts, statuses, audit events — and never meeting media, chat bodies or
 * passcodes.
 */
const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get('/overview', async (_request, reply) => {
    const [users, meetingsTotal, live, scheduled, ended, participantsNow, activeRooms] = await Promise.all([
      prisma.user.count(),
      prisma.meeting.count(),
      prisma.meeting.count({ where: { status: 'LIVE' } }),
      prisma.meeting.count({ where: { status: 'SCHEDULED' } }),
      prisma.meeting.count({ where: { status: 'ENDED' } }),
      prisma.meetingParticipant.count({ where: { connected: true, status: 'ADMITTED' } }),
      countActiveRooms(),
    ]);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [newUsers24h, meetings24h] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.meeting.count({ where: { createdAt: { gte: since } } }),
    ]);

    return reply.send({
      users: { total: users, newLast24h: newUsers24h },
      meetings: { total: meetingsTotal, live, scheduled, ended, createdLast24h: meetings24h },
      realtime: {
        connectedParticipants: participantsNow,
        sfuRooms: activeRooms,
        socketConnections: fastify.realtime.connectedParticipants(),
      },
    });
  });

  fastify.get('/meetings', async (request, reply) => {
    const query = parseOrThrow(
      z.object({
        status: z.enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']).optional(),
        take: z.coerce.number().int().min(1).max(100).default(25),
      }),
      request.query ?? {},
    );

    const rows = await prisma.meeting.findMany({
      where: query.status ? { status: query.status } : {},
      include: {
        host: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { participants: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.take,
    });

    return reply.send({
      meetings: rows.map((m) => toSummary(m, { participantCount: m._count.participants })),
    });
  });

  fastify.get('/users', async (request, reply) => {
    const query = parseOrThrow(
      z.object({
        search: z.string().trim().max(120).optional(),
        take: z.coerce.number().int().min(1).max(100).default(25),
      }),
      request.query ?? {},
    );

    const rows = await prisma.user.findMany({
      where: query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {},
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        lastActiveAt: true,
        _count: { select: { hostedMeetings: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.take,
    });

    return reply.send({ users: rows });
  });

  /** Recent audit events across all meetings, for abuse investigation. */
  fastify.get('/events', async (request, reply) => {
    const query = parseOrThrow(
      z.object({
        meetingId: z.string().uuid().optional(),
        type: z.string().max(64).optional(),
        take: z.coerce.number().int().min(1).max(200).default(50),
      }),
      request.query ?? {},
    );

    const events = await prisma.meetingEvent.findMany({
      where: {
        ...(query.meetingId ? { meetingId: query.meetingId } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.take,
    });

    return reply.send({ events });
  });
};

export default adminRoutes;
