'use client';

import { ChevronLeft, ChevronRight, ScreenShare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTrackElement } from '@/hooks/useTrackElement';
import { useRoomStore } from '@/lib/room-store';
import { VideoTile } from './VideoTile';

/**
 * Beyond this many tiles the grid pages rather than shrinking further.
 *
 * A phone gets a smaller page on purpose. Sixteen tiles in two columns on a
 * 360px screen is a 180px-wide slot per person — too small to recognise
 * anyone, and sixteen decoded video streams the device has to keep up with.
 * Six is the most that stays legible in portrait.
 */
const PAGE_SIZE_NARROW = 6;
const PAGE_SIZE_WIDE = 16;

/** Tracks a media query without re-rendering on every resize. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * Participant layout.
 *
 * Three modes, chosen automatically and overridable by the user:
 *   - a presentation takes the stage and everyone becomes a filmstrip
 *   - speaker view promotes the pinned person, or the active speaker
 *   - grid view fits everyone, with column counts tuned per headcount so tiles
 *     stay close to 16:9 instead of becoming letterbox slots
 */
export function VideoGrid() {
  const order = useRoomStore((state) => state.order);
  const participants = useRoomStore((state) => state.participants);
  const selfIdentity = useRoomStore((state) => state.selfIdentity);
  const layout = useRoomStore((state) => state.layout);
  const pinned = useRoomStore((state) => state.pinned);
  const presenter = useRoomStore((state) => state.presenter);
  const activeSpeaker = useRoomStore((state) => state.activeSpeaker);
  const spotlight = useRoomStore((state) => state.spotlight);

  const [page, setPage] = useState(0);
  const narrow = useMediaQuery('(max-width: 639px)');
  const pageSize = narrow ? PAGE_SIZE_NARROW : PAGE_SIZE_WIDE;

  const visible = useMemo(
    () => order.filter((identity) => participants[identity]),
    [order, participants],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));

  // Leaving participants can make the current page disappear.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-lg font-medium text-ink-200">Waiting for others to join</p>
          <p className="mt-1 text-sm text-ink-400">Share the meeting link to invite people.</p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ presentation
  if (presenter && participants[presenter]) {
    return <PresentationLayout presenterIdentity={presenter} others={visible} selfIdentity={selfIdentity} />;
  }

  // ------------------------------------------------------------- spotlight
  // A host spotlighting someone is an instruction to the whole room, so it
  // outranks both the automatic active speaker and a personal layout choice.
  // A presentation still wins, because that is what a presenter asked for.
  const spotlighted = spotlight.filter((identity) => participants[identity]);
  if (spotlighted.length > 0) {
    const others = visible.filter((identity) => !spotlighted.includes(identity));
    return (
      <div className="flex h-full flex-col gap-2 p-2 sm:gap-3 sm:p-3">
        <div
          className={`grid min-h-0 flex-1 gap-2 sm:gap-3 ${
            spotlighted.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {spotlighted.map((identity) => (
            <VideoTile
              key={identity}
              identity={identity}
              variant="stage"
              isLocal={identity === selfIdentity}
            />
          ))}
        </div>
        <Filmstrip identities={others} selfIdentity={selfIdentity} />
      </div>
    );
  }

  // ------------------------------------------------------------ speaker view
  if (layout === 'speaker' && visible.length > 1) {
    const stage = pinned && participants[pinned] ? pinned : (activeSpeaker ?? visible[0]!);
    const strip = visible.filter((identity) => identity !== stage);

    return (
      <div className="flex h-full flex-col gap-2 p-2 sm:gap-3 sm:p-3">
        <div className="min-h-0 flex-1">
          <VideoTile identity={stage} variant="stage" isLocal={stage === selfIdentity} />
        </div>
        <Filmstrip identities={strip} selfIdentity={selfIdentity} />
      </div>
    );
  }

  // -------------------------------------------------------------- grid view
  const pageItems = visible.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="flex h-full flex-col p-2 sm:p-3">
      <div
        className={`grid min-h-0 flex-1 gap-2 sm:gap-3 ${gridClassFor(pageItems.length)}`}
        style={{ gridAutoRows: '1fr' }}
      >
        {pageItems.map((identity) => (
          <VideoTile key={identity} identity={identity} isLocal={identity === selfIdentity} />
        ))}
      </div>

      {pageCount > 1 && (
        <nav className="mt-2 flex items-center justify-center gap-3" aria-label="Participant pages">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
            className="rounded-lg p-1.5 text-ink-300 hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-xs text-ink-400">
            {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            aria-label="Next page"
            className="rounded-lg p-1.5 text-ink-300 hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </nav>
      )}
    </div>
  );
}

/**
 * Column counts per headcount.
 *
 * Chosen so tiles stay near 16:9: one person fills the space, two sit side by
 * side, three and four make a square, and larger counts step up in columns
 * rather than cramming everyone into one row.
 */
function gridClassFor(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  if (count <= 6) return 'grid-cols-2 sm:grid-cols-3';
  if (count <= 9) return 'grid-cols-2 sm:grid-cols-3';
  if (count <= 12) return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  return 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-5';
}

function Filmstrip({ identities, selfIdentity }: { identities: string[]; selfIdentity: string | null }) {
  if (identities.length === 0) return null;

  return (
    <div
      className="flex h-24 shrink-0 gap-2 overflow-x-auto scrollbar-slim sm:h-28"
      // Horizontal scrolling is expected here, unlike the rest of the page.
      role="list"
      aria-label="Other participants"
    >
      {identities.map((identity) => (
        <div key={identity} role="listitem" className="h-full">
          <VideoTile identity={identity} variant="strip" showControls={false} isLocal={identity === selfIdentity} />
        </div>
      ))}
    </div>
  );
}

/**
 * Presentation layout.
 *
 * The shared screen gets the stage and is shown with `object-contain` so no
 * part of a slide or a terminal is cropped away. Everyone stays visible in the
 * strip below — a presentation should not hide the room.
 */
function PresentationLayout({
  presenterIdentity,
  others,
  selfIdentity,
}: {
  presenterIdentity: string;
  others: string[];
  selfIdentity: string | null;
}) {
  const screenTrack = useRoomStore((state) => state.tracks[presenterIdentity]?.screen);
  const presenter = useRoomStore((state) => state.participants[presenterIdentity]);
  const screenRef = useTrackElement<HTMLVideoElement>(screenTrack);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-full flex-col gap-2 p-2 sm:gap-3 sm:p-3">
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-tile bg-black ring-1 ring-white/10"
      >
        {screenTrack ? (
          <video ref={screenRef} autoPlay playsInline muted className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">
            Waiting for the presentation to appear…
          </div>
        )}

        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-ink-950/80 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
          <ScreenShare className="h-3.5 w-3.5 text-brand-400" />
          {presenter ? `${presenter.name} is presenting` : 'Presentation'}
        </div>
      </div>

      <Filmstrip identities={others} selfIdentity={selfIdentity} />
    </div>
  );
}
