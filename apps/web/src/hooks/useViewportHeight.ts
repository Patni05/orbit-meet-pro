'use client';

import { useEffect, useState } from 'react';

export interface ViewportState {
  /** Height of the area actually visible to the user, in pixels. */
  height: number;
  /** Pixels currently hidden at the bottom, i.e. the on-screen keyboard. */
  keyboardInset: number;
  /** True once the keyboard is taking a meaningful share of the screen. */
  keyboardOpen: boolean;
}

/**
 * Tracks the *visual* viewport and publishes it as `--app-height`.
 *
 * This exists because of the on-screen keyboard. `100vh` is the largest the
 * viewport ever gets and never shrinks; `100dvh` follows browser chrome like a
 * collapsing URL bar but, on both Android Chrome and iOS Safari, does **not**
 * shrink when the keyboard opens. So a full-height meeting shell keeps its
 * full height, the keyboard is laid over the bottom of it, and the chat
 * composer — the one element the user is typing into — ends up underneath the
 * keyboard, unreachable. That was the mobile chat bug.
 *
 * `visualViewport` is the only API that reports the truth here, and it fires
 * `resize` when the keyboard opens and `scroll` when the page is panned with
 * the keyboard up. Publishing the result as a CSS variable keeps the fix in
 * one place: any element that needs the real height uses `var(--app-height)`
 * instead of a viewport unit.
 *
 * On a browser without `visualViewport` the variable is simply never set and
 * every consumer falls back to `100dvh`, which is the current behaviour.
 */
/**
 * How many components are currently relying on the published variables.
 *
 * The meeting shell and any open dialog both want them, and whichever
 * unmounted first used to delete the properties out from under the other —
 * collapsing the survivor back to the layout viewport mid-interaction. The
 * variables are only cleared once the last consumer has gone.
 */
let consumers = 0;

export function useViewportHeight(): ViewportState {
  const [state, setState] = useState<ViewportState>({
    height: 0,
    keyboardInset: 0,
    keyboardOpen: false,
  });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    consumers += 1;

    let frame = 0;

    function apply() {
      // The events can fire many times per keyboard animation frame; one
      // measurement per paint is enough and keeps layout thrash out of it.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const vp = window.visualViewport;
        if (!vp) return;

        const height = Math.round(vp.height);
        // `offsetTop` matters when the page has been panned: the keyboard
        // inset is what is hidden below the visible area, not simply the
        // difference in heights.
        const inset = Math.max(0, Math.round(window.innerHeight - height - vp.offsetTop));

        document.documentElement.style.setProperty('--app-height', `${height}px`);
        document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);

        setState({
          height,
          keyboardInset: inset,
          // A URL bar collapsing is worth tens of pixels; a keyboard is worth
          // hundreds. The threshold keeps ordinary chrome changes from being
          // mistaken for a keyboard.
          keyboardOpen: inset > 120,
        });
      });
    }

    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);

      consumers -= 1;
      if (consumers > 0) return;

      document.documentElement.style.removeProperty('--app-height');
      document.documentElement.style.removeProperty('--keyboard-inset');
    };
  }, []);

  return state;
}
