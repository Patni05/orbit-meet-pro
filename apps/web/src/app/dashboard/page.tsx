'use client';

import { formatMeetingCode, type MeetingSummary } from '@orbit/shared';
import {
  CalendarClock,
  CalendarPlus,
  Clock,
  Link2,
  LogOut,
  Radio,
  Share2,
  Users,
  Video,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ScheduleDialog } from '@/components/dashboard/ScheduleDialog';
import { InviteDialog } from '@/components/meeting/InviteDialog';
import { MeetingLauncher } from '@/components/site/MeetingLauncher';
import { SiteHeader } from '@/components/site/SiteHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, Button, EmptyState, Spinner } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

type Filter = 'upcoming' | 'completed' | 'cancelled' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);
  const logout = useAuthStore((state) => state.logout);

  const [filter, setFilter] = useState<Filter>('upcoming');
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [invite, setInvite] = useState<{ meeting: MeetingSummary; password: string | null } | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace('/login?next=/dashboard');
  }, [ready, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { meetings: rows } = await api.meetings.list(filter, 40);
      setMeetings(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your meetings.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function cancelMeeting(meeting: MeetingSummary) {
    try {
      await api.meetings.cancel(meeting.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel that meeting.');
    }
  }

  if (!ready || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-6 w-6 text-brand-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink-50 dark:bg-ink-950">
      <SiteHeader />

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} src={user.avatarUrl} seed={user.id} size="lg" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Hello, {user.name.split(' ')[0]}</h1>
              <p className="text-sm text-ink-500 dark:text-ink-400">{user.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout();
              router.push('/');
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>

        {/* ------------------------------------------------------- actions */}
        <section className="mt-8 rounded-2xl border border-ink-200/80 bg-white p-5 shadow-sm sm:p-6 dark:border-white/10 dark:bg-ink-850">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Start or join
          </h2>
          <div className="mt-4">
            <MeetingLauncher compact />
          </div>
          <div className="mt-4 border-t border-ink-100 pt-4 dark:border-white/10">
            <Button variant="secondary" onClick={() => setScheduleOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              Schedule a meeting
            </Button>
          </div>
        </section>

        {/* ------------------------------------------------------ meetings */}
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Your meetings</h2>
            <div className="flex flex-wrap gap-1 rounded-xl bg-ink-100 p-1 dark:bg-white/5" role="tablist">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    filter === item.id
                      ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-white'
                      : 'text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="flex justify-center py-12">
                <Spinner className="h-6 w-6 text-brand-500" />
              </div>
            ) : error ? (
              <div className="rounded-xl border border-danger-500/30 bg-danger-500/10 p-4 text-sm text-danger-700 dark:text-danger-300">
                {error}
              </div>
            ) : meetings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-ink-200 bg-white dark:border-white/10 dark:bg-ink-850">
                <EmptyState
                  icon={<CalendarClock className="h-8 w-8" />}
                  title={
                    filter === 'upcoming'
                      ? 'Nothing scheduled'
                      : filter === 'completed'
                        ? 'No past meetings yet'
                        : filter === 'cancelled'
                          ? 'No cancelled meetings'
                          : 'No meetings yet'
                  }
                  description="Start an instant meeting, or schedule one for later."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setScheduleOpen(true)}>
                      <CalendarPlus className="h-4 w-4" />
                      Schedule a meeting
                    </Button>
                  }
                />
              </div>
            ) : (
              meetings.map((meeting) => (
                <MeetingCard
                  key={meeting.id}
                  meeting={meeting}
                  onInvite={() => setInvite({ meeting, password: null })}
                  onCancel={() => cancelMeeting(meeting)}
                />
              ))
            )}
          </div>
        </section>
      </main>

      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={(meeting, password) => {
          setScheduleOpen(false);
          setInvite({ meeting, password });
          void load();
        }}
      />

      {invite && (
        <InviteDialog
          open
          onClose={() => setInvite(null)}
          title={invite.meeting.title}
          joinUrl={invite.meeting.joinUrl}
          code={invite.meeting.code}
          password={invite.password}
          hostName={invite.meeting.host.name}
          scheduledAt={invite.meeting.scheduledAt}
        />
      )}
    </div>
  );
}

function MeetingCard({
  meeting,
  onInvite,
  onCancel,
}: {
  meeting: MeetingSummary;
  onInvite: () => void;
  onCancel: () => void;
}) {
  const scheduled = meeting.scheduledAt ? new Date(meeting.scheduledAt) : null;
  const started = meeting.startedAt ? new Date(meeting.startedAt) : null;
  const ended = meeting.endedAt ? new Date(meeting.endedAt) : null;

  const durationMinutes =
    started && ended ? Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60000)) : null;

  const isHost = meeting.myRole === 'HOST';
  const canJoin = meeting.status === 'LIVE' || meeting.status === 'SCHEDULED';

  return (
    <article className="rounded-2xl border border-ink-200/80 bg-white p-4 transition-shadow hover:shadow-md sm:p-5 dark:border-white/10 dark:bg-ink-850">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{meeting.title}</h3>
            {meeting.status === 'LIVE' && (
              <Badge tone="success">
                <Radio className="h-3 w-3" />
                Live
              </Badge>
            )}
            {meeting.status === 'SCHEDULED' && <Badge tone="brand">Scheduled</Badge>}
            {meeting.status === 'ENDED' && <Badge>Completed</Badge>}
            {meeting.status === 'CANCELLED' && <Badge tone="danger">Cancelled</Badge>}
            {isHost && <Badge tone="warning">Host</Badge>}
            {meeting.hasPassword && <Badge>Passcode</Badge>}
          </div>

          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-500 dark:text-ink-400">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Meeting code</dt>
              <Link2 className="h-3.5 w-3.5" />
              <dd className="font-mono text-xs tracking-wide">{formatMeetingCode(meeting.code)}</dd>
            </div>

            {scheduled && (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Scheduled for</dt>
                <CalendarClock className="h-3.5 w-3.5" />
                <dd>
                  {scheduled.toLocaleString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </dd>
              </div>
            )}

            {durationMinutes !== null && (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Duration</dt>
                <Clock className="h-3.5 w-3.5" />
                <dd>{durationMinutes} min</dd>
              </div>
            )}

            {meeting.participantCount !== undefined && meeting.participantCount > 0 && (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Participants</dt>
                <Users className="h-3.5 w-3.5" />
                <dd>
                  {meeting.participantCount} participant{meeting.participantCount === 1 ? '' : 's'}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={onInvite}>
            <Share2 className="h-4 w-4" />
            Invite
          </Button>

          {isHost && meeting.status === 'SCHEDULED' && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          )}

          {canJoin && (
            <Link href={`/room/${meeting.code}`}>
              <Button size="sm">
                <Video className="h-4 w-4" />
                {meeting.status === 'LIVE' ? 'Join' : 'Start'}
              </Button>
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
