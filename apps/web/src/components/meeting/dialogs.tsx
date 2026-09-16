'use client';

import { AlertTriangle, LogOut, Megaphone, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Alert, Button, Field, Select } from '@/components/ui/primitives';
import { SHORTCUTS } from '@/hooks/useKeyboardShortcuts';
import { capabilities, unavailableReason } from '@/lib/capabilities';
import { listDevices, saveDevicePreferences, type DeviceOption } from '@/lib/devices';
import { meetingClient } from '@/lib/meeting-client';

/**
 * Leaving.
 *
 * A host gets two clearly different outcomes — leave, or end for everyone —
 * with the destructive one styled as such. Nothing here is a one-tap action
 * next to the mute button.
 */
export function LeaveDialog({
  open,
  onClose,
  canEndForEveryone,
  onLeave,
  onEndForEveryone,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Whether this person may close the room on everybody.
   *
   * Not the same as being a host: a co-host moderates, but ending the meeting
   * stays with the owner while the meeting is set to host-only exit. The
   * gateway refuses the attempt regardless, so hiding the button here is a
   * courtesy rather than the control.
   */
  canEndForEveryone: boolean;
  onLeave: () => void;
  onEndForEveryone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={canEndForEveryone ? 'Leave or end the meeting?' : 'Leave the meeting?'}
      description={
        canEndForEveryone
          ? 'You can step out and let the meeting continue, or close it for everyone.'
          : 'You can rejoin with the same link while the meeting is running.'
      }
      size="sm"
    >
      <div className="space-y-2">
        <Button
          variant="secondary"
          fullWidth
          size="lg"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onLeave();
          }}
        >
          <LogOut className="h-4 w-4" />
          Leave the meeting
        </Button>

        {canEndForEveryone && (
          <Button
            variant="danger"
            fullWidth
            size="lg"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onEndForEveryone();
            }}
          >
            <AlertTriangle className="h-4 w-4" />
            End meeting for everyone
          </Button>
        )}

        <Button variant="ghost" fullWidth onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

/** Device switching during a meeting — no need to leave and rejoin. */
export function SettingsDialog({
  open,
  onClose,
  audioDeviceId,
  videoDeviceId,
  audioOutputId,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  audioDeviceId?: string;
  videoDeviceId?: string;
  audioOutputId?: string;
  onChange: (patch: { audioDeviceId?: string; videoDeviceId?: string; audioOutputId?: string }) => void;
}) {
  const [devices, setDevices] = useState<Record<'audioinput' | 'videoinput' | 'audiooutput', DeviceOption[]>>({
    audioinput: [],
    videoinput: [],
    audiooutput: [],
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) void listDevices().then(setDevices);
  }, [open]);

  const caps = capabilities();
  const speakerReason = unavailableReason('speakerSelection');

  async function switchTo(kind: MediaDeviceKind, deviceId: string) {
    setError(null);

    if (kind === 'audiooutput') {
      onChange({ audioOutputId: deviceId });
      saveDevicePreferences({ audioOutput: deviceId });
      return;
    }

    const ok = await meetingClient.switchDevice(kind, deviceId);
    if (!ok) {
      setError('That device could not be started. It may be in use by another app.');
      return;
    }

    if (kind === 'audioinput') {
      onChange({ audioDeviceId: deviceId });
      saveDevicePreferences({ audioInput: deviceId });
    } else {
      onChange({ videoDeviceId: deviceId });
      saveDevicePreferences({ videoInput: deviceId });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Devices" description="Changes take effect immediately." size="md">
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Microphone" htmlFor="settings-mic">
          <Select
            id="settings-mic"
            value={audioDeviceId ?? ''}
            onChange={(event) => void switchTo('audioinput', event.target.value)}
          >
            <option value="">System default</option>
            {devices.audioinput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Camera" htmlFor="settings-cam">
          <Select
            id="settings-cam"
            value={videoDeviceId ?? ''}
            onChange={(event) => void switchTo('videoinput', event.target.value)}
          >
            <option value="">System default</option>
            {devices.videoinput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Speaker" htmlFor="settings-spk" hint={speakerReason ?? undefined}>
          <Select
            id="settings-spk"
            value={audioOutputId ?? ''}
            disabled={!caps.speakerSelection}
            onChange={(event) => void switchTo('audiooutput', event.target.value)}
          >
            <option value="">System default</option>
            {devices.audiooutput.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </Select>
        </Field>

        <p className="text-xs text-ink-500 dark:text-ink-400">
          Echo cancellation, noise suppression and automatic gain control are always on for your
          microphone.
        </p>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Shortcuts are ignored while you are typing."
      size="sm"
    >
      <dl className="divide-y divide-ink-100 dark:divide-white/10">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-sm">{shortcut.description}</dt>
            <dd>
              <kbd className="rounded border border-ink-200 bg-ink-50 px-2 py-1 font-mono text-xs dark:border-white/15 dark:bg-white/10">
                {shortcut.keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

/**
 * Recording consent.
 *
 * Recording is never silent: the host must confirm, and every participant is
 * told the moment it starts.
 */
export function RecordingDialog({
  open,
  active,
  onClose,
  onConfirm,
}: {
  open: boolean;
  active: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={active ? 'Stop recording?' : 'Start recording?'}
      size="sm"
      description={
        active
          ? 'The recording will be finalised and saved.'
          : 'Everyone in the meeting will be told that recording has started.'
      }
    >
      {!active && (
        <Alert tone="warning" title="Let people know">
          Make sure everyone is comfortable being recorded. Depending on where participants are, their
          consent may be legally required.
        </Alert>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={active ? 'danger' : 'primary'}
          loading={busy}
          onClick={() => {
            setBusy(true);
            onConfirm();
            setBusy(false);
            onClose();
          }}
        >
          <Radio className="h-4 w-4" />
          {active ? 'Stop recording' : 'Start recording'}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Compose an announcement.
 *
 * Kept short by design — 280 characters, the same bound the server enforces.
 * An announcement interrupts everyone at once, so the format nudges towards
 * "starting in two minutes" rather than a paragraph nobody reads.
 */
export function AnnounceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const trimmed = body.trim();
    if (!trimmed) return setError('Write something to announce.');

    setBusy(true);
    setError(null);
    const result = await meetingClient.announce(trimmed);
    setBusy(false);

    if (result.ok) {
      setBody('');
      onClose();
    } else {
      setError(result.message ?? 'The announcement could not be sent.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send an announcement"
      description="Everyone sees this until you clear it."
      size="sm"
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}

        <label htmlFor="announcement-body" className="sr-only">
          Announcement
        </label>
        <textarea
          id="announcement-body"
          rows={3}
          value={body}
          maxLength={280}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Presentation begins in two minutes."
          className="w-full resize-none rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm focus:outline-2 focus:outline-brand-500 dark:border-white/15 dark:bg-ink-850 dark:text-ink-50"
        />
        <p className="text-right text-xs text-ink-500">{280 - body.length} characters left</p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void send()} loading={busy}>
            <Megaphone className="h-4 w-4" />
            Announce
          </Button>
        </div>
      </div>
    </Modal>
  );
}
