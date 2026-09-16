'use client';

import { buildInvitationText, formatMeetingCode } from '@orbit/shared';
import { Check, Copy, Link2, Lock, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/primitives';
import { capabilities } from '@/lib/capabilities';

/**
 * Meeting information and invitation.
 *
 * Offers the link, the code and a ready-made invitation. The passcode is shown
 * only to whoever already has it (the host who set it) — it is never fetched
 * from the server for participants.
 */
export function InviteDialog({
  open,
  onClose,
  title,
  joinUrl,
  code,
  password,
  hostName,
  scheduledAt,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  joinUrl: string;
  code: string;
  password?: string | null;
  hostName?: string;
  scheduledAt?: string | null;
}) {
  const [copied, setCopied] = useState<'link' | 'invite' | null>(null);

  const invitation = buildInvitationText({
    title,
    joinUrl,
    code,
    password,
    hostName,
    scheduledAt,
  });

  async function copy(value: string, which: 'link' | 'invite') {
    try {
      if (capabilities().clipboard) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for browsers without the async clipboard API.
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard can be blocked by policy; the text is selectable either way.
    }
  }

  /**
   * The OS share sheet, where there is one. This is how an invitation actually
   * travels on a phone — into WhatsApp or a message — so it leads on mobile and
   * simply does not render elsewhere.
   */
  async function shareNatively() {
    try {
      await navigator.share({ title, text: invitation, url: joinUrl });
    } catch {
      // Dismissing the sheet rejects the promise; that is a normal choice.
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share this meeting" size="md">
      <div className="space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Meeting
          </p>
          <p className="mt-1 font-medium">{title}</p>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Meeting link
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-100 px-3 py-2.5 font-mono text-sm dark:bg-white/5">
              {joinUrl}
            </code>
            <Button variant="secondary" size="sm" onClick={() => copy(joinUrl, 'link')}>
              {copied === 'link' ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {copied === 'link' ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
              Meeting ID
            </p>
            <p className="mt-1.5 font-mono text-sm tracking-wider">{formatMeetingCode(code)}</p>
          </div>

          {password && (
            <div>
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
                <Lock className="h-3 w-3" />
                Passcode
              </p>
              <p className="mt-1.5 font-mono text-sm tracking-wider">{password}</p>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Invitation
          </p>
          <pre className="mt-1.5 max-h-48 overflow-auto scrollbar-slim whitespace-pre-wrap break-anywhere rounded-lg bg-ink-100 p-3 text-xs leading-relaxed dark:bg-white/5">
            {invitation}
          </pre>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        {capabilities().webShare && (
          <Button variant="secondary" onClick={() => void shareNatively()}>
            <Share2 className="h-4 w-4" />
            Share…
          </Button>
        )}
        <Button onClick={() => copy(invitation, 'invite')}>
          {copied === 'invite' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied === 'invite' ? 'Copied' : 'Copy invitation'}
        </Button>
      </div>
    </Modal>
  );
}
