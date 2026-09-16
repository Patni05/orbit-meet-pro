'use client';

import { CHAT_MESSAGE_MAX_LENGTH } from '@orbit/shared';
import { Send, Smile } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { useRoomStore } from '@/lib/room-store';

const QUICK_EMOJI = ['👍', '🎉', '😄', '❤️', '🙏', '👏', '🔥', '✅'];

/**
 * Meeting chat.
 *
 * Messages are rendered as text nodes — never with dangerouslySetInnerHTML —
 * so markup in a message is displayed, not executed. That, plus the server-side
 * sanitising of control characters, is the whole XSS story here.
 */
export function ChatPanel() {
  const messages = useRoomStore((state) => state.messages);
  const selfIdentity = useRoomStore((state) => state.selfIdentity);
  const chatEnabled = useRoomStore((state) => state.meeting?.settings.chatEnabled ?? true);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinnedToBottom = useRef(true);

  /**
   * Autoscroll, but only when the reader is already at the bottom — scrolling
   * someone away from a message they are reading is worse than a missed one.
   */
  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [messages]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    pinnedToBottom.current = distanceFromBottom < 80;
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);

    const { meetingClient } = await import('@/lib/meeting-client');
    const result = await meetingClient.sendChat(body);

    if (result.ok) {
      setDraft('');
      pinnedToBottom.current = true;
    } else {
      setError(result.message ?? 'Message could not be sent.');
    }
    setSending(false);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter makes a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const grouped = useMemo(() => groupMessages(messages), [messages]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 space-y-4 overflow-y-auto scrollbar-slim px-4 py-4"
        role="log"
        aria-label="Meeting chat"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-ink-400">
            No messages yet. Anything you send here is visible to everyone in the meeting.
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.key} className="flex gap-2.5">
              <Avatar name={group.senderName} seed={group.senderIdentity} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-ink-100">
                    {group.senderIdentity === selfIdentity ? 'You' : group.senderName}
                  </span>
                  <time
                    dateTime={group.sentAt}
                    className="shrink-0 text-[11px] text-ink-500"
                    title={new Date(group.sentAt).toLocaleString()}
                  >
                    {new Date(group.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
                <div className="mt-0.5 space-y-1">
                  {group.bodies.map((body, index) => (
                    <p
                      key={`${group.key}-${index}`}
                      className="whitespace-pre-wrap break-anywhere text-sm leading-relaxed text-ink-200"
                    >
                      {body}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {chatEnabled ? (
        <form onSubmit={send} className="relative border-t border-white/10 p-3">
          {emojiOpen && (
            <div className="absolute bottom-full left-3 mb-2 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-ink-850 p-2 shadow-xl">
              {QUICK_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setDraft((current) => current + emoji);
                    setEmojiOpen(false);
                    inputRef.current?.focus();
                  }}
                  className="rounded-lg p-1.5 text-xl transition-transform hover:scale-110 hover:bg-white/10"
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p role="alert" className="mb-2 text-xs text-danger-400">
              {error}
            </p>
          )}

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              aria-label="Insert an emoji"
              aria-expanded={emojiOpen}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-400 transition-colors hover:bg-white/10 hover:text-ink-100"
            >
              <Smile className="h-5 w-5" />
            </button>

            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value.slice(0, CHAT_MESSAGE_MAX_LENGTH));
                // Grow with the content, up to a cap.
                const el = event.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
              onKeyDown={onKeyDown}
              placeholder="Send a message"
              className="max-h-30 min-h-10 flex-1 resize-none rounded-xl border border-white/15 bg-ink-850 px-3 py-2.5 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-2 focus:outline-brand-500"
            />

            <button
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-500 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          {draft.length > CHAT_MESSAGE_MAX_LENGTH - 200 && (
            <p className="mt-1 text-right text-[11px] text-ink-500">
              {CHAT_MESSAGE_MAX_LENGTH - draft.length} characters left
            </p>
          )}
        </form>
      ) : (
        <div className="border-t border-white/10 p-4 text-center text-sm text-ink-400">
          The host has turned chat off.
        </div>
      )}
    </div>
  );
}

interface MessageGroup {
  key: string;
  senderIdentity: string;
  senderName: string;
  sentAt: string;
  bodies: string[];
}

/** Consecutive messages from one person within two minutes share a header. */
function groupMessages(
  messages: { id: string; senderIdentity: string; senderName: string; body: string; sentAt: string }[],
): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const message of messages) {
    const last = groups[groups.length - 1];
    const withinWindow =
      last &&
      last.senderIdentity === message.senderIdentity &&
      new Date(message.sentAt).getTime() - new Date(last.sentAt).getTime() < 120_000;

    if (withinWindow) {
      last.bodies.push(message.body);
    } else {
      groups.push({
        key: message.id,
        senderIdentity: message.senderIdentity,
        senderName: message.senderName,
        sentAt: message.sentAt,
        bodies: [message.body],
      });
    }
  }

  return groups;
}
