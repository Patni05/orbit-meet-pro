'use client';

import { formatDuration } from '@orbit/shared';
import { Ban, Clock, DoorClosed, Hourglass, Lock, RotateCcw, Users } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/primitives';

/** Shared frame for every non-meeting state, so they all look deliberate. */
function StateShell({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="meeting-surface flex min-h-dvh flex-col">
      <header className="safe-top px-4 py-4 sm:px-6">
        <Link href="/" aria-label="Orbit home" className="inline-flex rounded-lg">
          <Logo wordmarkClassName="text-ink-50" />
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-brand-300">
            {icon}
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">{title}</h1>
          {description && <div className="mt-2 text-sm text-ink-400">{description}</div>}
          {children && <div className="mt-7">{children}</div>}
        </div>
      </main>
    </div>
  );
}

/**
 * Waiting room.
 *
 * The person waiting is told exactly what is happening and given a way out.
 * No meeting content — no roster, no chat — reaches this screen.
 */
export function WaitingRoomScreen({
  meetingTitle,
  hostName,
  onCancel,
}: {
  meetingTitle: string;
  hostName: string;
  onCancel: () => void;
}) {
  return (
    <StateShell
      icon={<Hourglass className="h-7 w-7 animate-pulse" />}
      title="Waiting for the host to let you in"
      description={
        <>
          You asked to join <span className="font-medium text-ink-200">{meetingTitle}</span>.{' '}
          {hostName} will admit you shortly.
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="h-2 w-2 animate-bounce rounded-full bg-brand-400"
              style={{ animationDelay: `${index * 140}ms` }}
            />
          ))}
        </div>
        <Button variant="secondary" onClick={onCancel}>
          Cancel and leave
        </Button>
      </div>
    </StateShell>
  );
}

/**
 * Post-meeting screen.
 *
 * Distinguishes leaving from the meeting ending, because "can I go back in?"
 * is the first question in both cases and the answer differs.
 */
export function MeetingEndedScreen({
  reason,
  meetingTitle,
  endedBy,
  durationSeconds,
  participantCount,
  canRejoin,
  onRejoin,
}: {
  reason: 'left' | 'ended' | 'removed';
  meetingTitle?: string;
  endedBy?: string | null;
  durationSeconds?: number | null;
  participantCount?: number;
  canRejoin: boolean;
  onRejoin: () => void;
}) {
  const copy = {
    left: {
      icon: <DoorClosed className="h-7 w-7" />,
      title: 'You left the meeting',
      description: canRejoin ? 'You can rejoin while the meeting is still running.' : undefined,
    },
    ended: {
      icon: <Ban className="h-7 w-7" />,
      title: 'This meeting has ended',
      description: endedBy ? `${endedBy} ended the meeting for everyone.` : undefined,
    },
    removed: {
      icon: <Ban className="h-7 w-7 text-danger-400" />,
      title: 'You were removed from the meeting',
      description: endedBy ? `${endedBy} removed you.` : 'The host removed you from this meeting.',
    },
  }[reason];

  return (
    <StateShell icon={copy.icon} title={copy.title} description={copy.description}>
      {(durationSeconds || participantCount) && (
        <dl className="mb-6 flex justify-center gap-6 text-sm">
          {durationSeconds ? (
            <div className="flex items-center gap-2 text-ink-400">
              <Clock className="h-4 w-4" />
              <dt className="sr-only">Duration</dt>
              <dd>{formatDuration(durationSeconds)}</dd>
            </div>
          ) : null}
          {participantCount ? (
            <div className="flex items-center gap-2 text-ink-400">
              <Users className="h-4 w-4" />
              <dt className="sr-only">Participants</dt>
              <dd>
                {participantCount} participant{participantCount === 1 ? '' : 's'}
              </dd>
            </div>
          ) : null}
        </dl>
      )}

      {meetingTitle && <p className="mb-5 text-sm text-ink-300">{meetingTitle}</p>}

      <div className="flex flex-wrap justify-center gap-3">
        {canRejoin && reason !== 'removed' && (
          <Button onClick={onRejoin}>
            <RotateCcw className="h-4 w-4" />
            Rejoin
          </Button>
        )}
        <Link href="/">
          <Button variant="secondary">Return home</Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="ghost">Go to dashboard</Button>
        </Link>
      </div>
    </StateShell>
  );
}

/** Any blocking problem: not found, locked, wrong passcode, rejected, SFU down. */
export function MeetingProblemScreen({
  kind,
  message,
  onRetry,
}: {
  kind: 'not-found' | 'locked' | 'rejected' | 'error';
  message?: string;
  onRetry?: () => void;
}) {
  const copy = {
    'not-found': {
      icon: <Ban className="h-7 w-7" />,
      title: 'Meeting not found',
      description: 'Check the meeting code or link. It may have been mistyped, or the meeting may be over.',
    },
    locked: {
      icon: <Lock className="h-7 w-7 text-warning-400" />,
      title: 'This meeting has been locked by the host',
      description: 'Nobody new can join right now. Ask the host to unlock it, then try again.',
    },
    rejected: {
      icon: <Ban className="h-7 w-7 text-danger-400" />,
      title: 'The host declined your request',
      description: 'You were not admitted to this meeting.',
    },
    error: {
      icon: <Ban className="h-7 w-7 text-danger-400" />,
      title: 'Could not join the meeting',
      description: 'Something went wrong on the way in.',
    },
  }[kind];

  return (
    <StateShell icon={copy.icon} title={copy.title} description={message ?? copy.description}>
      <div className="flex flex-wrap justify-center gap-3">
        {onRetry && (
          <Button onClick={onRetry}>
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
        )}
        <Link href="/">
          <Button variant="secondary">Return home</Button>
        </Link>
      </div>
    </StateShell>
  );
}

export function RoomLoadingScreen() {
  return (
    <StateShell icon={<Hourglass className="h-7 w-7 animate-pulse" />} title="Getting the meeting ready" />
  );
}
