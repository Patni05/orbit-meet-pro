'use client';

/**
 * Camera, microphone and speaker handling.
 *
 * Permission is requested only when the user reaches the pre-join screen — not
 * on page load — and a refusal is never fatal: the meeting can be joined with
 * no camera, no microphone, or neither.
 */

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput';

export interface DeviceOption {
  deviceId: string;
  label: string;
  kind: DeviceKind;
}

export type MediaErrorKind =
  | 'permission-denied'
  | 'not-found'
  | 'in-use'
  | 'insecure-context'
  | 'overconstrained'
  | 'unsupported'
  | 'unknown';

export interface MediaFailure {
  kind: MediaErrorKind;
  /** Shown to the user. Plain language, says what to do next. */
  message: string;
  /** Extra guidance rendered under the message when present. */
  hint?: string;
}

/** Turns a DOMException from getUserMedia into something a person can act on. */
export function describeMediaError(error: unknown, device: 'camera' | 'microphone' | 'screen'): MediaFailure {
  const name = (error as DOMException)?.name ?? '';
  const label = device === 'camera' ? 'Camera' : device === 'microphone' ? 'Microphone' : 'Screen sharing';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      if (device === 'screen') {
        return { kind: 'permission-denied', message: 'Screen sharing was cancelled or blocked.' };
      }
      return {
        kind: 'permission-denied',
        message: `${label} access was blocked.`,
        hint: 'Click the camera or lock icon in the address bar, allow access, then try again.',
      };

    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        kind: 'not-found',
        message: `No ${device} was found.`,
        hint: `You can still join the meeting without a ${device}.`,
      };

    case 'NotReadableError':
    case 'TrackStartError':
      return {
        kind: 'in-use',
        message: `Your ${device} is already being used by another app.`,
        hint: 'Close other apps or browser tabs that might be using it, then try again.',
      };

    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        kind: 'overconstrained',
        message: `That ${device} does not support the requested settings.`,
        hint: 'Pick a different device from the list.',
      };

    case 'SecurityError':
      return {
        kind: 'insecure-context',
        message: 'Your browser blocked device access on an insecure connection.',
        hint: 'Use HTTPS or open the app on localhost.',
      };

    case 'NotSupportedError':
      return { kind: 'unsupported', message: `${label} is not supported in this browser.` };

    default:
      return {
        kind: 'unknown',
        message: `${label} could not be started.`,
        hint: 'Try reloading the page, or pick a different device.',
      };
  }
}

/**
 * Audio constraints.
 *
 * Echo cancellation, noise suppression and automatic gain are the three
 * processors every major browser implements natively — enabling them here is
 * what stops feedback loops and keyboard clatter without any extra libraries.
 */
export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
}

export function videoConstraints(deviceId?: string, facingMode?: 'user' | 'environment'): MediaTrackConstraints {
  return {
    ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
    ...(facingMode && !deviceId ? { facingMode } : {}),
    // Capture at 720p and let simulcast scale down; asking for 1080p on a
    // laptop webcam mostly costs CPU.
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  };
}

/**
 * Lists devices.
 *
 * Labels are empty until permission has been granted at least once, which is
 * why the pre-join screen asks for permission before showing the pickers.
 */
export async function listDevices(): Promise<Record<DeviceKind, DeviceOption[]>> {
  const empty: Record<DeviceKind, DeviceOption[]> = {
    audioinput: [],
    videoinput: [],
    audiooutput: [],
  };

  if (!navigator.mediaDevices?.enumerateDevices) return empty;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const counters: Record<string, number> = {};

    for (const device of devices) {
      const kind = device.kind as DeviceKind;
      if (!(kind in empty)) continue;
      counters[kind] = (counters[kind] ?? 0) + 1;

      const fallback =
        kind === 'videoinput'
          ? `Camera ${counters[kind]}`
          : kind === 'audioinput'
            ? `Microphone ${counters[kind]}`
            : `Speaker ${counters[kind]}`;

      empty[kind].push({
        deviceId: device.deviceId,
        label: device.label || fallback,
        kind,
      });
    }
  } catch {
    // Enumeration can fail in locked-down browsers; an empty list simply means
    // "no picker", and the default device is still used.
  }

  return empty;
}

export interface PermissionProbe {
  audio: { granted: boolean; failure?: MediaFailure };
  video: { granted: boolean; failure?: MediaFailure };
  stream: MediaStream | null;
}

/**
 * Asks for camera and microphone, falling back gracefully.
 *
 * Tries both together first (one browser prompt). If that fails it retries each
 * separately, so a broken webcam does not also cost the user their microphone.
 */
export async function requestMedia(options: {
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}): Promise<PermissionProbe> {
  const result: PermissionProbe = {
    audio: { granted: false },
    video: { granted: false },
    stream: null,
  };

  if (!navigator.mediaDevices?.getUserMedia) {
    const failure: MediaFailure = {
      kind: 'unsupported',
      message: 'This browser cannot access media devices.',
    };
    if (options.audio) result.audio.failure = failure;
    if (options.video) result.video.failure = failure;
    return result;
  }

  if (!options.audio && !options.video) return result;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: options.audio ? audioConstraints(options.audioDeviceId) : false,
      video: options.video ? videoConstraints(options.videoDeviceId) : false,
    });
    result.stream = stream;
    result.audio.granted = options.audio && stream.getAudioTracks().length > 0;
    result.video.granted = options.video && stream.getVideoTracks().length > 0;
    return result;
  } catch (combinedError) {
    // Fall through to per-device attempts below.
    if (options.audio && options.video) {
      const tracks: MediaStreamTrack[] = [];

      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(options.audioDeviceId),
        });
        tracks.push(...audioOnly.getTracks());
        result.audio.granted = true;
      } catch (error) {
        result.audio.failure = describeMediaError(error, 'microphone');
      }

      try {
        const videoOnly = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(options.videoDeviceId),
        });
        tracks.push(...videoOnly.getTracks());
        result.video.granted = true;
      } catch (error) {
        result.video.failure = describeMediaError(error, 'camera');
      }

      if (tracks.length > 0) result.stream = new MediaStream(tracks);
      return result;
    }

    const failure = describeMediaError(combinedError, options.video ? 'camera' : 'microphone');
    if (options.video) result.video.failure = failure;
    if (options.audio) result.audio.failure = failure;
    return result;
  }
}

/** Releases every track. Called on unmount and when leaving a meeting. */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Already stopped; nothing to do.
    }
  }
}

/**
 * Routes audio to a chosen output device. Only Chromium browsers implement
 * setSinkId; elsewhere the call is a no-op and the UI says so.
 */
export async function applySinkId(element: HTMLMediaElement, deviceId: string): Promise<boolean> {
  const withSink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof withSink.setSinkId !== 'function') return false;
  try {
    await withSink.setSinkId(deviceId);
    return true;
  } catch {
    return false;
  }
}

/** Subscribes to device changes — a headset being plugged in or pulled out. */
export function onDeviceChange(handler: () => void): () => void {
  if (!navigator.mediaDevices?.addEventListener) return () => undefined;
  navigator.mediaDevices.addEventListener('devicechange', handler);
  return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
}

const STORAGE_KEY = 'orbit.devices';

export interface DevicePreferences {
  audioInput?: string;
  videoInput?: string;
  audioOutput?: string;
  micEnabled?: boolean;
  cameraEnabled?: boolean;
}

/** Device choices persist per browser so the next meeting starts set up. */
export function loadDevicePreferences(): DevicePreferences {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as DevicePreferences;
  } catch {
    return {};
  }
}

export function saveDevicePreferences(prefs: DevicePreferences): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadDevicePreferences(), ...prefs }));
  } catch {
    // Storage can be disabled; preferences are a convenience, not a requirement.
  }
}
