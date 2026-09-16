'use client';

import { extractMeetingCode, type JoinOutcome, type MeetingPreview } from '@orbit/shared';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MeetingRoom } from '@/components/meeting/MeetingRoom';
import { PreJoin, type PreJoinResult } from '@/components/meeting/PreJoin';
import {
  MeetingEndedScreen,
  MeetingProblemScreen,
  RoomLoadingScreen,
  WaitingRoomScreen,
} from '@/components/meeting/RoomStates';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { meetingClient } from '@/lib/meeting-client';
import { useRoomStore } from '@/lib/room-store';

type Stage = 'loading' | 'prejoin' | 'joining' | 'waiting' | 'meeting' | 'problem';

/**
 * Stable per-tab session id.
 *
 * Kept in sessionStorage, so it survives a page refresh but is unique per tab.
 * The server uses it to resume the same participant row instead of creating a
 * second one — this is what stops a refresh from cloning you in the roster.
 */
function sessionIdFor(code: string): string {
  const key = `orbit.session.${code}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    // Private mode with storage disabled: a fresh id per load still works,
    // it just cannot resume across a refresh.
    return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

/** Remembers that this tab was in the meeting, so a refresh can go straight back in. */
const rejoinKey = (code: string) => `orbit.rejoin.${code}`;

interface RejoinHint {
  displayName: string;
  avatarUrl: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  audioOutputId?: string;
}

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = extractMeetingCode(rawCode ?? '') ?? '';

  const user = useAuthStore((state) => state.user);
  const authReady = useAuthStore((state) => state.ready);

  const phase = useRoomStore((state) => state.phase);
  const storeError = useRoomStore((state) => state.errorMessage);
  const endedBy = useRoomStore((state) => state.endedBy);
  const meeting = useRoomStore((state) => state.meeting);
  const participantCount = useRoomStore((state) => state.order.length);
  const resetRoom = useRoomStore((state) => state.reset);

  const [stage, setStage] = useState<Stage>('loading');
  const [preview, setPreview] = useState<MeetingPreview | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ kind: 'not-found' | 'locked' | 'rejected' | 'error'; message?: string } | null>(
    null,
  );
  const [devices, setDevices] = useState<{
    audioDeviceId?: string;
    videoDeviceId?: string;
    audioOutputId?: string;
  }>({});
  const [leftReason, setLeftReason] = useState<'left' | 'ended' | 'removed' | null>(null);
  const [meetingStartedAt, setMeetingStartedAt] = useState<number | null>(null);

  /** Guards the automatic rejoin so a failing restore cannot loop. */
  const autoRejoinAttempted = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --------------------------------------------------------------- preview

  const loadPreview = useCallback(async () => {
    if (!code) {
      setProblem({ kind: 'not-found' });
      setStage('problem');
      return;
    }

    try {
      const { meeting: found } = await api.meetings.preview(code);
      if (!mountedRef.current) return;

      setPreview(found);

      if (found.status === 'ENDED' || found.status === 'CANCELLED') {
        setLeftReason('ended');
        setStage('problem');
        setProblem(null);
        return;
      }

      setStage('prejoin');
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof ApiError && error.status === 404) {
        setProblem({ kind: 'not-found' });
      } else {
        setProblem({
          kind: 'error',
          message: error instanceof ApiError ? error.message : undefined,
        });
      }
      setStage('problem');
    }
  }, [code]);

  useEffect(() => {
    // Wait for auth hydration: whether the caller is signed in changes their
    // role and whether a waiting room applies to them.
    if (!authReady) return;
    void loadPreview();
  }, [authReady, loadPreview]);

  // ------------------------------------------------------------------ join

  const performJoin = useCallback(
    async (result: PreJoinResult, options: { silent?: boolean } = {}) => {
      if (!code) return;

      setJoinError(null);
      setStage('joining');
      setDevices({
        audioDeviceId: result.audioDeviceId,
        videoDeviceId: result.videoDeviceId,
        audioOutputId: result.audioOutputId,
      });

      try {
        const outcome: JoinOutcome = await api.meetings.join(code, {
          displayName: result.displayName,
          avatarUrl: result.avatarUrl,
          password: result.password,
          sessionId: sessionIdFor(code),
        });

        if (!mountedRef.current) return;

        if (outcome.outcome === 'ENDED') {
          setLeftReason('ended');
          setStage('problem');
          return;
        }

        if (outcome.outcome === 'LOCKED') {
          setProblem({ kind: 'locked' });
          setStage('problem');
          return;
        }

        if (outcome.outcome === 'REJECTED') {
          setProblem({ kind: 'rejected', message: outcome.reason });
          setStage('problem');
          return;
        }

        if (outcome.outcome === 'WAITING') {
          setStage('waiting');
          // Only the control channel is opened; no media until admitted.
          meetingClient.connectRealtimeOnly(outcome.sessionToken, {
            onAdmitted: () => {
              // Admission means re-running the join, which now returns a ticket.
              void performJoin(result, { silent: true });
            },
            onRejected: (reason) => {
              setProblem({ kind: 'rejected', message: reason });
              setStage('problem');
            },
          });
          return;
        }

        // ---- admitted ----
        await meetingClient.connect(outcome.ticket, {
          micEnabled: result.micEnabled,
          cameraEnabled: result.cameraEnabled,
          audioDeviceId: result.audioDeviceId,
          videoDeviceId: result.videoDeviceId,
          callbacks: {
            onEnded: () => setLeftReason('ended'),
            onRemoved: () => setLeftReason('removed'),
          },
        });

        if (!mountedRef.current) {
          await meetingClient.teardown();
          return;
        }

        setMeetingStartedAt(Date.now());
        setStage('meeting');

        // Remember the choices so a refresh can go straight back in.
        try {
          const hint: RejoinHint = {
            displayName: result.displayName,
            avatarUrl: result.avatarUrl,
            micEnabled: result.micEnabled,
            cameraEnabled: result.cameraEnabled,
            audioDeviceId: result.audioDeviceId,
            videoDeviceId: result.videoDeviceId,
            audioOutputId: result.audioOutputId,
          };
          sessionStorage.setItem(rejoinKey(code), JSON.stringify(hint));
        } catch {
          // Non-essential.
        }
      } catch (error) {
        if (!mountedRef.current) return;

        const message =
          error instanceof ApiError
            ? error.message
            : 'Could not join the meeting. Check your connection and try again.';

        // A failed silent restore falls back to the pre-join screen rather than
        // retrying forever.
        if (options.silent) {
          setJoinError(message);
          setStage('prejoin');
          return;
        }

        setJoinError(message);
        setStage('prejoin');
      }
    },
    [code],
  );

  /**
   * Refresh recovery.
   *
   * If this tab was already in the meeting, rejoin without asking again — but
   * exactly once, so a persistent failure lands on the pre-join screen instead
   * of an endless loop.
   */
  useEffect(() => {
    if (stage !== 'prejoin' || autoRejoinAttempted.current || !preview) return;

    let hint: RejoinHint | null = null;
    try {
      const raw = sessionStorage.getItem(rejoinKey(code));
      if (raw) hint = JSON.parse(raw) as RejoinHint;
    } catch {
      hint = null;
    }

    if (!hint) return;

    autoRejoinAttempted.current = true;
    void performJoin(
      {
        displayName: hint.displayName,
        avatarUrl: hint.avatarUrl ?? null,
        micEnabled: hint.micEnabled,
        cameraEnabled: hint.cameraEnabled,
        audioDeviceId: hint.audioDeviceId,
        videoDeviceId: hint.videoDeviceId,
        audioOutputId: hint.audioOutputId,
      },
      { silent: true },
    );
  }, [stage, preview, code, performJoin]);

  // ------------------------------------------------- server-driven endings

  useEffect(() => {
    if (phase === 'ended') setLeftReason('ended');
    if (phase === 'removed') setLeftReason('removed');
  }, [phase]);

  // Release devices and connections when navigating away.
  useEffect(
    () => () => {
      void meetingClient.teardown();
      resetRoom();
    },
    [resetRoom],
  );

  // ----------------------------------------------------------------- leave

  const leave = useCallback(
    async (mode: 'leave' | 'end') => {
      try {
        if (mode === 'end') {
          await meetingClient.endForEveryone();
          setLeftReason('ended');
        } else {
          setLeftReason('left');
        }
      } finally {
        await meetingClient.teardown({ notifyServer: true });
        try {
          sessionStorage.removeItem(rejoinKey(code));
        } catch {
          // Nothing to clean up.
        }
        setStage('problem');
      }
    },
    [code],
  );

  const cancelWaiting = useCallback(async () => {
    await meetingClient.teardown({ notifyServer: true });
    router.push('/');
  }, [router]);

  // ----------------------------------------------------------------- views

  const durationSeconds = meetingStartedAt ? Math.round((Date.now() - meetingStartedAt) / 1000) : null;

  if (leftReason) {
    return (
      <MeetingEndedScreen
        reason={leftReason}
        meetingTitle={meeting?.title ?? preview?.title}
        endedBy={endedBy}
        durationSeconds={durationSeconds}
        participantCount={participantCount || undefined}
        canRejoin={leftReason === 'left'}
        onRejoin={() => {
          resetRoom();
          setLeftReason(null);
          autoRejoinAttempted.current = true; // ask again rather than silently rejoining
          setStage('prejoin');
        }}
      />
    );
  }

  if (stage === 'problem' && problem) {
    return (
      <MeetingProblemScreen
        kind={problem.kind}
        message={problem.message}
        onRetry={
          problem.kind === 'locked' || problem.kind === 'error'
            ? () => {
                setProblem(null);
                setStage('loading');
                void loadPreview();
              }
            : undefined
        }
      />
    );
  }

  if (stage === 'loading' || !authReady) return <RoomLoadingScreen />;

  if (stage === 'waiting' && preview) {
    return (
      <WaitingRoomScreen
        meetingTitle={preview.title}
        hostName={preview.hostName}
        onCancel={() => void cancelWaiting()}
      />
    );
  }

  if (stage === 'meeting') {
    return (
      <MeetingRoom
        devices={devices}
        onDevicesChange={(patch) => setDevices((current) => ({ ...current, ...patch }))}
        onLeave={(mode) => void leave(mode)}
      />
    );
  }

  if (preview) {
    return (
      <PreJoin
        meeting={preview}
        defaultName={user?.name ?? ''}
        passwordRequired={preview.hasPassword}
        joining={stage === 'joining'}
        joinError={joinError ?? storeError}
        onJoin={(result) => void performJoin(result)}
        onCancel={() => router.push(user ? '/dashboard' : '/')}
      />
    );
  }

  return <RoomLoadingScreen />;
}
