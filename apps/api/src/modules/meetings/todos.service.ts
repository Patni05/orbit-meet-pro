import type { TodoPayload } from '@orbit/shared';
import { prisma } from '../../lib/prisma';

/**
 * The host's task list for a meeting.
 *
 * Stored rather than kept in component state, because the whole point is that
 * it survives a refresh, a reconnect, and the host closing the panel. Scoped
 * to the meeting, so a task written in one call never turns up in another.
 */

export function toTodoPayload(row: {
  id: string;
  text: string;
  completed: boolean;
  completedAt: Date | null;
  createdByName: string;
  position: number;
  createdAt: Date;
}): TodoPayload {
  return {
    id: row.id,
    text: row.text,
    completed: row.completed,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdByName: row.createdByName,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listTodos(meetingId: string): Promise<TodoPayload[]> {
  const rows = await prisma.meetingTodo.findMany({
    where: { meetingId },
    orderBy: { position: 'asc' },
  });
  return rows.map(toTodoPayload);
}

export async function createTodo(input: {
  meetingId: string;
  text: string;
  createdById: string;
  createdByName: string;
}): Promise<TodoPayload> {
  const last = await prisma.meetingTodo.findFirst({
    where: { meetingId: input.meetingId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const row = await prisma.meetingTodo.create({
    data: {
      meetingId: input.meetingId,
      text: input.text,
      createdById: input.createdById,
      createdByName: input.createdByName,
      position: (last?.position ?? 0) + 1,
    },
  });

  return toTodoPayload(row);
}

/**
 * Edits a task.
 *
 * Scoped by meeting as well as id, so a well-formed id from another meeting
 * cannot be used to reach across into somebody else's list.
 */
export async function updateTodo(input: {
  meetingId: string;
  id: string;
  text?: string;
  completed?: boolean;
}): Promise<TodoPayload | null> {
  const existing = await prisma.meetingTodo.findFirst({
    where: { id: input.id, meetingId: input.meetingId },
  });
  if (!existing) return null;

  const row = await prisma.meetingTodo.update({
    where: { id: input.id },
    data: {
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.completed !== undefined
        ? { completed: input.completed, completedAt: input.completed ? new Date() : null }
        : {}),
    },
  });

  return toTodoPayload(row);
}

export async function deleteTodo(meetingId: string, id: string): Promise<boolean> {
  const result = await prisma.meetingTodo.deleteMany({ where: { id, meetingId } });
  return result.count > 0;
}

/**
 * Whether this participant may change the task list.
 *
 * The host always may. A co-host only when the host has switched it on, which
 * is off by default — the list is the host's own working notes, and sharing it
 * should be a deliberate choice rather than a side effect of being promoted.
 */
export function canManageTodos(
  meeting: { cohostsManageTodos: boolean },
  participant: { role: string },
): boolean {
  if (participant.role === 'HOST') return true;
  if (participant.role === 'COHOST') return meeting.cohostsManageTodos;
  return false;
}
