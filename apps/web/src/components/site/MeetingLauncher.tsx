'use client';

import { extractMeetingCode } from '@orbit/shared';
import { ArrowRight, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button, Input } from '@/components/ui/primitives';

/**
 * The two ways into a meeting: start one, or enter a code.
 *
 * The join field accepts a bare code, a spaced code, or a pasted meeting link —
 * people copy whatever is in front of them, and all three should work.
 */
export function MeetingLauncher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);

  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function startInstantMeeting() {
    setCreateError(null);

    if (!user) {
      // Signing in first, then returning here, beats a dead-end error.
      router.push('/login?next=/dashboard&reason=new-meeting');
      return;
    }

    setCreating(true);
    try {
      const { meeting } = await api.meetings.create({ title: 'Instant meeting' });
      router.push(`/room/${meeting.code}`);
    } catch (error) {
      setCreateError(
        error instanceof ApiError ? error.message : 'Could not start a meeting. Please try again.',
      );
      setCreating(false);
    }
  }

  function submitJoin(event: FormEvent) {
    event.preventDefault();
    setJoinError(null);

    const parsed = extractMeetingCode(code);
    if (!parsed) {
      setJoinError('Enter a meeting code like abcd-efgh-ijkl, or paste the meeting link.');
      return;
    }
    router.push(`/room/${parsed}`);
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size={compact ? 'md' : 'lg'}
          onClick={startInstantMeeting}
          loading={creating}
          disabled={!ready}
          className="sm:w-auto"
        >
          <Video className="h-4 w-4" />
          New meeting
        </Button>

        <form onSubmit={submitJoin} className="flex flex-1 gap-2">
          <div className="flex-1">
            <label htmlFor="join-code" className="sr-only">
              Meeting code or link
            </label>
            <Input
              id="join-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (joinError) setJoinError(null);
              }}
              placeholder="Enter a code or link"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              invalid={Boolean(joinError)}
              className={compact ? '' : 'h-12'}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            size={compact ? 'md' : 'lg'}
            disabled={code.trim().length === 0}
          >
            Join
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {joinError && (
        <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">
          {joinError}
        </p>
      )}
      {createError && (
        <p role="alert" className="text-sm text-danger-600 dark:text-danger-400">
          {createError}
        </p>
      )}
    </div>
  );
}
