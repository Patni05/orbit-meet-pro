'use client';

import { REACTION_EMOJI } from '@orbit/shared';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { useRoomStore } from '@/lib/room-store';

/**
 * Meeting-wide reactions.
 *
 * Reactions rise from the bottom of the meeting area all the way to the top
 * and fade out as they arrive, each carrying the sender's avatar and name so
 * it is obvious who reacted rather than just that somebody did.
 *
 * The travel distance is measured rather than hard-coded. A fixed distance is
 * what made this look broken before: the overlay was a 288px strip and the
 * keyframe stopped at 230px, so on any screen taller than that the reaction
 * simply evaporated a third of the way up. Measuring the layer means the same
 * animation covers a 640px phone and a 1400px monitor.
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

  const layerRef = useRef<HTMLDivElement>(null);
  const [rise, setRise] = useState(0);

  /**
   * Track the layer's height so the rise always ends at the top edge.
   *
   * A ResizeObserver rather than a window listener, because the meeting area
   * also changes height when a side panel opens, when the announcement banner
   * appears, and when a phone's URL bar collapses — none of which fire a
   * resize event.
   */
  useEffect(() => {
    const element = layerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height !== undefined) setRise(Math.round(height));
    });
    observer.observe(element);
    setRise(Math.round(element.getBoundingClientRect().height));

    return () => observer.disconnect();
  }, []);

  // Newest last, and capped: beyond a handful on screen the effect stops
  // reading as individual reactions anyway, and the cap bounds the work.
  const visible = useMemo(() => reactions.slice(-12), [reactions]);

  return (
    <div
      ref={layerRef}
      data-reaction-layer
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      aria-hidden="true"
    >
      {rise > 0 &&
        visible.map((reaction) => {
          // A stable hash of the id gives this reaction a consistent lane and a
          // slight delay, so a burst fans out instead of overlapping.
          let hash = 0;
          for (let i = 0; i < reaction.id.length; i += 1) {
            hash = (hash * 31 + reaction.id.charCodeAt(i)) >>> 0;
          }
          // 22-78%, not 8-86%. The reaction is a fixed-width chip centred on
          // its lane, so a lane too close to either edge clips it on a phone —
          // the wider spread only ever looked right on a desktop.
          const lane = 22 + (hash % 57);
          const drift = ((hash >> 8) % 40) - 20;
          const delay = (hash >> 16) % 220;

          const participant = participants[reaction.identity];

          return (
            /*
             * Two elements, because they do two different jobs.
             *
             * The outer one places the reaction horizontally and centres it on
             * its lane. The inner one runs the rise. They cannot be the same
             * element: centring needs `translateX(-50%)` and the animation
             * owns `transform`, so combining them meant the reaction was
             * anchored by its left edge instead. A reaction is about 144px
             * wide, so on a phone the low lanes pinned it against the left
             * edge and the high ones pushed it off-screen — which is exactly
             * how it looked.
             */
            <div
              key={reaction.id}
              className="absolute bottom-3 -translate-x-1/2"
              style={{ left: `${lane}%` }}
            >
              <div
                className="animate-reaction-rise flex flex-col items-center gap-1"
                style={{
                  animationDelay: `${delay}ms`,
                  // Handed to the keyframes so each reaction curves slightly
                  // differently on its way up, and so the rise ends at the top
                  // of this layer whatever its height happens to be.
                  ['--drift' as string]: `${drift}px`,
                  ['--rise' as string]: `${rise}px`,
                }}
              >
                <span className="text-4xl drop-shadow-lg sm:text-5xl">
                  {REACTION_EMOJI[reaction.reaction]}
                </span>

                <span className="flex max-w-28 items-center gap-1 rounded-full bg-ink-950/70 px-2 py-0.5 backdrop-blur-sm sm:max-w-36">
                  <Avatar
                    name={reaction.name}
                    src={participant?.avatarUrl}
                    seed={reaction.identity}
                    size="xs"
                    ring={false}
                  />
                  <span className="truncate text-[11px] font-medium text-white">{reaction.name}</span>
                </span>
              </div>
            </div>
          );
        })}
    </div>
  );
});
