'use client';

import { REACTION_EMOJI, type RoomParticipant } from '@orbit/shared';
import { ConnectionQuality } from 'livekit-client';
import { Hand, Maximize2, MicOff, Pin, PinOff, ScreenShare, SignalLow, SignalMedium, WifiOff } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { useTrackElement } from '@/hooks/useTrackElement';
import { useRoomStore } from '@/lib/room-store';

/**
 * One participant tile.
 *
 * Memoised and driven by narrow store selectors: a person starting to speak
 * re-renders their own tile and nobody else's. The video element is never
 * re-created on a state change, so the stream does not flicker.
 */
export const VideoTile = memo(function VideoTile({
  identity,
  variant = 'grid',
  showControls = true,
  isLocal = false,
}: {
  identity: string;
  variant?: 'grid' | 'stage' | 'strip';
  showControls?: boolean;
  isLocal?: boolean;
}) {
  const participant = useRoomStore((state) => state.participants[identity]);
  const bundle = useRoomStore((state) => state.tracks[identity]);
  const speaking = useRoomStore((state) => Boolean(state.speaking[identity]));
  const quality = useRoomStore((state) => state.quality[identity]);
  const pinned = useRoomStore((state) => state.pinned === identity);
  const togglePin = useRoomStore((state) => state.togglePin);
  const setFullscreenIdentity = useRoomStore((state) => state.setFullscreenIdentity);
  const reactions = useRoomStore((state) => state.reactions);

  const videoTrack = bundle?.camera;
  const videoRef = useTrackElement<HTMLVideoElement>(videoTrack);

  const myReactions = useMemo(
    () => reactions.filter((reaction) => reaction.identity === identity),
    [reactions, identity],
  );

  if (!participant) return null;

  const hasVideo = Boolean(videoTrack);
  const compact = variant === 'strip';

  return (
    <div
      className={[
        'group relative overflow-hidden bg-ink-900 transition-shadow duration-150',
        variant === 'strip' ? 'h-full w-40 shrink-0 rounded-lg sm:w-48' : 'h-full w-full rounded-tile',
        // The speaking ring is the only thing that animates here — a subtle,
        // continuous signal rather than a flashing border.
        speaking
          ? 'ring-2 ring-success-400 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]'
          : 'ring-1 ring-white/10',
        !participant.connected && 'opacity-60',
      ]
        .filter(Boolean)
        .join(' ')}
      data-identity={identity}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          // Only the local preview is mirrored; remote video is shown as sent.
          className={`h-full w-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-850 to-ink-900">
          <Avatar
            name={participant.name}
            src={participant.avatarUrl}
            seed={participant.identity}
            size={compact ? 'md' : variant === 'stage' ? 'xl' : 'lg'}
          />
        </div>
      )}

      {/* ----------------------------------------------------- reactions */}
      {myReactions.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center">
          {myReactions.map((reaction) => (
            <span
              key={reaction.id}
              className="animate-[float-up_2.4s_cubic-bezier(0.22,1,0.36,1)_forwards] text-4xl"
              aria-hidden="true"
            >
              {REACTION_EMOJI[reaction.reaction]}
            </span>
          ))}
        </div>
      )}

      {/* --------------------------------------------------- hand raised */}
      {participant.handRaisedAt && (
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-warning-500 px-2 py-1 text-xs font-medium text-ink-950 shadow">
          <Hand className="h-3.5 w-3.5" />
          {!compact && <span>Hand raised</span>}
        </div>
      )}

      {/* -------------------------------------------------- presenting */}
      {participant.screenSharing && variant !== 'stage' && (
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-brand-600 px-2 py-1 text-xs font-medium text-white shadow">
          <ScreenShare className="h-3.5 w-3.5" />
          {!compact && <span>Presenting</span>}
        </div>
      )}

      {/* ------------------------------------------------------ controls */}
      {showControls && !compact && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip label={pinned ? 'Unpin' : 'Pin to main view'}>
            <button
              type="button"
              onClick={() => togglePin(identity)}
              aria-label={pinned ? `Unpin ${participant.name}` : `Pin ${participant.name}`}
              className="rounded-lg bg-ink-950/70 p-1.5 text-white backdrop-blur transition-colors hover:bg-ink-950/90"
            >
              {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
          </Tooltip>

          <Tooltip label="Fullscreen">
            <button
              type="button"
              onClick={() => setFullscreenIdentity(identity)}
              aria-label={`Show ${participant.name} fullscreen`}
              className="rounded-lg bg-ink-950/70 p-1.5 text-white backdrop-blur transition-colors hover:bg-ink-950/90"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
      )}

      {/* --------------------------------------------------- name plate */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-ink-950/85 to-transparent px-2.5 py-2">
        {!participant.micEnabled && (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger-600"
            title={`${participant.name} is muted`}
          >
            <MicOff className="h-3 w-3 text-white" aria-hidden="true" />
            <span className="sr-only">Muted</span>
          </span>
        )}

        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white sm:text-sm">
          {participant.name}
          {isLocal && <span className="text-ink-300"> (you)</span>}
        </span>

        {(participant.role === 'HOST' || participant.role === 'COHOST') && !compact && (
          <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
            {participant.role === 'HOST' ? 'Host' : 'Co-host'}
          </span>
        )}

        <QualityPip quality={quality} connected={participant.connected} />
      </div>

      {!participant.connected && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950/50">
          <span className="rounded-full bg-ink-950/80 px-3 py-1.5 text-xs font-medium text-ink-200">
            Reconnecting…
          </span>
        </div>
      )}
    </div>
  );
});

/**
 * Connection indicator.
 *
 * Deliberately quiet: nothing is drawn while the connection is fine, so the
 * grid stays calm and an icon appearing actually means something.
 */
function QualityPip({
  quality,
  connected,
}: {
  quality: ConnectionQuality | 'unknown' | undefined;
  connected: boolean;
}) {
  if (!connected) {
    return (
      <span title="Reconnecting" className="shrink-0 text-danger-400">
        <WifiOff className="h-3.5 w-3.5" />
        <span className="sr-only">Reconnecting</span>
      </span>
    );
  }

  if (quality === ConnectionQuality.Poor) {
    return (
      <span title="Poor connection" className="shrink-0 text-danger-400">
        <SignalLow className="h-3.5 w-3.5" />
        <span className="sr-only">Poor connection</span>
      </span>
    );
  }

  if (quality === ConnectionQuality.Good) {
    return (
      <span title="Good connection" className="shrink-0 text-warning-400">
        <SignalMedium className="h-3.5 w-3.5" />
        <span className="sr-only">Good connection</span>
      </span>
    );
  }

  return null;
}
