'use client';

import type { Track } from 'livekit-client';
import { useEffect, useRef } from 'react';

/**
 * Binds a LiveKit track to a media element.
 *
 * Attaching is a DOM operation, not a render — so the element is held in a ref
 * and the track is attached in an effect. Detaching on cleanup is what stops a
 * participant's video from leaking memory when their tile unmounts.
 */
export function useTrackElement<T extends HTMLMediaElement>(track: Track | undefined | null) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !track) return;

    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return ref;
}

/**
 * Plays a remote audio track.
 *
 * Audio elements are rendered once per participant and kept out of the video
 * tile, so a tile re-render or a layout change never interrupts sound.
 */
export function useAudioElement(track: Track | undefined | null, outputDeviceId?: string) {
  const ref = useTrackElement<HTMLAudioElement>(track);

  useEffect(() => {
    const element = ref.current;
    if (!element || !outputDeviceId) return;

    const withSink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (typeof withSink.setSinkId !== 'function') return;

    void withSink.setSinkId(outputDeviceId).catch(() => undefined);
  }, [ref, outputDeviceId]);

  return ref;
}
