'use client';

import type { RecordingPayload } from '@orbit/shared';
import { AlertTriangle, Download, Loader2, Mic, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { downloadAuthenticated } from '@/lib/api';
import { meetingClient } from '@/lib/meeting-client';
import { selectIsHost, useRoomStore } from '@/lib/room-store';

/**
 * Recordings for this meeting.
 *
 * Audio only, by design — this records what was said, not what anyone's camera
 * saw. Every row here corresponds to a real file produced by the LiveKit
 * egress worker; nothing is listed until the server has actually started one,
 * and a row stays in its processing state until the egress reports completion.
 *
 * The panel is host-only, and so is everything behind it. A participant's room
 * snapshot simply does not contain recordings, so there is no id here for them
 * to guess at, and the download route re-checks the caller's role against the
 * database on every request — opening the URL as a participant returns 403,
 * not a file.
 *
 * Downloads go through a normal authenticated request rather than a
 * pre-signed public link, which is what keeps a recording from becoming
 * quietly world-readable the moment somebody pastes the URL somewhere.
 */
export function RecordingsPanel() {
  const recordings = useRoomStore((state) => state.recordings);
  const meetingId = useRoomStore((state) => state.meeting?.id);
  const isHost = useRoomStore(selectIsHost);
  const recordingActive = useRoomStore((state) => state.recording.active);

  // Refresh on open: a recording that finished while this panel was closed
  // should be here, and `recording:ready` only reaches sockets that were
  // connected at the time.
  useEffect(() => {
    if (isHost) void meetingClient.loadRecordings();
  }, [isHost]);

  if (!isHost) {
    return (
      <p className="p-6 text-center text-sm text-ink-400">
        Only the host can see recordings of this meeting.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim p-3">
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-white/10 bg-ink-850/60 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-400" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-ink-400">
            Recordings capture <span className="font-medium text-ink-200">audio only</span> and are
            private to you. Everyone in the meeting is told when recording starts and stops.
          </p>
        </div>

        {recordings.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-400">
            {recordingActive
              ? 'Recording is running. It will appear here once you stop it.'
              : 'Nothing recorded yet.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {recordings.map((recording) => (
              <RecordingRow key={recording.id} recording={recording} meetingId={meetingId} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RecordingRow({
  recording,
  meetingId,
}: {
  recording: RecordingPayload;
  meetingId: string | undefined;
}) {
  const notify = useRoomStore((state) => state.notify);
  const [saving, setSaving] = useState(false);

  const done = recording.status === 'COMPLETED';
  const failed = recording.status === 'FAILED';
  const pending = !done && !failed;

  const started = new Date(recording.startedAt);

  async function save() {
    if (!meetingId) return;
    setSaving(true);
    try {
      await downloadAuthenticated(
        `/meetings/${meetingId}/recordings/${recording.id}/download`,
        recording.fileName ?? undefined,
      );
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'The recording could not be downloaded.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-xl border border-white/10 bg-ink-850/60 p-3">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            failed ? 'bg-danger-600/20 text-danger-400' : 'bg-brand-600/20 text-brand-300'
          }`}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : failed ? (
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Mic className="h-4 w-4" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-100">
            {started.toLocaleDateString([], { day: 'numeric', month: 'short' })} ·{' '}
            {started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>

          <p className="mt-0.5 text-xs text-ink-400">
            {[
              formatDuration(recording.durationSec),
              formatSize(recording.sizeBytes),
              recording.audioOnly ? 'Audio only' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <p
            className={`mt-1 text-[11px] font-medium ${
              failed ? 'text-danger-400' : done ? 'text-success-400' : 'text-warning-400'
            }`}
          >
            {statusLabel(recording.status)}
          </p>
        </div>

        {done && meetingId && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {saving ? 'Saving…' : 'Download'}
          </button>
        )}
      </div>
    </li>
  );
}

function statusLabel(status: RecordingPayload['status']): string {
  switch (status) {
    case 'STARTING':
      return 'Starting…';
    case 'ACTIVE':
      return 'Recording now';
    case 'STOPPING':
      return 'Processing…';
    case 'COMPLETED':
      return 'Ready to download';
    case 'FAILED':
      return 'Recording failed';
    default:
      return status;
  }
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
}

function formatSize(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
