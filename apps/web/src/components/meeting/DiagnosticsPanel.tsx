'use client';

import { ConnectionQuality } from 'livekit-client';
import { useEffect, useState } from 'react';
import { capabilities } from '@/lib/capabilities';
import { meetingClient } from '@/lib/meeting-client';
import { useRoomStore } from '@/lib/room-store';

/**
 * Connection information.
 *
 * Two audiences in one panel: a plain-language verdict for anyone wondering
 * why the call looks rough, and the underlying WebRTC numbers for whoever is
 * debugging it. No tokens, identities or secrets are shown.
 */
export function DiagnosticsPanel() {
  const stats = useRoomStore((state) => state.networkStats);
  const meeting = useRoomStore((state) => state.meeting);
  const selfIdentity = useRoomStore((state) => state.selfIdentity);
  const phase = useRoomStore((state) => state.phase);
  const participants = useRoomStore((state) => state.order.length);

  const [roomInfo, setRoomInfo] = useState<{ state: string; url: string }>({ state: 'unknown', url: '' });
  const isDev = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    const timer = setInterval(() => {
      const room = meetingClient.room;
      const livekitUrl = meetingClient.currentTicket?.livekitUrl;
      let host = '';
      if (livekitUrl) {
        // Host only — the participant token never appears here.
        try {
          host = new URL(livekitUrl).host;
        } catch {
          host = '';
        }
      }
      setRoomInfo({ state: room?.state ?? 'disconnected', url: host });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const verdict = describeQuality(stats.quality, stats.packetLoss, phase);
  const caps = capabilities();

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim p-4">
      <div className={`rounded-xl border p-4 ${verdict.className}`}>
        <p className="text-sm font-semibold">{verdict.title}</p>
        <p className="mt-1 text-xs leading-relaxed opacity-90">{verdict.description}</p>
      </div>

      <section className="mt-5" aria-label="Network statistics">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Network</h3>
        <dl className="mt-2 space-y-1.5">
          <Stat label="Round trip" value={stats.latencyMs > 0 ? `${stats.latencyMs} ms` : '—'} />
          <Stat label="Packet loss" value={`${stats.packetLoss.toFixed(1)}%`} />
          <Stat label="Jitter" value={stats.jitterMs > 0 ? `${stats.jitterMs} ms` : '—'} />
          <Stat label="Sending" value={`${formatKbps(stats.outboundKbps)}`} />
          <Stat label="Receiving" value={`${formatKbps(stats.inboundKbps)}`} />
        </dl>
      </section>

      <section className="mt-5" aria-label="Meeting">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Meeting</h3>
        <dl className="mt-2 space-y-1.5">
          <Stat label="Connection" value={phase} />
          <Stat label="SFU state" value={roomInfo.state} />
          {roomInfo.url && <Stat label="Media server" value={roomInfo.url} />}
          <Stat label="Participants" value={String(participants)} />
          {meeting && <Stat label="Meeting ID" value={meeting.code} />}
        </dl>
      </section>

      <section className="mt-5" aria-label="Browser support">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">This browser</h3>
        <dl className="mt-2 space-y-1.5">
          <Stat label="Screen sharing" value={caps.screenShare ? 'Supported' : 'Not supported'} />
          <Stat label="Speaker selection" value={caps.speakerSelection ? 'Supported' : 'Not supported'} />
          <Stat label="Picture-in-picture" value={caps.pictureInPicture ? 'Supported' : 'Not supported'} />
          <Stat label="Secure context" value={caps.secureContext ? 'Yes' : 'No — HTTPS required'} />
        </dl>
      </section>

      {/* Developer detail, deliberately absent from production builds. */}
      {isDev && selfIdentity && (
        <section className="mt-5 rounded-xl bg-white/5 p-3" aria-label="Developer details">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Development</h3>
          <dl className="mt-2 space-y-1.5">
            <Stat label="Your identity" value={selfIdentity} />
            <Stat label="Adaptive stream" value="on" />
            <Stat label="Dynacast" value="on" />
            <Stat label="Simulcast layers" value="180p / 360p / 720p" />
          </dl>
          <p className="mt-2 text-[11px] text-ink-500">
            Shown in development builds only. Tokens and secrets are never displayed.
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-ink-400">{label}</dt>
      <dd className="truncate font-mono text-xs text-ink-100">{value}</dd>
    </div>
  );
}

function formatKbps(kbps: number): string {
  if (kbps <= 0) return '—';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

/** Plain-language summary, so the panel is useful to someone who is not an engineer. */
function describeQuality(
  quality: ConnectionQuality | 'unknown',
  packetLoss: number,
  phase: string,
): { title: string; description: string; className: string } {
  if (phase === 'reconnecting') {
    return {
      title: 'Reconnecting',
      description: 'Your connection dropped. We are putting you back into the meeting.',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    };
  }

  if (quality === ConnectionQuality.Poor || packetLoss > 5) {
    return {
      title: 'Poor connection',
      description:
        'Video quality has been reduced to keep audio clear. Moving closer to your router or turning off your camera will help.',
      className: 'border-danger-500/30 bg-danger-500/10 text-danger-200',
    };
  }

  if (quality === ConnectionQuality.Good || packetLoss > 1) {
    return {
      title: 'Good connection',
      description: 'Everything is working. You may see occasional dips in video sharpness.',
      className: 'border-warning-500/30 bg-warning-500/10 text-warning-200',
    };
  }

  if (quality === ConnectionQuality.Excellent) {
    return {
      title: 'Excellent connection',
      description: 'Audio and video are running at full quality.',
      className: 'border-success-500/30 bg-success-500/10 text-success-400',
    };
  }

  return {
    title: 'Measuring connection',
    description: 'Collecting statistics from your connection.',
    className: 'border-white/10 bg-white/5 text-ink-300',
  };
}
