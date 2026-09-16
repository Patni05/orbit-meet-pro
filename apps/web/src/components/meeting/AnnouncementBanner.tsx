'use client';

import { Megaphone, X } from 'lucide-react';
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
 */
export function AnnouncementBanner() {
  const announcement = useRoomStore((state) => state.announcement);
  const isHost = useRoomStore(selectIsHost);

  if (!announcement) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-start gap-3 border-b border-brand-500/30 bg-brand-500/15 px-4 py-2.5 text-sm text-brand-100"
    >
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" aria-hidden="true" />

      <p className="min-w-0 flex-1 break-anywhere leading-relaxed">
        <span className="font-medium">{announcement.byName}:</span> {announcement.body}
      </p>

      {isHost && (
        <button
          type="button"
          onClick={() => void meetingClient.clearAnnouncement(announcement.id)}
          aria-label="Clear announcement for everyone"
          className="shrink-0 rounded p-1 text-brand-200 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
