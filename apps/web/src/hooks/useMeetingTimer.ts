'use client';

import { formatDuration } from '@orbit/shared';
import { useEffect, useState } from 'react';

/**
 * Elapsed meeting time.
 *
 * Anchored to the meeting's own start time and corrected by the server clock
 * offset, so the timer shows how long the *meeting* has been running — not how
 * long this component has been mounted. A re-render or a rejoin does not reset
 * it, and a wrong device clock does not skew it.
 */
export function useMeetingTimer(startedAt: string | null | undefined, serverOffsetMs = 0): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return '00:00';

  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '00:00';

  const elapsedSeconds = (now + serverOffsetMs - start) / 1000;
  return formatDuration(elapsedSeconds);
}
