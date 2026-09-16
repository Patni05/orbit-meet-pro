'use client';

import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import { useRoomStore } from '@/lib/room-store';

/**
 * Transient meeting notices — joins, leaves, host actions.
 *
 * Capped at three on screen and auto-dismissed, so a burst of arrivals cannot
 * bury the meeting behind toasts. Announced politely rather than assertively:
 * "Sam joined" should not interrupt a screen reader mid-sentence.
 */
export function NoticeStack() {
  const notices = useRoomStore((state) => state.notices);
  const dismiss = useRoomStore((state) => state.dismissNotice);

  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((notice) =>
      setTimeout(() => dismiss(notice.id), notice.kind === 'error' ? 7000 : 4000),
    );
    return () => timers.forEach(clearTimeout);
  }, [notices, dismiss]);

  if (notices.length === 0) return null;

  const icons = {
    info: <Info className="h-4 w-4 text-brand-400" />,
    warn: <AlertTriangle className="h-4 w-4 text-warning-400" />,
    error: <AlertTriangle className="h-4 w-4 text-danger-400" />,
    success: <CheckCircle2 className="h-4 w-4 text-success-400" />,
  } as const;

  return (
    <div
      className="pointer-events-none absolute bottom-4 left-1/2 z-40 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {notices.slice(-3).map((notice) => (
        <div
          key={notice.id}
          className="pointer-events-auto flex animate-[fade-in_0.2s_ease-out] items-center gap-2.5 rounded-xl border border-white/10 bg-ink-850/95 px-3.5 py-2.5 text-sm text-ink-100 shadow-xl backdrop-blur"
        >
          {icons[notice.kind]}
          <span className="min-w-0 flex-1 break-anywhere">{notice.message}</span>
          <button
            type="button"
            onClick={() => dismiss(notice.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-ink-400 transition-colors hover:text-ink-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
