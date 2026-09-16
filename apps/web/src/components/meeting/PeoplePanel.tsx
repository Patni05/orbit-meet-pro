'use client';

import type { RoomParticipant } from '@orbit/shared';
import {
  Check,
  Hand,
  MicOff,
  MoreHorizontal,
  ScreenShareOff,
  ShieldBan,
  ShieldCheck,
  Star,
  ShieldMinus,
  UserMinus,
  Video,
  VideoOff,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, Button } from '@/components/ui/primitives';
import { meetingClient } from '@/lib/meeting-client';
import { raisedHandsFrom, useRoomStore } from '@/lib/room-store';

/**
 * People panel.
 *
 * Shows the waiting room (hosts only), raised hands in the order they went up,
 * and the roster. Every host control here is a *request* to the server, which
 * re-checks the caller's role before acting — the menu being visible is not
 * what grants the power.
 */
export function PeoplePanel() {
  const order = useRoomStore((state) => state.order);
  const participants = useRoomStore((state) => state.participants);
  const waiting = useRoomStore((state) => state.waiting);
  const selfIdentity = useRoomStore((state) => state.selfIdentity);
  const selfRole = useRoomStore((state) => state.selfRole);
  // Derived from an already-subscribed slice and memoised: see raisedHandsFrom.
  const raisedHands = useMemo(() => raisedHandsFrom(participants), [participants]);

  const isHost = selfRole === 'HOST' || selfRole === 'COHOST';
  const isOwner = selfRole === 'HOST';

  const roster = useMemo(
    () =>
      order
        .map((identity) => participants[identity])
        .filter((p): p is RoomParticipant => Boolean(p))
        .sort((a, b) => {
          // Hosts first, then co-hosts, then everyone by join time.
          const rank = (p: RoomParticipant) => (p.role === 'HOST' ? 0 : p.role === 'COHOST' ? 1 : 2);
          return rank(a) - rank(b) || new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
        }),
    [order, participants],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim">
      {/* -------------------------------------------------- waiting room */}
      {isHost && waiting.length > 0 && (
        <section className="border-b border-white/10 p-4" aria-label="Waiting room">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-100">
              Waiting to join
              <span className="ml-2 rounded-full bg-warning-500 px-1.5 py-0.5 text-[11px] font-semibold text-ink-950">
                {waiting.length}
              </span>
            </h3>
            {waiting.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => void meetingClient.admitAll()}>
                Admit all
              </Button>
            )}
          </div>

          <ul className="mt-3 space-y-2">
            {waiting.map((person) => (
              <li key={person.participantId} className="flex items-center gap-2.5">
                <Avatar name={person.name} src={person.avatarUrl} seed={person.identity} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-200">{person.name}</span>
                <button
                  type="button"
                  onClick={() => void meetingClient.reject(person.participantId)}
                  aria-label={`Decline ${person.name}`}
                  className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-white/10 hover:text-danger-400"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void meetingClient.admit(person.participantId)}
                  aria-label={`Admit ${person.name}`}
                  className="rounded-lg bg-brand-600 p-1.5 text-white transition-colors hover:bg-brand-500"
                >
                  <Check className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------------------------- raised hands */}
      {raisedHands.length > 0 && (
        <section className="border-b border-white/10 p-4" aria-label="Raised hands">
          <h3 className="text-sm font-semibold text-ink-100">
            Raised hands
            <span className="ml-2 text-xs font-normal text-ink-400">in order</span>
          </h3>
          <ol className="mt-3 space-y-2">
            {raisedHands.map((person, index) => (
              <li key={person.identity} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-500 text-xs font-semibold text-ink-950">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-200">
                  {person.identity === selfIdentity ? 'You' : person.name}
                </span>
                {isHost && (
                  <button
                    type="button"
                    onClick={() => void meetingClient.lowerHand(person.identity)}
                    className="rounded-lg px-2 py-1 text-xs text-ink-400 transition-colors hover:bg-white/10 hover:text-ink-100"
                  >
                    Lower
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* --------------------------------------------------- host actions */}
      {isHost && (
        <div className="border-b border-white/10 p-4">
          <Button variant="secondary" size="sm" fullWidth onClick={() => void meetingClient.muteEveryone()}>
            <MicOff className="h-4 w-4" />
            Mute everyone
          </Button>
        </div>
      )}

      {/* --------------------------------------------------------- roster */}
      <section className="p-4" aria-label="Participants">
        <h3 className="text-sm font-semibold text-ink-100">
          In the meeting
          <span className="ml-2 text-xs font-normal text-ink-400">{roster.length}</span>
        </h3>

        <ul className="mt-3 space-y-1">
          {roster.map((person) => (
            <PersonRow
              key={person.identity}
              person={person}
              isSelf={person.identity === selfIdentity}
              canModerate={isHost && person.role !== 'HOST'}
              canChangeRole={isOwner && person.role !== 'HOST'}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function PersonRow({
  person,
  isSelf,
  canModerate,
  canChangeRole,
}: {
  person: RoomParticipant;
  isSelf: boolean;
  canModerate: boolean;
  canChangeRole: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const spotlighted = useRoomStore((state) => state.spotlight.includes(person.identity));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const item =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-100 transition-colors hover:bg-white/10';

  return (
    <li className="group relative flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-white/5">
      <Avatar name={person.name} src={person.avatarUrl} seed={person.identity} size="sm" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink-100">
          {person.name}
          {isSelf && <span className="text-ink-400"> (you)</span>}
        </p>
        {(person.role === 'HOST' || person.role === 'COHOST' || person.isGuest) && (
          <div className="mt-0.5 flex gap-1">
            {person.role === 'HOST' && <Badge tone="warning">Host</Badge>}
            {person.role === 'COHOST' && <Badge tone="brand">Co-host</Badge>}
            {person.isGuest && <Badge>Guest</Badge>}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 text-ink-400">
        {/*
          * These icons carry information that exists nowhere else in the row,
          * so each one needs `role="img"` alongside its label: an aria-label on
          * a bare <svg> is not reliably exposed, which would leave a screen
          * reader user unable to tell who is muted.
          */}
        {person.handRaisedAt && (
          <Hand className="h-4 w-4 text-warning-400" role="img" aria-label="Hand raised" />
        )}
        {person.screenSharing && (
          <Video className="h-4 w-4 text-brand-400" role="img" aria-label="Presenting" />
        )}
        {person.micEnabled ? (
          <Volume2 className="h-4 w-4" role="img" aria-label="Microphone on" />
        ) : (
          <MicOff className="h-4 w-4 text-danger-400" role="img" aria-label="Muted" />
        )}
        {!person.cameraEnabled && <VideoOff className="h-4 w-4" role="img" aria-label="Camera off" />}

        {(canModerate || canChangeRole) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`Options for ${person.name}`}
              aria-expanded={menuOpen}
              className="rounded-lg p-1 opacity-0 transition-opacity hover:bg-white/10 focus:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-white/10 bg-ink-850 p-1.5 shadow-2xl"
              >
                {canModerate && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className={item}
                      disabled={!person.micEnabled}
                      onClick={() => {
                        void meetingClient.muteParticipant(person.identity, 'audio');
                        setMenuOpen(false);
                      }}
                    >
                      <MicOff className="h-4 w-4" />
                      Mute microphone
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className={item}
                      onClick={() => {
                        void meetingClient.requestUnmute(person.identity);
                        setMenuOpen(false);
                      }}
                    >
                      <Volume2 className="h-4 w-4" />
                      Ask to unmute
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      className={item}
                      disabled={!person.cameraEnabled}
                      onClick={() => {
                        void meetingClient.muteParticipant(person.identity, 'video');
                        setMenuOpen(false);
                      }}
                    >
                      <VideoOff className="h-4 w-4" />
                      Turn off camera
                    </button>

                    {person.screenSharing && (
                      <button
                        type="button"
                        role="menuitem"
                        className={item}
                        onClick={() => {
                          void meetingClient.stopShare(person.identity);
                          setMenuOpen(false);
                        }}
                      >
                        <ScreenShareOff className="h-4 w-4" />
                        Stop their presentation
                      </button>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      className={item}
                      onClick={() => {
                        void meetingClient.setSpotlight(person.identity, !spotlighted);
                        setMenuOpen(false);
                      }}
                    >
                      <Star
                        className={`h-4 w-4 ${spotlighted ? 'fill-warning-400 text-warning-400' : ''}`}
                      />
                      {spotlighted ? 'Remove spotlight' : 'Spotlight for everyone'}
                    </button>

                    {person.handRaisedAt && (
                      <button
                        type="button"
                        role="menuitem"
                        className={item}
                        onClick={() => {
                          void meetingClient.lowerHand(person.identity);
                          setMenuOpen(false);
                        }}
                      >
                        <Hand className="h-4 w-4" />
                        Lower their hand
                      </button>
                    )}
                  </>
                )}

                {canChangeRole && (
                  <>
                    <div className="my-1 h-px bg-white/10" />
                    <button
                      type="button"
                      role="menuitem"
                      className={item}
                      onClick={() => {
                        void meetingClient.setRole(
                          person.identity,
                          person.role === 'COHOST' ? 'PARTICIPANT' : 'COHOST',
                        );
                        setMenuOpen(false);
                      }}
                    >
                      {person.role === 'COHOST' ? (
                        <>
                          <ShieldMinus className="h-4 w-4" />
                          Remove co-host
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4" />
                          Make co-host
                        </>
                      )}
                    </button>
                  </>
                )}

                {canModerate && (
                  <>
                    <div className="my-1 h-px bg-white/10" />
                    <button
                      type="button"
                      role="menuitem"
                      className={`${item} text-danger-400 hover:bg-danger-500/15`}
                      onClick={() => {
                        void meetingClient.removeParticipant(person.identity);
                        setMenuOpen(false);
                      }}
                    >
                      <UserMinus className="h-4 w-4" />
                      Remove from meeting
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`${item} text-danger-400 hover:bg-danger-500/15`}
                      onClick={() => {
                        void meetingClient.blockParticipant(person.identity);
                        setMenuOpen(false);
                      }}
                    >
                      <ShieldBan className="h-4 w-4" />
                      Block from this meeting
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
