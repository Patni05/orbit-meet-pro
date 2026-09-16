'use client';

import { ChevronDown, Megaphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { meetingClient } from '@/lib/meeting-client';
import { selectIsHost, useRoomStore } from '@/lib/room-store';

/**
 * The host's announcement banner.
 *
 * Deliberately not a toast: an announcement is meant to stay readable until
 * the host retires it, so somebody who looks up thirty seconds later still
 * sees it. It sits above the grid rather than over it, so it never covers a
 * participant or a control.
 *
 * The body is rendered as a text node. An announcement is one of the few
 * places a host can push text to every screen at once, which makes it exactly
 * the place not to interpret markup.
 *
 * Long announcements are clamped rather than allowed to push the video off the
 * screen — 280 characters at phone width is most of the meeting. Expanding is
 * the reader's choice, and a participant can collapse one they have read
 * without affecting anybody else. Only the host can clear it for everyone,
 * which is the distinction the two controls keep: a participant hides, a host
 * retires.
 */
export function AnnouncementBanner() {
  const announcement = useRoomStore((state) => state.announcement);
  const isHost = useRoomStore(selectIsHost);

  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  // A new announcement always shows, even if the last one was collapsed.
  useEffect(() => {
    setExpanded(false);
    setHidden(false);
  }, [announcement?.id]);

  if (!announcement || hidden) return null;

  const long = announcement.body.length > 120;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-start gap-2.5 border-b border-brand-500/30 bg-brand-500/15 px-3 py-2.5 text-sm text-brand-100 sm:gap-3 sm:px-4"
    >
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className={`break-anywhere leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
          <span className="font-medium">{announcement.byName}:</span> {announcement.body}
        </p>

        {long && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="mt-0.5 text-xs font-medium text-brand-300 underline-offset-2 hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {isHost ? (
        <button
          type="button"
          onClick={() => void meetingClient.clearAnnouncement(announcement.id)}
          aria-label="Clear announcement for everyone"
          className="-m-1 shrink-0 rounded p-1.5 text-brand-200 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Hide this announcement"
          title="Hide this announcement"
          className="-m-1 shrink-0 rounded p-1.5 text-brand-200 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
