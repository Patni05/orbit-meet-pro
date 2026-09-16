'use client';

import { ShieldBan, UserCheck } from 'lucide-react';
import { useEffect } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, Button } from '@/components/ui/primitives';
import { meetingClient } from '@/lib/meeting-client';
import { useRoomStore } from '@/lib/room-store';

/**
 * Blocked participants for this meeting.
 *
 * Shows only what a host needs to recognise an entry — a name, a reason and a
 * time. No addresses, no device information: the host asked to keep someone
 * out, not to be handed a dossier.
 */
export function BlocklistPanel() {
  const entries = useRoomStore((state) => state.blocklist);

  // The list is host-only and fetched on demand rather than pushed to everyone.
  useEffect(() => {
    void meetingClient.loadBlocklist();
  }, []);

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim p-4">
      <p className="text-xs leading-relaxed text-ink-400">
        Blocking applies to this meeting only. A signed-in account stays blocked across new
        sessions and devices; a guest is matched on the identity issued when they joined.
      </p>

      {entries.length === 0 ? (
        <div className="pt-12 text-center">
          <ShieldBan className="mx-auto h-8 w-8 text-ink-600" aria-hidden="true" />
          <p className="mt-3 text-sm text-ink-400">Nobody is blocked.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <Avatar name={entry.displayName} seed={entry.id} size="sm" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink-100">{entry.displayName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={entry.scope === 'USER' ? 'brand' : undefined}>
                    {entry.scope === 'USER' ? 'Account' : 'Guest'}
                  </Badge>
                  <time
                    dateTime={entry.createdAt}
                    className="text-[11px] text-ink-500"
                    title={new Date(entry.createdAt).toLocaleString()}
                  >
                    {new Date(entry.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                {entry.reason && (
                  <p className="mt-1 break-anywhere text-xs text-ink-400">{entry.reason}</p>
                )}
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => void meetingClient.unblock(entry.id)}
                className="shrink-0"
              >
                <UserCheck className="h-4 w-4" />
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
