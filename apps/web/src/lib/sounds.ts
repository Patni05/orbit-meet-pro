'use client';

/**
 * Meeting sounds.
 *
 * Synthesised with the Web Audio API rather than shipped as audio files. Six
 * short cues as MP3s would be a few hundred kilobytes of assets to download,
 * cache and serve, and a meeting already spends its bandwidth on media; these
 * are a few dozen lines of oscillator instead, and they cannot fail to load.
 *
 * Three rules shape everything below.
 *
 * **Quiet by default.** Every cue is a soft sine with a fast attack and a
 * gentle release, peaking well below full scale. A notification that competes
 * with the person talking is worse than no notification.
 *
 * **Never for your own actions.** You know you sent a message; hearing a tone
 * for it is noise. Callers only play cues for things that arrive from someone
 * else.
 *
 * **Always silenceable, and remembered.** The preference lives in
 * localStorage so a room that annoys someone once stays quiet afterwards.
 *
 * Browsers will not start audio without a gesture, so the context is created
 * lazily on the first cue and resumed on the first interaction — joining a
 * meeting is itself a gesture, which is why this works in practice.
 */

const STORAGE_KEY = 'orbit.sound';

export type SoundCue =
  | 'join'
  | 'leave'
  | 'message'
  | 'announcement'
  | 'poll'
  | 'quiz'
  | 'reaction'
  | 'recording'
  | 'error';

interface Note {
  /** Hertz. */
  frequency: number;
  /** Seconds from the start of the cue. */
  at: number;
  /** Seconds. */
  duration: number;
  /** Peak gain, 0–1. Kept low; these play over a live conversation. */
  gain?: number;
  type?: OscillatorType;
}

/**
 * The cues themselves.
 *
 * Deliberately distinguishable by shape rather than by volume: rising for
 * something arriving, falling for something leaving, a three-note phrase for
 * anything that asks the room to look at it.
 */
const CUES: Record<SoundCue, Note[]> = {
  // Someone arrives: a small rising third.
  join: [
    { frequency: 587.33, at: 0, duration: 0.12 },
    { frequency: 880.0, at: 0.09, duration: 0.16 },
  ],
  // Someone leaves: the same interval, falling.
  leave: [
    { frequency: 880.0, at: 0, duration: 0.12 },
    { frequency: 587.33, at: 0.09, duration: 0.18 },
  ],
  // Chat: one soft tap, because it happens most often.
  message: [{ frequency: 987.77, at: 0, duration: 0.11, gain: 0.05 }],
  // An announcement is the host speaking to everyone: three notes, warmer.
  announcement: [
    { frequency: 523.25, at: 0, duration: 0.14 },
    { frequency: 659.25, at: 0.11, duration: 0.14 },
    { frequency: 783.99, at: 0.22, duration: 0.26 },
  ],
  // A poll wants an answer: two even notes, like a question mark.
  poll: [
    { frequency: 698.46, at: 0, duration: 0.13 },
    { frequency: 1046.5, at: 0.13, duration: 0.2 },
  ],
  // A quiz is starting and is timed: more insistent, four rising notes.
  quiz: [
    { frequency: 523.25, at: 0, duration: 0.1 },
    { frequency: 659.25, at: 0.1, duration: 0.1 },
    { frequency: 783.99, at: 0.2, duration: 0.1 },
    { frequency: 1046.5, at: 0.3, duration: 0.3 },
  ],
  // A reaction is playful and frequent: one very short blip, quieter still.
  reaction: [{ frequency: 1174.66, at: 0, duration: 0.07, gain: 0.035 }],
  // Recording starting or stopping is serious: a low, flat pair.
  recording: [
    { frequency: 440.0, at: 0, duration: 0.16, type: 'triangle' },
    { frequency: 349.23, at: 0.16, duration: 0.28, type: 'triangle' },
  ],
  // Something went wrong: a low falling pair, unmistakably not a success.
  error: [
    { frequency: 415.3, at: 0, duration: 0.12, type: 'triangle' },
    { frequency: 311.13, at: 0.1, duration: 0.24, type: 'triangle' },
  ],
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let loaded = false;

/** The last time each cue played, so a burst cannot become a machine gun. */
const lastPlayed = new Map<SoundCue, number>();
const MIN_GAP_MS = 400;

function readPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // Private mode, or storage blocked. Sound on is the better default.
    return true;
  }
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!loaded) {
    enabled = readPreference();
    loaded = true;
  }
  if (!enabled) return null;

  if (!context) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);
  }

  // Autoplay policy suspends the context until a gesture; resuming is cheap
  // and a no-op when it is already running.
  if (context.state === 'suspended') void context.resume().catch(() => undefined);

  return context;
}

/** Plays one cue. Safe to call anywhere, including during render effects. */
export function playSound(cue: SoundCue): void {
  const ctx = ensureContext();
  if (!ctx || !master) return;

  const now = Date.now();
  const previous = lastPlayed.get(cue) ?? 0;
  if (now - previous < MIN_GAP_MS) return;
  lastPlayed.set(cue, now);

  const start = ctx.currentTime;

  for (const note of CUES[cue]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = note.type ?? 'sine';
    oscillator.frequency.value = note.frequency;

    /*
     * An envelope, not a switch.
     *
     * Starting and stopping an oscillator at full gain produces a click at
     * each end — the waveform jumps discontinuously. Ramping up over a few
     * milliseconds and decaying exponentially is what makes these read as
     * soft tones rather than as pops.
     */
    const peak = note.gain ?? 0.07;
    const at = start + note.at;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);

    oscillator.connect(gain);
    gain.connect(master);

    oscillator.start(at);
    oscillator.stop(at + note.duration + 0.02);
  }
}

// ------------------------------------------------------- connecting tone

let connectingTimer: number | null = null;

/**
 * A soft repeating pulse while the meeting is connecting.
 *
 * Deliberately not music. A loop of anything melodic becomes irritating within
 * seconds and, worse, sounds like the meeting has already started. This is two
 * quiet notes every couple of seconds — enough to say "still working" to
 * somebody who has looked away from the screen, and it stops the moment the
 * meeting connects or the attempt fails.
 */
export function startConnectingTone(): void {
  if (connectingTimer !== null) return;
  if (!ensureContext()) return;

  const pulse = () => {
    const ctx = ensureContext();
    if (!ctx || !master) return;

    const start = ctx.currentTime;
    for (const [index, frequency] of [392.0, 523.25].entries()) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      const at = start + index * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.035, at + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(at);
      oscillator.stop(at + 0.55);
    }
  };

  pulse();
  connectingTimer = window.setInterval(pulse, 2200);
}

export function stopConnectingTone(): void {
  if (connectingTimer === null) return;
  window.clearInterval(connectingTimer);
  connectingTimer = null;
}

// ------------------------------------------------------------ preference

export function soundEnabled(): boolean {
  if (!loaded) {
    enabled = readPreference();
    loaded = true;
  }
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  loaded = true;

  try {
    window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    // Not fatal: the setting simply will not survive a reload.
  }

  if (!next) {
    stopConnectingTone();
    // Silence anything mid-release rather than letting it ring out.
    if (master) master.gain.value = 0;
  } else if (master) {
    master.gain.value = 0.9;
  }
}
