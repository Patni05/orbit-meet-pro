'use client';

import type { MeetingPreview } from '@orbit/shared';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  Lock,
  Mic,
  MicOff,
  Settings2,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { Avatar } from '@/components/ui/Avatar';
import { Alert, Button, Field, Input, Select } from '@/components/ui/primitives';
import { browserUnsupported, capabilities, unavailableReason } from '@/lib/capabilities';
import {
  listDevices,
  loadDevicePreferences,
  onDeviceChange,
  requestMedia,
  saveDevicePreferences,
  stopStream,
  type DeviceOption,
  type MediaFailure,
} from '@/lib/devices';

export interface PreJoinResult {
  displayName: string;
  password?: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  audioOutputId?: string;
}

/**
 * Pre-join.
 *
 * Permission is requested here and nowhere earlier, because this is the first
 * moment the user has said they intend to join. A refusal is not fatal: the
 * failure is explained, and the Join button stays enabled so somebody with a
 * broken webcam can still attend.
 */
export function PreJoin({
  meeting,
  defaultName,
  passwordRequired,
  joining,
  joinError,
  onJoin,
  onCancel,
}: {
  meeting: MeetingPreview;
  defaultName: string;
  passwordRequired: boolean;
  joining: boolean;
  joinError: string | null;
  onJoin: (result: PreJoinResult) => void;
  onCancel: () => void;
}) {
  const caps = capabilities();
  const unsupported = useMemo(() => browserUnsupported(), []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const prefs = useMemo(() => loadDevicePreferences(), []);
  const [micEnabled, setMicEnabled] = useState(prefs.micEnabled ?? true);
  const [cameraEnabled, setCameraEnabled] = useState(prefs.cameraEnabled ?? true);

  const [devices, setDevices] = useState<Record<'audioinput' | 'videoinput' | 'audiooutput', DeviceOption[]>>({
    audioinput: [],
    videoinput: [],
    audiooutput: [],
  });
  const [audioDeviceId, setAudioDeviceId] = useState(prefs.audioInput ?? '');
  const [videoDeviceId, setVideoDeviceId] = useState(prefs.videoInput ?? '');
  const [audioOutputId, setAudioOutputId] = useState(prefs.audioOutput ?? '');

  const [micFailure, setMicFailure] = useState<MediaFailure | null>(null);
  const [cameraFailure, setCameraFailure] = useState<MediaFailure | null>(null);
  const [probing, setProbing] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  /** (Re)builds the local preview stream for the current toggles and devices. */
  const startPreview = useCallback(
    async (options: { audio: boolean; video: boolean; audioId?: string; videoId?: string }) => {
      setProbing(true);

      // Always release the previous stream first, or the camera light stays on
      // and the device can end up reported as "in use".
      stopStream(streamRef.current);
      streamRef.current = null;

      const probe = await requestMedia({
        audio: options.audio,
        video: options.video,
        audioDeviceId: options.audioId,
        videoDeviceId: options.videoId,
      });

      streamRef.current = probe.stream;
      setMicFailure(probe.audio.failure ?? null);
      setCameraFailure(probe.video.failure ?? null);

      if (options.audio && !probe.audio.granted) setMicEnabled(false);
      if (options.video && !probe.video.granted) setCameraEnabled(false);

      if (videoRef.current) {
        videoRef.current.srcObject = probe.stream;
        if (probe.stream) {
          // Autoplay can be rejected; the preview simply stays black then.
          void videoRef.current.play().catch(() => undefined);
        }
      }

      // Labels only become readable after permission is granted, so enumerate
      // devices after the prompt rather than before it.
      setDevices(await listDevices());
      setProbing(false);
    },
    [],
  );

  useEffect(() => {
    if (unsupported) {
      setProbing(false);
      return;
    }
    void startPreview({
      audio: micEnabled,
      video: cameraEnabled,
      audioId: audioDeviceId || undefined,
      videoId: videoDeviceId || undefined,
    });

    // Release the camera and microphone when leaving this screen.
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
    // Intentionally runs once: later changes go through explicit handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A headset being plugged in or removed should refresh the pickers.
  useEffect(() => onDeviceChange(() => void listDevices().then(setDevices)), []);

  async function toggleMic() {
    const next = !micEnabled;
    setMicEnabled(next);
    saveDevicePreferences({ micEnabled: next });
    await startPreview({
      audio: next,
      video: cameraEnabled,
      audioId: audioDeviceId || undefined,
      videoId: videoDeviceId || undefined,
    });
  }

  async function toggleCamera() {
    const next = !cameraEnabled;
    setCameraEnabled(next);
    saveDevicePreferences({ cameraEnabled: next });
    await startPreview({
      audio: micEnabled,
      video: next,
      audioId: audioDeviceId || undefined,
      videoId: videoDeviceId || undefined,
    });
  }

  async function changeDevice(kind: 'audioinput' | 'videoinput' | 'audiooutput', deviceId: string) {
    if (kind === 'audiooutput') {
      setAudioOutputId(deviceId);
      saveDevicePreferences({ audioOutput: deviceId });
      return;
    }

    if (kind === 'audioinput') {
      setAudioDeviceId(deviceId);
      saveDevicePreferences({ audioInput: deviceId });
      await startPreview({
        audio: micEnabled,
        video: cameraEnabled,
        audioId: deviceId,
        videoId: videoDeviceId || undefined,
      });
    } else {
      setVideoDeviceId(deviceId);
      saveDevicePreferences({ videoInput: deviceId });
      await startPreview({
        audio: micEnabled,
        video: cameraEnabled,
        audioId: audioDeviceId || undefined,
        videoId: deviceId,
      });
    }
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Enter the name others will see.');
      return;
    }
    setNameError(null);

    // Hand the camera back before the meeting client opens its own.
    stopStream(streamRef.current);
    streamRef.current = null;

    onJoin({
      displayName: trimmed,
      password: password || undefined,
      micEnabled,
      cameraEnabled,
      audioDeviceId: audioDeviceId || undefined,
      videoDeviceId: videoDeviceId || undefined,
      audioOutputId: audioOutputId || undefined,
    });
  }

  const speakerReason = unavailableReason('speakerSelection');

  return (
    <div className="meeting-surface flex min-h-dvh flex-col">
      <header className="safe-top flex items-center justify-between px-4 py-4 sm:px-6">
        <Logo wordmarkClassName="text-ink-50" />
        <span className="text-sm text-ink-400">Ready to join?</span>
      </header>

      <main
        id="main"
        className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-8 px-4 pb-10 sm:px-6 lg:grid-cols-[1.15fr_1fr]"
      >
        {/* ------------------------------------------------------- preview */}
        <section aria-label="Camera preview">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-white/10">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              // Mirrored, because a preview of yourself should behave like a mirror.
              className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-200 ${
                cameraEnabled && !cameraFailure ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {(!cameraEnabled || cameraFailure) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <Avatar name={name || 'You'} size="2xl" />
                <p className="text-sm text-ink-400">
                  {cameraFailure ? 'Camera unavailable' : 'Your camera is off'}
                </p>
              </div>
            )}

            {probing && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink-950/50 text-sm text-ink-300">
                Checking your devices…
              </div>
            )}

            {/* Quick toggles, laid over the preview the way they will be in the meeting. */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-ink-950/80 to-transparent p-4">
              <button
                type="button"
                onClick={toggleMic}
                aria-pressed={micEnabled}
                aria-label={micEnabled ? 'Turn off microphone' : 'Turn on microphone'}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                  micEnabled ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-danger-600 text-white hover:bg-danger-500'
                }`}
              >
                {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </button>

              <button
                type="button"
                onClick={toggleCamera}
                aria-pressed={cameraEnabled}
                aria-label={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                  cameraEnabled
                    ? 'bg-white/15 text-white hover:bg-white/25'
                    : 'bg-danger-600 text-white hover:bg-danger-500'
                }`}
              >
                {cameraEnabled ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
              </button>

              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                aria-expanded={showSettings}
                aria-label="Device settings"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
              >
                <Settings2 className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* --------------------------------------------- device problems */}
          <div className="mt-3 space-y-2">
            {unsupported && (
              <Alert tone="error" title="This browser cannot run meetings">
                {unsupported}
              </Alert>
            )}

            {micFailure && (
              <DeviceProblem failure={micFailure} onRetry={() => void toggleMic()} retryable={!micEnabled} />
            )}
            {cameraFailure && (
              <DeviceProblem failure={cameraFailure} onRetry={() => void toggleCamera()} retryable={!cameraEnabled} />
            )}
          </div>

          {/* ----------------------------------------------- device pickers */}
          {showSettings && (
            <div className="mt-3 space-y-3 rounded-2xl bg-ink-900 p-4 ring-1 ring-white/10">
              <Field label="Microphone" htmlFor="mic-select">
                <Select
                  id="mic-select"
                  value={audioDeviceId}
                  onChange={(event) => void changeDevice('audioinput', event.target.value)}
                  disabled={devices.audioinput.length === 0}
                  className="border-white/15 bg-ink-850 text-ink-50"
                >
                  <option value="">System default</option>
                  {devices.audioinput.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Camera" htmlFor="cam-select">
                <Select
                  id="cam-select"
                  value={videoDeviceId}
                  onChange={(event) => void changeDevice('videoinput', event.target.value)}
                  disabled={devices.videoinput.length === 0}
                  className="border-white/15 bg-ink-850 text-ink-50"
                >
                  <option value="">System default</option>
                  {devices.videoinput.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Speaker"
                htmlFor="spk-select"
                hint={speakerReason ?? undefined}
              >
                <Select
                  id="spk-select"
                  value={audioOutputId}
                  onChange={(event) => void changeDevice('audiooutput', event.target.value)}
                  disabled={!caps.speakerSelection || devices.audiooutput.length === 0}
                  className="border-white/15 bg-ink-850 text-ink-50"
                >
                  <option value="">System default</option>
                  {devices.audiooutput.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </Select>
              </Field>

              {caps.speakerSelection && (
                <p className="flex items-center gap-1.5 text-xs text-ink-400">
                  <Volume2 className="h-3.5 w-3.5" />
                  Applies to everyone you hear in the meeting.
                </p>
              )}
            </div>
          )}
        </section>

        {/* --------------------------------------------------------- join */}
        <section aria-label="Join meeting" className="w-full">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{meeting.title}</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            Hosted by {meeting.hostName}
            {meeting.waitingRoomEnabled && ' · The host will admit you'}
          </p>

          <div className="mt-6 space-y-4">
            <Field label="Your name" htmlFor="display-name" error={nameError ?? undefined}>
              <Input
                id="display-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !joining) submit();
                }}
                maxLength={60}
                autoComplete="name"
                placeholder="How should people see you?"
                invalid={Boolean(nameError)}
                className="border-white/15 bg-ink-850 text-ink-50 placeholder:text-ink-500"
              />
            </Field>

            {passwordRequired && (
              <Field label="Passcode" htmlFor="meeting-password" hint="The host set a passcode for this meeting.">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                  <Input
                    id="meeting-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !joining) submit();
                    }}
                    maxLength={64}
                    autoComplete="off"
                    className="border-white/15 bg-ink-850 pl-9 text-ink-50"
                  />
                </div>
              </Field>
            )}

            {joinError && <Alert tone="error">{joinError}</Alert>}

            <div className="flex gap-3">
              <Button size="lg" onClick={submit} loading={joining} disabled={Boolean(unsupported)} className="flex-1">
                {meeting.waitingRoomEnabled ? 'Ask to join' : 'Join now'}
              </Button>
              <Button size="lg" variant="secondary" onClick={onCancel} disabled={joining}>
                Cancel
              </Button>
            </div>

            <p className="text-xs text-ink-500">
              {!micEnabled && !cameraEnabled
                ? 'You are joining with your camera and microphone off. You can turn them on at any time.'
                : 'You can change any of this during the meeting.'}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function DeviceProblem({
  failure,
  onRetry,
  retryable,
}: {
  failure: MediaFailure;
  onRetry: () => void;
  retryable: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{failure.message}</p>
        {failure.hint && <p className="mt-0.5 text-amber-200/80">{failure.hint}</p>}
      </div>
      {retryable && (
        <Button size="sm" variant="ghost" onClick={onRetry} className="shrink-0 text-amber-100 hover:bg-amber-500/20">
          Retry
        </Button>
      )}
    </div>
  );
}
