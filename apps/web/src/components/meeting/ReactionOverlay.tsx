'use client';

import { REACTION_EMOJI } from '@orbit/shared';
import { memo, useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { useRoomStore } from '@/lib/room-store';

/**
 * Meeting-wide reactions.
 *
 * Reactions rise from the bottom of the meeting area and fade near the top,
 * each carrying the sender's avatar and name so it is obvious who reacted
 * rather than just that somebody did.
 *
 * Three things keep it cheap under a burst:
 *
 * Only `transform` and `opacity` are animated, both of which the compositor
 * handles without touching layout — so twenty reactions cost roughly what one
 * costs, and nothing above them reflows.
 *
 * Each reaction is assigned a lane derived from its own id rather than a
 * random number, so the same reaction keeps its lane across re-renders and
 * simultaneous reactions spread out instead of stacking into an unreadable
 * pile.
 *
 * The whole layer is `pointer-events-none` and sits below the control bar in
 * the stacking order, so a stream of reactions can never swallow a click on
 * Mute or Leave.
 *
 * Users who ask for reduced motion get the same information without the
 * travel: the global reduced-motion rule collapses the animation, and the
 * reaction simply appears and clears.
 */
export const ReactionOverlay = memo(function ReactionOverlay() {
  const reactions = useRoomStore((state) => state.reactions);
  const participants = useRoomStore((state) => state.participants);

  // Newest last, and capped: beyond a handful on screen the effect stops
  // reading as individual reactions anyway, and the cap bounds the work.
  const visible = useMemo(() => reactions.slice(-12), [reactions]);

  if (visible.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-72 overflow-hidden"
      aria-hidden="true"
    >
      {visible.map((reaction) => {
        // A stable hash of the id gives this reaction a consistent lane and a
        // slight delay, so a burst fans out instead of overlapping.
        let hash = 0;
        for (let i = 0; i < reaction.id.length; i += 1) {
          hash = (hash * 31 + reaction.id.charCodeAt(i)) >>> 0;
        }
        const lane = 8 + (hash % 78);
        const drift = ((hash >> 8) % 24) - 12;
        const delay = (hash >> 16) % 220;

        const participant = participants[reaction.identity];

        return (
          <div
            key={reaction.id}
            className="animate-reaction-rise absolute bottom-4 flex flex-col items-center gap-1"
            style={{
              left: `${lane}%`,
              animationDelay: `${delay}ms`,
              // Handed to the keyframes so each reaction curves slightly
              // differently on its way up.
              ['--drift' as string]: `${drift}px`,
            }}
          >
            <span className="text-4xl drop-shadow-lg sm:text-5xl">
              {REACTION_EMOJI[reaction.reaction]}
            </span>

            <span className="flex max-w-[9rem] items-center gap-1 rounded-full bg-ink-950/70 px-2 py-0.5 backdrop-blur-sm">
              <Avatar
                name={reaction.name}
                src={participant?.avatarUrl}
                seed={reaction.identity}
                size="xs"
              />
              <span className="truncate text-[11px] font-medium text-white">{reaction.name}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
});
