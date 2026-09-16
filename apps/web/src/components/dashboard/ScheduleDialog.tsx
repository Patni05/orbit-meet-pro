'use client';

import { DEFAULT_MEETING_SETTINGS, type MeetingSettings, type MeetingSummary } from '@orbit/shared';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Alert, Button, Field, Input, Select, Toggle } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

/**
 * Schedule a meeting.
 *
 * Collects the timing in the browser's own timezone and converts to an ISO
 * instant before sending, so a meeting scheduled in Berlin still starts at the
 * right moment for someone in São Paulo.
 */
export function ScheduleDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (meeting: MeetingSummary, password: string | null) => void;
}) {
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [password, setPassword] = useState('');
  const [settings, setSettings] = useState<MeetingSettings>({ ...DEFAULT_MEETING_SETTINGS });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(key: keyof MeetingSettings, value: boolean | string) {
    setSettings((current) => ({ ...current, [key]: value }) as MeetingSettings);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Give the meeting a title.');
      return;
    }
    if (!date || !time) {
      setError('Choose a date and a start time.');
      return;
    }

    const scheduled = new Date(`${date}T${time}`);
    if (Number.isNaN(scheduled.getTime())) {
      setError('That date and time could not be read.');
      return;
    }
    if (scheduled.getTime() < Date.now() - 60_000) {
      setError('That time is in the past.');
      return;
    }
    if (password && password.length < 4) {
      setError('A passcode needs at least 4 characters.');
      return;
    }

    setBusy(true);
    try {
      const { meeting } = await api.meetings.create({
        title: title.trim(),
        description: description.trim() || null,
        scheduledAt: scheduled.toISOString(),
        durationMinutes: duration,
        timezone: localTimezone,
        password: password || null,
        settings,
      });
      onCreated(meeting, password || null);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not schedule the meeting.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTitle('');
    setDescription('');
    setDate('');
    setTime('');
    setDuration(30);
    setPassword('');
    setSettings({ ...DEFAULT_MEETING_SETTINGS });
    setError(null);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Schedule a meeting"
      description="Pick a time and set the rules for who can join."
      size="lg"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Title" htmlFor="title">
          <Input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Weekly design review"
            required
            maxLength={120}
          />
        </Field>

        <Field label="Description" htmlFor="description" hint="Optional — shown to you in the dashboard.">
          <Input
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Agenda, links, anything useful"
            maxLength={2000}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" htmlFor="date">
            <Input id="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </Field>
          <Field label="Start time" htmlFor="time">
            <Input id="time" type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
          </Field>
          <Field label="Duration" htmlFor="duration">
            <Select id="duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
              {[15, 30, 45, 60, 90, 120, 180].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes > 60 ? 's' : ''}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <p className="text-xs text-ink-500 dark:text-ink-400">
          Times are in your timezone: <span className="font-medium">{localTimezone}</span>
        </p>

        <Field
          label="Passcode"
          htmlFor="password"
          hint="Optional. Participants must enter this before they can join."
        >
          <Input
            id="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Leave blank for no passcode"
            maxLength={64}
            autoComplete="off"
          />
        </Field>

        <div className="rounded-xl border border-ink-200 p-4 dark:border-white/10">
          <h3 className="text-sm font-semibold">Who can join, and what they can do</h3>
          <div className="mt-1 divide-y divide-ink-100 dark:divide-white/5">
            <Toggle
              label="Waiting room"
              description="You approve each person before they enter."
              checked={settings.waitingRoomEnabled}
              onChange={(v) => patch('waitingRoomEnabled', v)}
            />
            <Toggle
              label="Require sign-in"
              description="Only people with an Orbit account can join."
              checked={settings.requireAuth}
              onChange={(v) => patch('requireAuth', v)}
            />
            <Toggle
              label="Allow guests"
              description="People without an account can join with just a name."
              checked={settings.allowGuests}
              onChange={(v) => patch('allowGuests', v)}
            />
            <Toggle
              label="Chat"
              description="Participants can send messages during the meeting."
              checked={settings.chatEnabled}
              onChange={(v) => patch('chatEnabled', v)}
            />
            <Toggle
              label="Anyone can share their screen"
              description="Turn off to limit presenting to hosts."
              checked={settings.screenShareMode === 'EVERYONE'}
              onChange={(v) => patch('screenShareMode', v ? 'EVERYONE' : 'HOSTS_ONLY')}
            />
            <Toggle
              label="Mute people as they arrive"
              description="Everyone joins muted; they can unmute themselves."
              checked={settings.muteOnEntry}
              onChange={(v) => patch('muteOnEntry', v)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Schedule meeting
          </Button>
        </div>
      </form>
    </Modal>
  );
}
