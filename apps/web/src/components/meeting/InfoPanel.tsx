'use client';

import { buildInvitationText, formatMeetingCode } from '@orbit/shared';
import { Check, Copy, Lock, Unlock } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Toggle } from '@/components/ui/primitives';
import { capabilities } from '@/lib/capabilities';
import { meetingClient } from '@/lib/meeting-client';
import { useRoomStore } from '@/lib/room-store';

/**
 * Meeting information and, for hosts, live meeting policy.
 *
 * Every switch here writes through the server, which applies it to the SFU as
 * well as the UI — turning off screen sharing revokes the publish permission,
 * it does not merely hide a button.
 */
export function InfoPanel() {
  const meeting = useRoomStore((state) => state.meeting);
  const selfRole = useRoomStore((state) => state.selfRole);
  const [copied, setCopied] = useState<string | null>(null);

  const isHost = selfRole === 'HOST' || selfRole === 'COHOST';
  const isOwner = selfRole === 'HOST';

  if (!meeting) return null;

  const invitation = buildInvitationText({
    title: meeting.title,
    joinUrl: meeting.joinUrl,
    code: meeting.code,
    hostName: meeting.host.name,
    scheduledAt: meeting.scheduledAt,
  });

  async function copy(value: string, key: string) {
    try {
      if (capabilities().clipboard) await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be denied by policy; the values stay selectable.
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim p-4">
      <section aria-label="Meeting details" className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-500">Meeting</p>
          <p className="mt-1 font-medium text-ink-100">{meeting.title}</p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-ink-500">Meeting ID</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-white/5 px-3 py-2 font-mono text-sm tracking-wider text-ink-100">
              {formatMeetingCode(meeting.code)}
            </code>
            <button
              type="button"
              onClick={() => copy(meeting.code, 'code')}
              aria-label="Copy meeting ID"
              className="rounded-lg p-2 text-ink-400 transition-colors hover:bg-white/10 hover:text-ink-100"
            >
              {copied === 'code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-ink-500">Link</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white/5 px-3 py-2 font-mono text-xs text-ink-100">
              {meeting.joinUrl}
            </code>
            <button
              type="button"
              onClick={() => copy(meeting.joinUrl, 'link')}
              aria-label="Copy meeting link"
              className="rounded-lg p-2 text-ink-400 transition-colors hover:bg-white/10 hover:text-ink-100"
            >
              {copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button variant="secondary" size="sm" fullWidth onClick={() => copy(invitation, 'invite')}>
          {copied === 'invite' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied === 'invite' ? 'Invitation copied' : 'Copy invitation'}
        </Button>

        <div className="flex flex-wrap gap-2">
          <Badge tone={meeting.locked ? 'danger' : 'success'}>
            {meeting.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            {meeting.locked ? 'Locked' : 'Open'}
          </Badge>
          {meeting.hasPassword && <Badge tone="brand">Passcode required</Badge>}
          {meeting.settings.waitingRoomEnabled && <Badge tone="warning">Waiting room on</Badge>}
        </div>

        <p className="rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-ink-400">
          Media is encrypted in transit with DTLS-SRTP, the standard WebRTC does for every browser
          call. The meeting runs on this deployment&apos;s own server.
        </p>
      </section>

      {isHost && (
        <section aria-label="Host controls" className="mt-6 border-t border-white/10 pt-4">
          <h3 className="text-sm font-semibold text-ink-100">Host controls</h3>
          <p className="mt-1 text-xs text-ink-400">Changes apply to everyone immediately.</p>

          <div className="mt-2 divide-y divide-white/5 [&_label]:text-ink-100 [&_p]:text-ink-400">
            <Toggle
              label="Lock the meeting"
              description="Nobody new can join. People already here stay."
              checked={meeting.locked}
              onChange={(value) => void meetingClient.setLocked(value)}
            />
            <Toggle
              label="Waiting room"
              description="Approve each person before they enter."
              checked={meeting.settings.waitingRoomEnabled}
              onChange={(value) => void meetingClient.updateSettings({ waitingRoomEnabled: value })}
            />
            <Toggle
              label="Chat"
              description="Let participants send messages."
              checked={meeting.settings.chatEnabled}
              onChange={(value) => void meetingClient.updateSettings({ chatEnabled: value })}
            />
            <Toggle
              label="Anyone can present"
              description="Turn off to limit screen sharing to hosts."
              checked={meeting.settings.screenShareMode === 'EVERYONE'}
              onChange={(value) =>
                void meetingClient.updateSettings({ screenShareMode: value ? 'EVERYONE' : 'HOSTS_ONLY' })
              }
            />
            {isOwner && (
              <Toggle
                label="Allow recording"
                description="Lets the host start a server-side recording."
                checked={meeting.settings.recordingEnabled}
                onChange={(value) => void meetingClient.updateSettings({ recordingEnabled: value })}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
