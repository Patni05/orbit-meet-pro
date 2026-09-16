'use client';

import { Hand, ShieldQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { meetingClient } from '@/lib/meeting-client';
import { useRoomStore } from '@/lib/room-store';

/**
 * The presence check, from the participant's side.
 *
 * Two separate things, deliberately kept apart:
 *
 * The *consent* question is asked once, by this component, and answered by the
 * participant. Until they say yes, a host cannot even send them a check — the
 * gateway refuses `host:presence-request` for anyone whose state is not
 * ALLOWED. Saying no is a real answer that sticks, not a dismissal.
 *
 * The *check* itself is a prompt with a countdown that the participant answers
 * by tapping a button. Nothing is read from their device: no camera is
 * started, no photo is taken, no sensor is sampled. A presence check here
 * means "are you still at your desk?", answered by a person, which is the only
 * version of this that does not amount to spying on them.
 *
 * A check that is ignored simply expires. That is a legitimate outcome and it
 * is recorded as EXPIRED rather than escalated — the participant is never
 * removed or muted for not answering.
 */
export function PresencePrompt() {
  const request = useRoomStore((state) => state.presenceRequest);
  const presenceCheck = useRoomStore((state) => state.presenceCheck);
  const setPresenceCheck = useRoomStore((state) => state.setPresenceCheck);

  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);

  // Countdown for an outstanding check.
  useEffect(() => {
    if (!request) return;

    function tick() {
      const left = Math.max(0, new Date(request!.expiresAt).getTime() - Date.now());
      setRemaining(Math.ceil(left / 1000));
      // The server expires it too; this just stops showing a dead prompt.
      if (left <= 0) setPresenceCheck('EXPIRED');
    }

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [request, setPresenceCheck]);

  // ------------------------------------------------------- consent, once

  if (presenceCheck === 'NOT_ASKED') {
    return (
      <Sheet>
        <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-brand-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-100">Allow presence checks?</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            The host may occasionally ask you to confirm you are still here. You answer by tapping a
            button — your camera and microphone are never touched.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void meetingClient.setPresenceConsent(true).finally(() => setBusy(false));
              }}
              className="h-9 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
            >
              Allow
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void meetingClient.setPresenceConsent(false).finally(() => setBusy(false));
              }}
              className="h-9 rounded-lg bg-white/10 px-3 text-xs font-medium text-ink-100 transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              No thanks
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  // ------------------------------------------------------ an active check

  if (!request || presenceCheck !== 'REQUESTED') return null;

  return (
    <Sheet urgent>
      <Hand className="mt-0.5 h-5 w-5 shrink-0 text-warning-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-100">
          {request.by} is checking who is still here
        </p>
        <p className="mt-1 text-xs text-ink-400">
          Confirm within{' '}
          <span className="font-medium tabular-nums text-warning-300">{remaining}s</span>. Nothing
          happens if you miss it.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void meetingClient.confirmPresence().finally(() => setBusy(false));
          }}
          className="mt-3 h-10 w-full rounded-lg bg-warning-500 text-sm font-semibold text-ink-950 transition-colors hover:bg-warning-400 disabled:opacity-50"
        >
          I&rsquo;m here
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Sits above the control bar rather than over it, so the prompt can never
 * cover Mute or Leave — the two controls a person must always be able to reach.
 */
function Sheet({ children, urgent = false }: { children: React.ReactNode; urgent?: boolean }) {
  return (
    <div
      role={urgent ? 'alertdialog' : 'dialog'}
      aria-live={urgent ? 'assertive' : 'polite'}
      className={`pointer-events-auto fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-sm items-start gap-3 rounded-2xl border p-3.5 shadow-2xl backdrop-blur-xl animate-[fade-in_0.18s_ease-out] sm:bottom-24 ${
        urgent ? 'border-warning-500/40 bg-ink-900/95' : 'border-white/10 bg-ink-900/95'
      }`}
    >
      {children}
    </div>
  );
}
