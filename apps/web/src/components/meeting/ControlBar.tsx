'use client';

import { REACTIONS, REACTION_EMOJI, type ReactionKey } from '@orbit/shared';
import {
  BarChart3,
  Focus,
  GraduationCap,
  PictureInPicture2,
  Circle,
  Megaphone,
  ShieldBan,
  Hand,
  Keyboard,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  ScreenShareOff,
  Settings2,
  Smile,
  SquareUser,
  Users,
  Video,
  VideoOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { capabilities, unavailableReason } from '@/lib/capabilities';
import { useRoomStore } from '@/lib/room-store';

export interface ControlBarProps {
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onToggleHand: () => void;
  onReaction: (reaction: ReactionKey) => void;
  onLeave: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onToggleRecording: () => void;
  onOpenAnnounce: () => void;
  onToggleFocus: () => void;
  onPictureInPicture: () => void;
}

/**
 * The control bar.
 *
 * On desktop it is one row of labelled, tooltipped controls. On phones the
 * essentials stay on the bar — microphone, camera, chat, leave — and the rest
 * move into a sheet, because a row of ten 44px targets does not fit a 360px
 * screen and the leave button must never be a mis-tap away from mute.
 */
export function ControlBar(props: ControlBarProps) {
  const micEnabled = useRoomStore((state) => state.micEnabled);
  const cameraEnabled = useRoomStore((state) => state.cameraEnabled);
  const screenSharing = useRoomStore((state) => state.screenSharing);
  const handRaised = useRoomStore((state) => state.handRaised);
  const panel = useRoomStore((state) => state.panel);
  const setPanel = useRoomStore((state) => state.setPanel);
  const layout = useRoomStore((state) => state.layout);
  const setLayout = useRoomStore((state) => state.setLayout);
  const unread = useRoomStore((state) => state.unreadCount);
  const unreadPolls = useRoomStore((state) => state.unreadPolls);
  const waitingCount = useRoomStore((state) => state.waiting.length);
  const participantCount = useRoomStore((state) => state.order.length);
  const recording = useRoomStore((state) => state.recording);
  const selfRole = useRoomStore((state) => state.selfRole);
  const chatEnabled = useRoomStore((state) => state.meeting?.settings.chatEnabled ?? true);
  const recordingAllowed = useRoomStore((state) => state.meeting?.settings.recordingEnabled ?? false);

  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const caps = capabilities();
  const shareBlocked = unavailableReason('screenShare');
  const isHost = selfRole === 'HOST' || selfRole === 'COHOST';

  return (
    <div className="safe-bottom relative z-30 border-t border-white/10 bg-ink-900/95 backdrop-blur">
      {reactionsOpen && (
        <ReactionPicker
          onPick={(reaction) => {
            props.onReaction(reaction);
            setReactionsOpen(false);
          }}
          onClose={() => setReactionsOpen(false)}
        />
      )}

      {moreOpen && (
        <MoreMenu
          onClose={() => setMoreOpen(false)}
          isHost={isHost}
          recordingActive={recording.active}
          recordingAllowed={recordingAllowed}
          layout={layout}
          onSetLayout={setLayout}
          onOpenSettings={props.onOpenSettings}
          onOpenShortcuts={props.onOpenShortcuts}
          onToggleRecording={props.onToggleRecording}
          onOpenInfo={() => setPanel('info')}
          onOpenDiagnostics={() => setPanel('diagnostics')}
          onToggleScreen={props.onToggleScreen}
          screenSharing={screenSharing}
          shareBlocked={shareBlocked}
          onToggleHand={props.onToggleHand}
          handRaised={handRaised}
          onOpenReactions={() => setReactionsOpen(true)}
          onOpenPolls={() => setPanel('polls')}
          onOpenQuiz={() => setPanel('quiz')}
          onOpenAnnounce={props.onOpenAnnounce}
          onOpenBlocklist={() => setPanel('blocklist')}
          onToggleFocus={props.onToggleFocus}
          onPictureInPicture={props.onPictureInPicture}
        />
      )}

      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-3 sm:h-20 sm:px-4">
        {/* Meeting identity is shown on the top bar; keep the left slot for
            balance on wide screens only. */}
        <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
          {recording.active && (
            <span className="flex items-center gap-1.5 rounded-full bg-danger-600/20 px-2.5 py-1 text-xs font-medium text-danger-300">
              <Circle className="h-2.5 w-2.5 fill-current" />
              Recording
            </span>
          )}
        </div>

        {/* ------------------------------------------------- primary controls */}
        <div className="flex flex-1 items-center justify-center gap-1.5 sm:flex-none sm:gap-2">
          <ControlButton
            label={micEnabled ? 'Mute' : 'Unmute'}
            shortcut="M"
            active={!micEnabled}
            danger={!micEnabled}
            onClick={props.onToggleMic}
            icon={micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            pressed={micEnabled}
          />

          <ControlButton
            label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            shortcut="V"
            active={!cameraEnabled}
            danger={!cameraEnabled}
            onClick={props.onToggleCamera}
            icon={cameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            pressed={cameraEnabled}
          />

          {/* Screen share and reactions are desktop-first; on phones they live
              in the More sheet. */}
          <div className="hidden sm:contents">
            <ControlButton
              label={shareBlocked ?? (screenSharing ? 'Stop presenting' : 'Present now')}
              shortcut="S"
              active={screenSharing}
              disabled={Boolean(shareBlocked)}
              onClick={props.onToggleScreen}
              icon={screenSharing ? <ScreenShareOff className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
            />

            <ControlButton
              label={handRaised ? 'Lower hand' : 'Raise hand'}
              shortcut="H"
              active={handRaised}
              onClick={props.onToggleHand}
              icon={<Hand className="h-5 w-5" />}
            />

            <ControlButton
              label="Send a reaction"
              active={reactionsOpen}
              onClick={() => setReactionsOpen((v) => !v)}
              icon={<Smile className="h-5 w-5" />}
            />
          </div>

          <ControlButton
            label={chatEnabled ? 'Chat' : 'Chat is off'}
            shortcut="C"
            active={panel === 'chat'}
            disabled={!chatEnabled}
            badge={unread > 0 ? unread : undefined}
            onClick={() => setPanel(panel === 'chat' ? null : 'chat')}
            icon={<MessageSquare className="h-5 w-5" />}
          />

          <ControlButton
            label="People"
            shortcut="P"
            active={panel === 'people'}
            badge={waitingCount > 0 ? waitingCount : undefined}
            badgeTone={waitingCount > 0 ? 'warning' : 'brand'}
            count={participantCount}
            onClick={() => setPanel(panel === 'people' ? null : 'people')}
            icon={<Users className="h-5 w-5" />}
          />

          <ControlButton
            label="More options"
            active={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            icon={<MoreVertical className="h-5 w-5" />}
          />

          <Tooltip label="Leave the meeting">
            <button
              type="button"
              onClick={props.onLeave}
              aria-label="Leave the meeting"
              className="ml-1 flex h-11 items-center justify-center gap-2 rounded-full bg-danger-600 px-4 text-white transition-colors hover:bg-danger-500 sm:h-12 sm:px-6"
            >
              <PhoneOff className="h-5 w-5" />
              <span className="hidden text-sm font-medium sm:inline">Leave</span>
            </button>
          </Tooltip>
        </div>

        <div className="hidden flex-1 justify-end sm:flex">
          <Tooltip label={layout === 'grid' ? 'Switch to speaker view' : 'Switch to grid view'}>
            <button
              type="button"
              onClick={() => setLayout(layout === 'grid' ? 'speaker' : 'grid')}
              aria-label={layout === 'grid' ? 'Switch to speaker view' : 'Switch to grid view'}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              {layout === 'grid' ? <SquareUser className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  shortcut,
  icon,
  onClick,
  active,
  danger,
  disabled,
  badge,
  badgeTone = 'brand',
  count,
  pressed,
}: {
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  badge?: number;
  badgeTone?: 'brand' | 'warning';
  count?: number;
  pressed?: boolean;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed !== undefined ? pressed : active}
        className={[
          'relative flex h-11 w-11 items-center justify-center rounded-full transition-colors sm:h-12 sm:w-12',
          'disabled:cursor-not-allowed disabled:opacity-40',
          danger
            ? 'bg-danger-600 text-white hover:bg-danger-500'
            : active
              ? 'bg-brand-600 text-white hover:bg-brand-500'
              : 'bg-white/10 text-ink-100 hover:bg-white/20',
        ].join(' ')}
      >
        {icon}

        {badge !== undefined && badge > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${
              badgeTone === 'warning' ? 'bg-warning-500 text-ink-950' : 'bg-brand-500'
            }`}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}

        {badge === undefined && count !== undefined && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-semibold text-white">
            {count}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function ReactionPicker({
  onPick,
  onClose,
}: {
  onPick: (reaction: ReactionKey) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Reactions"
      className="absolute bottom-full left-1/2 mb-3 -translate-x-1/2 animate-[fade-in_0.15s_ease-out] rounded-2xl border border-white/10 bg-ink-850 p-2 shadow-2xl"
    >
      <div className="flex gap-1">
        {REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            role="menuitem"
            onClick={() => onPick(reaction)}
            aria-label={`Send ${reaction} reaction`}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl transition-transform hover:scale-125 hover:bg-white/10"
          >
            {REACTION_EMOJI[reaction]}
          </button>
        ))}
      </div>
    </div>
  );
}

function MoreMenu({
  onClose,
  isHost,
  recordingActive,
  recordingAllowed,
  layout,
  onSetLayout,
  onOpenSettings,
  onOpenShortcuts,
  onToggleRecording,
  onOpenInfo,
  onOpenDiagnostics,
  onToggleScreen,
  screenSharing,
  shareBlocked,
  onToggleHand,
  handRaised,
  onOpenReactions,
  onOpenPolls,
  onOpenQuiz,
  onOpenAnnounce,
  onOpenBlocklist,
  onToggleFocus,
  onPictureInPicture,
}: {
  onClose: () => void;
  isHost: boolean;
  recordingActive: boolean;
  recordingAllowed: boolean;
  layout: 'grid' | 'speaker';
  onSetLayout: (layout: 'grid' | 'speaker') => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onToggleRecording: () => void;
  onOpenInfo: () => void;
  onOpenDiagnostics: () => void;
  onToggleScreen: () => void;
  screenSharing: boolean;
  shareBlocked: string | null;
  onToggleHand: () => void;
  handRaised: boolean;
  onOpenReactions: () => void;
  onOpenPolls: () => void;
  onOpenQuiz: () => void;
  onOpenAnnounce: () => void;
  onOpenBlocklist: () => void;
  onToggleFocus: () => void;
  onPictureInPicture: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const debugAvailable = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const item =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-100 transition-colors hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="More options"
      className="absolute bottom-full right-2 mb-3 w-64 animate-[fade-in_0.15s_ease-out] rounded-2xl border border-white/10 bg-ink-850 p-2 shadow-2xl sm:right-4"
    >
      {/* These three are on the bar itself at desktop widths. */}
      <div className="sm:hidden">
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onToggleScreen();
            onClose();
          }}
          disabled={Boolean(shareBlocked)}
          title={shareBlocked ?? undefined}
        >
          <MonitorUp className="h-4 w-4" />
          {screenSharing ? 'Stop presenting' : 'Present now'}
        </button>

        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onToggleHand();
            onClose();
          }}
        >
          <Hand className="h-4 w-4" />
          {handRaised ? 'Lower hand' : 'Raise hand'}
        </button>

        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onClose();
            onOpenReactions();
          }}
        >
          <Smile className="h-4 w-4" />
          Send a reaction
        </button>

        <div className="my-1.5 h-px bg-white/10" />
      </div>

      <button
        type="button"
        role="menuitem"
        className={`${item} sm:hidden`}
        onClick={() => {
          onSetLayout(layout === 'grid' ? 'speaker' : 'grid');
          onClose();
        }}
      >
        {layout === 'grid' ? <SquareUser className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        {layout === 'grid' ? 'Speaker view' : 'Grid view'}
      </button>

      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onOpenSettings();
          onClose();
        }}
      >
        <Settings2 className="h-4 w-4" />
        Devices and settings
      </button>

      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onOpenInfo();
          onClose();
        }}
      >
        <Users className="h-4 w-4" />
        Meeting information
      </button>

      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onOpenDiagnostics();
          onClose();
        }}
      >
        <Circle className="h-4 w-4" />
        Connection information
      </button>

      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onOpenPolls();
          onClose();
        }}
      >
        <BarChart3 className="h-4 w-4" />
        Polls
      </button>

      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onOpenQuiz();
          onClose();
        }}
      >
        <GraduationCap className="h-4 w-4" />
        Quiz
      </button>

      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onToggleFocus();
          onClose();
        }}
      >
        <Focus className="h-4 w-4" />
        Focus mode
      </button>

      <button
        type="button"
        role="menuitem"
        className={item}
        disabled={!capabilities().pictureInPicture}
        title={
          capabilities().pictureInPicture
            ? undefined
            : 'This browser does not support picture-in-picture.'
        }
        onClick={() => {
          onPictureInPicture();
          onClose();
        }}
      >
        <PictureInPicture2 className="h-4 w-4" />
        Picture-in-picture
      </button>

      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onOpenShortcuts();
          onClose();
        }}
      >
        <Keyboard className="h-4 w-4" />
        Keyboard shortcuts
      </button>

      {isHost && (
        <>
          <div className="my-1.5 h-px bg-white/10" />
          <button
            type="button"
            role="menuitem"
            className={item}
            disabled={!recordingAllowed}
            title={recordingAllowed ? undefined : 'Recording is turned off for this meeting.'}
            onClick={() => {
              onToggleRecording();
              onClose();
            }}
          >
            <Circle className={`h-4 w-4 ${recordingActive ? 'fill-danger-500 text-danger-500' : ''}`} />
            {recordingActive ? 'Stop recording' : 'Start recording'}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onOpenAnnounce();
              onClose();
            }}
          >
            <Megaphone className="h-4 w-4" />
            Send an announcement
          </button>

          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onOpenBlocklist();
              onClose();
            }}
          >
            <ShieldBan className="h-4 w-4" />
            Blocked participants
          </button>
        </>
      )}

      {debugAvailable && (
        <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-ink-500">Development build</p>
      )}
    </div>
  );
}
