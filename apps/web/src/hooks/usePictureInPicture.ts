'use client';

import { useCallback, useEffect, useState } from 'react';
import { capabilities } from '@/lib/capabilities';

export interface PictureInPictureState {
  /** The browser can do this at all. */
  supported: boolean;
  /** A floating window is open right now. */
  active: boolean;
  /** There is a video worth putting in it. */
  available: boolean;
  /** Why it cannot be used, already written for an end user, or null. */
  reason: string | null;
  toggle: () => Promise<void>;
}

/**
 * Picture-in-picture, as a piece of state rather than a fire-and-forget call.
 *
 * The previous version was a single function that found a video and asked for
 * PiP. That left three things wrong, all of which show up as "the button does
 * nothing": the control never knew a window was already open, so it could not
 * close one; closing the floating window from the browser's own chrome left
 * the app believing it was still open; and with every camera off there was no
 * video to promote, which looked identical to a broken button.
 *
 * Tracking the state means the control can say what it will do, reflect what
 * is happening, and explain itself when it cannot.
 */
export function usePictureInPicture(): PictureInPictureState {
  const [active, setActive] = useState(false);
  const [available, setAvailable] = useState(false);

  const supported = typeof document !== 'undefined' && capabilities().pictureInPicture;

  /**
   * Whether any video is actually producing frames.
   *
   * Polled rather than derived from the participant list, because what matters
   * is a decoded `<video>` with real dimensions — a camera that is "on"
   * according to the roster but has not produced a frame yet cannot go into a
   * floating window.
   */
  useEffect(() => {
    if (!supported) return;

    function scan() {
      setAvailable(Boolean(bestVideo()));
    }

    scan();
    const timer = window.setInterval(scan, 2000);
    return () => window.clearInterval(timer);
  }, [supported]);

  // The window can be closed from the browser's own chrome, which the app only
  // hears about through these events.
  useEffect(() => {
    if (!supported) return;

    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);

    document.addEventListener('enterpictureinpicture', onEnter, true);
    document.addEventListener('leavepictureinpicture', onLeave, true);
    setActive(Boolean(document.pictureInPictureElement));

    return () => {
      document.removeEventListener('enterpictureinpicture', onEnter, true);
      document.removeEventListener('leavepictureinpicture', onLeave, true);
    };
  }, [supported]);

  // Leaving the meeting should not strand a floating window of it.
  useEffect(() => {
    return () => {
      if (typeof document !== 'undefined' && document.pictureInPictureElement) {
        void document.exitPictureInPicture().catch(() => undefined);
      }
    };
  }, []);

  const toggle = useCallback(async () => {
    if (!supported) return;

    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => undefined);
      return;
    }

    const target = bestVideo();
    if (!target) return;

    try {
      await target.requestPictureInPicture();
    } catch {
      // Usually the user dismissing the prompt, or the element being replaced
      // mid-request. Either way the state listeners keep `active` honest.
    }
  }, [supported]);

  const reason = !supported
    ? 'Picture-in-picture is not supported in this browser.'
    : !available && !active
      ? 'Nobody has their camera on yet, so there is nothing to float.'
      : null;

  return { supported, active, available, reason, toggle };
}

/**
 * The video most worth floating.
 *
 * Largest first, which is the stage or the screen share rather than a
 * filmstrip thumbnail — the same thing the eye would pick.
 */
function bestVideo(): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null;

  const candidates = [...document.querySelectorAll('video')].filter(
    (video) => video.readyState >= 2 && video.videoWidth > 0 && !video.disablePictureInPicture,
  );

  return candidates.sort((a, b) => b.videoWidth - a.videoWidth)[0] ?? null;
}
