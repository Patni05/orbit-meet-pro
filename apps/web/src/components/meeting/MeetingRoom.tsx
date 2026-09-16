'use client';

import { formatMeetingCode, type ReactionKey } from '@orbit/shared';
import { Circle, Lock, Minimize2, ShieldCheck, UserPlus, WifiOff, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useTrackElement } from '@/hooks/useTrackElement';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMeetingTimer } from '@/hooks/useMeetingTimer';
import { capabilities } from '@/lib/capabilities';
import { meetingClient } from '@/lib/meeting-client';
import { selectIsHost, useRoomStore } from '@/lib/room-store';
import { AnnouncementBanner } from './AnnouncementBanner';
import { AudioRenderer } from './AudioRenderer';
import { CommandPalette, type Command } from './CommandPalette';
import { ControlBar } from './ControlBar';
import { InviteDialog } from './InviteDialog';
import { NoticeStack } from './NoticeStack';
import { ReactionOverlay } from './ReactionOverlay';
import { VideoGrid } from './VideoGrid';
import { AnnounceDialog, LeaveDialog, RecordingDialog, SettingsDialog, ShortcutsDialog } from './dialogs';

/**
 * Side panels are loaded on demand: chat, people and diagnostics are not part
 * of the first paint, so getting into a meeting stays fast.
 */
const ChatPanel = lazy(() => import('./ChatPanel').then((m) => ({ default: m.ChatPanel })));
const PeoplePanel = lazy(() => import('./PeoplePanel').then((m) => ({ default: m.PeoplePanel })));
const InfoPanel = lazy(() => import('./InfoPanel').then((m) => ({ default: m.InfoPanel })));
const PollsPanel = lazy(() => import('./PollsPanel').then((m) => ({ default: m.PollsPanel })));
const QuizPanel = lazy(() => import('./QuizPanel').then((m) => ({ default: m.QuizPanel })));
const WhiteboardPanel = lazy(() => import('./WhiteboardPanel').then((m) => ({ default: m.WhiteboardPanel })));
const BlocklistPanel = lazy(() => import('./BlocklistPanel').then((m) => ({ default: m.BlocklistPanel })));
const DiagnosticsPanel = lazy(() =>
  import('./DiagnosticsPanel').then((m) => ({ default: m.DiagnosticsPanel })),
);

export function MeetingRoom({
  devices,
  onDevicesChange,
  onLeave,
}: {
  devices: { audioDeviceId?: string; videoDeviceId?: string; audioOutputId?: string };
  onDevicesChange: (patch: {
    audioDeviceId?: string;
    videoDeviceId?: string;
    audioOutputId?: string;
  }) => void;
  onLeave: (mode: 'leave' | 'end') => void;
}) {
  const meeting = useRoomStore((state) => state.meeting);
  const phase = useRoomStore((state) => state.phase);
  const panel = useRoomStore((state) => state.panel);
  const setPanel = useRoomStore((state) => state.setPanel);
  const micEnabled = useRoomStore((state) => state.micEnabled);
  const cameraEnabled = useRoomStore((state) => state.cameraEnabled);
  const screenSharing = useRoomStore((state) => state.screenSharing);
  const handRaised = useRoomStore((state) => state.handRaised);
  const recording = useRoomStore((state) => state.recording);
  const isHost = useRoomStore(selectIsHost);
  const notify = useRoomStore((state) => state.notify);
  const serverOffset = useRoomStore((state) => state.serverTimeOffsetMs);
  const fullscreenIdentity = useRoomStore((state) => state.fullscreenIdentity);
  const focusMode = useRoomStore((state) => state.focusMode);
  const toggleFocusMode = useRoomStore((state) => state.toggleFocusMode);

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const elapsed = useMeetingTimer(meeting?.startedAt ?? null, serverOffset);

  // ---------------------------------------------------------------- actions

  const toggleMic = useCallback(() => {
    void meetingClient.setMicrophone(!micEnabled, devices.audioDeviceId).catch(() => {
      notify('error', 'Your microphone could not be started. Check that no other app is using it.');
    });
  }, [micEnabled, devices.audioDeviceId, notify]);

  const toggleCamera = useCallback(() => {
    void meetingClient.setCamera(!cameraEnabled, devices.videoDeviceId).catch(() => {
      notify('error', 'Your camera could not be started. Check that no other app is using it.');
    });
  }, [cameraEnabled, devices.videoDeviceId, notify]);

  const toggleScreen = useCallback(() => {
    void (async () => {
      const result = await meetingClient.setScreenShare(!screenSharing);
      // Cancelling the browser's picker is a normal choice, not an error.
      if (!result.ok && !result.cancelled && result.message) notify('error', result.message);
    })();
  }, [screenSharing, notify]);

  const toggleHand = useCallback(() => {
    meetingClient.setHandRaised(!handRaised);
  }, [handRaised]);

  /**
   * Picture-in-picture.
   *
   * Puts the current speaker's video into the browser's floating window so the
   * meeting stays visible while the user works in another tab. Audio is
   * unaffected: it plays through the page's own audio elements, which keep
   * running regardless of where the video is rendered.
   *
   * Only offered where the browser actually supports it — Firefox and iOS
   * Safari do not expose this API, and a button that silently fails is worse
   * than no button.
   */
  const enterPictureInPicture = useCallback(async () => {
    if (!capabilities().pictureInPicture) {
      notify('warn', 'This browser does not support picture-in-picture.');
      return;
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }

      // Pick the largest playing video, which is the speaker or the screen
      // share rather than a thumbnail in the filmstrip.
      const candidates = [...document.querySelectorAll('video')].filter(
        (video) => video.readyState >= 2 && video.videoWidth > 0,
      );
      const target = candidates.sort((a, b) => b.videoWidth - a.videoWidth)[0];

      if (!target) {
        notify('warn', 'Nobody has their camera on yet.');
        return;
      }

      await target.requestPictureInPicture();
    } catch {
      // A rejection here is usually the user dismissing the prompt.
      notify('warn', 'Picture-in-picture could not be started.');
    }
  }, [notify]);

  const sendReaction = useCallback((reaction: ReactionKey) => {
    meetingClient.sendReaction(reaction);
  }, []);

  const shortcuts = useMemo(
    () => ({
      toggleMic,
      toggleCamera,
      toggleShare: toggleScreen,
      toggleHand,
      toggleChat: () => setPanel(panel === 'chat' ? null : 'chat'),
      togglePeople: () => setPanel(panel === 'people' ? null : 'people'),
      toggleHelp: () => setShortcutsOpen((v) => !v),
      leave: () => setLeaveOpen(true),
    }),
    [toggleMic, toggleCamera, toggleScreen, toggleHand, panel, setPanel],
  );

  useKeyboardShortcuts(shortcuts, !leaveOpen && !settingsOpen && !shortcutsOpen && !shareOpen);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * Palette commands.
   *
   * Each one calls the same function its button calls, so the two can never
   * disagree. Host-only entries are filtered out entirely rather than shown
   * and refused — the server would refuse them anyway, but offering a command
   * that cannot work is just a worse UI.
   */
  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: 'mic', label: micEnabled ? 'Mute myself' : 'Unmute myself', hint: 'M', run: toggleMic },
      {
        id: 'camera',
        label: cameraEnabled ? 'Turn my camera off' : 'Turn my camera on',
        hint: 'V',
        run: toggleCamera,
      },
      { id: 'chat', label: 'Open chat', hint: 'C', run: () => setPanel('chat') },
      { id: 'people', label: 'Open participants', hint: 'P', run: () => setPanel('people') },
      { id: 'quiz', label: 'Open quiz', keywords: 'exam test', run: () => setPanel('quiz') },
      { id: 'polls', label: 'Open polls', keywords: 'vote', run: () => setPanel('polls') },
      {
        id: 'whiteboard',
        label: 'Open whiteboard',
        keywords: 'draw board sketch',
        run: () => setPanel('whiteboard'),
      },
      {
        id: 'share',
        label: screenSharing ? 'Stop presenting' : 'Start screen share',
        hint: 'S',
        keywords: 'present screen',
        run: toggleScreen,
      },
      { id: 'hand', label: handRaised ? 'Lower my hand' : 'Raise my hand', hint: 'H', run: toggleHand },
      { id: 'focus', label: 'Toggle focus mode', keywords: 'minimal distraction', run: toggleFocusMode },
      {
        id: 'pip',
        label: 'Picture-in-picture',
        keywords: 'floating window',
        run: () => void enterPictureInPicture(),
      },
      {
        id: 'invite',
        label: 'Copy invitation link',
        keywords: 'share link',
        run: () => {
          const url = meeting?.joinUrl;
          if (!url) return;
          void navigator.clipboard
            .writeText(url)
            .then(() => notify('success', 'Meeting link copied'))
            .catch(() => notify('warn', 'Could not copy the link'));
        },
      },
      { id: 'devices', label: 'Devices and settings', run: () => setSettingsOpen(true) },
      { id: 'shortcuts', label: 'Keyboard shortcuts', hint: '?', run: () => setShortcutsOpen(true) },
      { id: 'leave', label: 'Leave the meeting', run: () => setLeaveOpen(true) },
    ];

    if (!isHost) return base;

    return [
      ...base,
      { id: 'announce', label: 'Send an announcement', run: () => setAnnounceOpen(true) },
      { id: 'blocklist', label: 'Blocked participants', run: () => setPanel('blocklist') },
      { id: 'mute-all', label: 'Mute everyone', run: () => void meetingClient.muteEveryone() },
      { id: 'end', label: 'End meeting for everyone', run: () => setLeaveOpen(true) },
    ];
  }, [
    micEnabled,
    cameraEnabled,
    screenSharing,
    handRaised,
    isHost,
    meeting?.joinUrl,
    toggleMic,
    toggleCamera,
    toggleScreen,
    toggleHand,
    toggleFocusMode,
    enterPictureInPicture,
    setPanel,
    notify,
  ]);

  // Escape closes the open panel — after dialogs have had their chance at it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (leaveOpen || settingsOpen || shortcutsOpen || recordingOpen || shareOpen) return;
      if (fullscreenIdentity) {
        useRoomStore.getState().setFullscreenIdentity(null);
        return;
      }
      if (panel) setPanel(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel, setPanel, leaveOpen, settingsOpen, shortcutsOpen, recordingOpen, shareOpen, fullscreenIdentity]);

  /**
   * A tab close should look like a deliberate departure rather than a crash, so
   * the rest of the room is not left waiting out the reconnect grace period.
   */
  useEffect(() => {
    function onPageHide() {
      void meetingClient.teardown({ notifyServer: true });
    }
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  const panelTitle =
    panel === 'chat'
      ? 'Chat'
      : panel === 'people'
        ? 'People'
        : panel === 'info'
          ? 'Meeting information'
          : panel === 'diagnostics'
            ? 'Connection information'
            : panel === 'polls'
              ? 'Polls'
              : panel === 'blocklist'
                ? 'Blocked participants'
                : panel === 'quiz'
                  ? 'Quiz'
                  : panel === 'whiteboard'
                    ? 'Whiteboard'
                    : '';

  return (
    <div className="meeting-surface flex h-dvh flex-col overflow-hidden">
      {/* ------------------------------------------------------- top bar */}
      {!focusMode && (
      <header className="safe-top flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-sm font-medium text-ink-100 sm:text-base">
            {meeting?.title ?? 'Meeting'}
          </h1>
          <span className="hidden shrink-0 font-mono text-xs text-ink-500 sm:inline">
            {meeting ? formatMeetingCode(meeting.code) : ''}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Inviting the next person is the most common thing anyone does from
              a room they just opened, so it sits on the bar rather than two
              taps deep under "More options". */}
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label="Share this meeting"
            className="flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-500 sm:px-4"
          >
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </button>

          {recording.active && (
            <span className="flex items-center gap-1.5 rounded-full bg-danger-600/20 px-2.5 py-1 text-xs font-medium text-danger-300">
              <Circle className="h-2.5 w-2.5 fill-current animate-pulse" />
              <span className="hidden sm:inline">Recording</span>
            </span>
          )}

          {meeting?.locked && (
            <span
              className="flex items-center gap-1 text-xs text-ink-400"
              title="This meeting is locked — nobody new can join"
            >
              <Lock className="h-3.5 w-3.5" />
            </span>
          )}

          {/* Encryption is a property of WebRTC itself, so this is a statement
              of fact rather than a feature claim. */}
          <span
            className="hidden items-center gap-1 text-xs text-ink-400 sm:flex"
            title="Media is encrypted in transit with DTLS-SRTP"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-success-400" />
            Encrypted
          </span>

          <time className="font-mono text-xs text-ink-300 tabular-nums sm:text-sm" aria-label="Meeting duration">
            {elapsed}
          </time>
        </div>
      </header>
      )}

      {/* Focus mode strips the interface back to the speaker and the controls;
          this is the only way out, so it is always reachable. */}
      {focusMode && (
        <button
          type="button"
          onClick={toggleFocusMode}
          className="safe-top absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-full bg-ink-950/80 px-3 py-1.5 text-xs font-medium text-ink-100 backdrop-blur transition-colors hover:bg-ink-950"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Exit focus mode
        </button>
      )}

      {/* --------------------------------------------- reconnection banner */}
      {phase === 'reconnecting' && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-center gap-2 bg-warning-500/15 px-4 py-2 text-sm text-warning-200"
        >
          <WifiOff className="h-4 w-4" />
          Connection lost. Reconnecting…
        </div>
      )}

      <AnnouncementBanner />

      {/* ---------------------------------------------------------- body */}
      <div className="flex min-h-0 flex-1">
        <main id="main" className="min-w-0 flex-1">
          <ErrorBoundary
            label="video grid"
            fallback={() => (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-400">
                The video layout could not be displayed. Audio is unaffected — try reloading the page.
              </div>
            )}
          >
            <VideoGrid />
          </ErrorBoundary>
        </main>

        {/* Side panel: an overlay sheet on phones, a column on desktop. */}
        {panel && (
          <aside
            aria-label={panelTitle}
            className="absolute inset-0 z-30 flex flex-col bg-ink-900 sm:relative sm:inset-auto sm:w-80 sm:shrink-0 sm:animate-[slide-in_0.22s_cubic-bezier(0.22,1,0.36,1)] sm:border-l sm:border-white/10 lg:w-96"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
              <h2 className="text-sm font-semibold text-ink-100">{panelTitle}</h2>
              <button
                type="button"
                onClick={() => setPanel(null)}
                aria-label={`Close ${panelTitle}`}
                className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-white/10 hover:text-ink-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1">
              <ErrorBoundary
                label={panelTitle}
                fallback={(reset) => (
                  <div className="p-6 text-center text-sm text-ink-400">
                    <p>This panel could not be displayed.</p>
                    <button type="button" onClick={reset} className="mt-2 text-brand-400 hover:underline">
                      Try again
                    </button>
                  </div>
                )}
              >
                <Suspense
                  fallback={<div className="p-6 text-center text-sm text-ink-500">Loading…</div>}
                >
                  {panel === 'chat' && <ChatPanel />}
                  {panel === 'people' && <PeoplePanel />}
                  {panel === 'info' && <InfoPanel />}
                  {panel === 'diagnostics' && <DiagnosticsPanel />}
                  {panel === 'polls' && <PollsPanel />}
                  {panel === 'blocklist' && <BlocklistPanel />}
                  {panel === 'quiz' && <QuizPanel />}
                  {panel === 'whiteboard' && <WhiteboardPanel />}
                </Suspense>
              </ErrorBoundary>
            </div>
          </aside>
        )}
      </div>

      <ReactionOverlay />

      <NoticeStack />

      <ControlBar
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onToggleScreen={toggleScreen}
        onToggleHand={toggleHand}
        onReaction={sendReaction}
        onLeave={() => setLeaveOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onToggleRecording={() => setRecordingOpen(true)}
        onOpenAnnounce={() => setAnnounceOpen(true)}
        onToggleFocus={toggleFocusMode}
        onPictureInPicture={enterPictureInPicture}
      />

      {/* Audio is rendered once, outside the grid, and never remounts on layout change. */}
      <AudioRenderer outputDeviceId={devices.audioOutputId} />

      {fullscreenIdentity && <FullscreenView identity={fullscreenIdentity} />}

      <LeaveDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        isHost={isHost}
        onLeave={() => onLeave('leave')}
        onEndForEveryone={() => onLeave('end')}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        audioDeviceId={devices.audioDeviceId}
        videoDeviceId={devices.videoDeviceId}
        audioOutputId={devices.audioOutputId}
        onChange={onDevicesChange}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <AnnounceDialog open={announceOpen} onClose={() => setAnnounceOpen(false)} />

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />

      {meeting && (
        <InviteDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title={meeting.title}
          joinUrl={meeting.joinUrl}
          code={meeting.code}
          hostName={meeting.host.name}
          scheduledAt={meeting.scheduledAt}
        />
      )}

      <RecordingDialog
        open={recordingOpen}
        active={recording.active}
        onClose={() => setRecordingOpen(false)}
        onConfirm={() => void meetingClient.setRecording(recording.active ? 'stop' : 'start')}
      />
    </div>
  );
}

/**
 * Fullscreen view of one participant.
 *
 * Uses the browser Fullscreen API where available and otherwise falls back to a
 * full-viewport overlay, so the control works everywhere rather than failing on
 * iOS.
 */
function FullscreenView({ identity }: { identity: string }) {
  const participant = useRoomStore((state) => state.participants[identity]);
  const bundle = useRoomStore((state) => state.tracks[identity]);
  const close = useRoomStore((state) => state.setFullscreenIdentity);
  const containerRef = useRef<HTMLDivElement>(null);

  const track = bundle?.screen ?? bundle?.camera;
  const videoRef = useTrackElement<HTMLVideoElement>(track);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !capabilities().fullscreen) return;

    void element.requestFullscreen?.().catch(() => undefined);

    function onFullscreenChange() {
      // Leaving fullscreen by pressing Escape or the browser chrome should
      // also dismiss the overlay.
      if (!document.fullscreenElement) close(null);
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, [close]);

  if (!participant) return null;

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 flex flex-col bg-black">
      {track ? (
        <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center text-ink-400">
          {participant.name} has their camera off
        </div>
      )}

      <div className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white backdrop-blur">
        {participant.name}
      </div>

      <button
        type="button"
        onClick={() => close(null)}
        aria-label="Exit fullscreen"
        className="absolute right-4 top-4 rounded-full bg-black/60 p-2.5 text-white backdrop-blur transition-colors hover:bg-black/80"
      >
        <Minimize2 className="h-5 w-5" />
      </button>
    </div>
  );
}
