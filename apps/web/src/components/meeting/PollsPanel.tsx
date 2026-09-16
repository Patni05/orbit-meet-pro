'use client';

import type { PollPayload } from '@orbit/shared';
import { BarChart3, Check, Lock, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/primitives';
import { meetingClient } from '@/lib/meeting-client';
import { selectIsHost, useRoomStore } from '@/lib/room-store';

/**
 * Live polls.
 *
 * The tallies shown here are whatever the server chose to send. While a poll
 * is open and the host asked to hide interim results, an option's `votes` is
 * genuinely `null` on the wire rather than merely unrendered — so there is no
 * number sitting in the payload for a curious participant to read.
 */
export function PollsPanel() {
  const polls = useRoomStore((state) => state.polls);
  const isHost = useRoomStore(selectIsHost);
  const [composing, setComposing] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim">
      {isHost && (
        <div className="border-b border-white/10 p-4">
          {composing ? (
            <PollComposer onDone={() => setComposing(false)} />
          ) : (
            <Button size="sm" fullWidth onClick={() => setComposing(true)}>
              <Plus className="h-4 w-4" />
              New poll
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 space-y-4 p-4">
        {polls.length === 0 ? (
          <div className="pt-10 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-ink-600" aria-hidden="true" />
            <p className="mt-3 text-sm text-ink-400">No polls yet.</p>
            {isHost && (
              <p className="mt-1 text-xs text-ink-500">Ask the room a question and see the answers live.</p>
            )}
          </div>
        ) : (
          polls.map((poll) => <PollCard key={poll.id} poll={poll} isHost={isHost} />)
        )}
      </div>
    </div>
  );
}

function PollComposer({ onDone }: { onDone: () => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiSelect, setMultiSelect] = useState(false);
  const [hideResults, setHideResults] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const filled = options.map((option) => option.trim()).filter(Boolean);
    if (!question.trim()) return setError('Ask a question.');
    if (filled.length < 2) return setError('Give people at least two options.');

    setBusy(true);
    const result = await meetingClient.createPoll({
      question: question.trim(),
      options: filled,
      multiSelect,
      hideResultsUntilClosed: hideResults,
    });
    setBusy(false);

    if (result.ok) onDone();
    else setError(result.message ?? 'The poll could not be created.');
  }

  const field =
    'w-full rounded-lg border border-white/15 bg-ink-850 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-2 focus:outline-brand-500';

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <p role="alert" className="text-xs text-danger-400">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="poll-question" className="text-xs font-medium text-ink-300">
          Question
        </label>
        <input
          id="poll-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={300}
          placeholder="What should we do first?"
          className={`mt-1 ${field}`}
        />
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-ink-300">Options</legend>
        <div className="mt-1 space-y-2">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={option}
                onChange={(event) =>
                  setOptions((current) => current.map((v, i) => (i === index ? event.target.value : v)))
                }
                maxLength={120}
                aria-label={`Option ${index + 1}`}
                placeholder={`Option ${index + 1}`}
                className={field}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Remove option ${index + 1}`}
                  className="shrink-0 rounded-lg p-2 text-ink-400 transition-colors hover:bg-white/10 hover:text-danger-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < 10 && (
          <button
            type="button"
            onClick={() => setOptions((current) => [...current, ''])}
            className="mt-2 text-xs font-medium text-brand-400 hover:underline"
          >
            Add option
          </button>
        )}
      </fieldset>

      <div className="space-y-2 rounded-lg bg-white/5 p-3">
        <label className="flex items-center gap-2 text-xs text-ink-200">
          <input
            type="checkbox"
            checked={multiSelect}
            onChange={(event) => setMultiSelect(event.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-ink-850"
          />
          Allow more than one answer
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-200">
          <input
            type="checkbox"
            checked={hideResults}
            onChange={(event) => setHideResults(event.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-ink-850"
          />
          Hide results until the poll closes
        </label>
        <p className="text-[11px] leading-relaxed text-ink-500">
          Hiding results keeps a running tally from swaying later answers. You can always see it.
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} className="flex-1">
          Start poll
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PollCard({ poll, isHost }: { poll: PollPayload; isHost: boolean }) {
  const [pending, setPending] = useState<string[] | null>(null);
  const open = poll.status === 'OPEN';
  const selected = pending ?? poll.myOptionIds;

  async function toggle(optionId: string) {
    if (!open) return;

    const next = poll.multiSelect
      ? selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId]
      : [optionId];

    // Optimistic, then reconciled from the server's reply — which is also what
    // tells us whether we are allowed to see the tally yet.
    setPending(next);
    const result = await meetingClient.vote(poll.id, next);
    if (!result.ok) setPending(null);
  }

  const totalVotes = poll.options.reduce((sum, option) => sum + (option.votes ?? 0), 0);
  const tallyVisible = poll.options.some((option) => option.votes !== null);

  return (
    <article className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 break-anywhere text-sm font-medium text-ink-100">{poll.question}</h3>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            open ? 'bg-success-500/20 text-success-400' : 'bg-white/10 text-ink-400'
          }`}
        >
          {open ? 'Open' : 'Closed'}
        </span>
      </div>

      <p className="mt-1 text-xs text-ink-500">
        {poll.multiSelect ? 'Choose any number' : 'Choose one'} ·{' '}
        {poll.responseCount} {poll.responseCount === 1 ? 'response' : 'responses'}
      </p>

      <ul className="mt-3 space-y-2">
        {poll.options.map((option) => {
          const chosen = selected.includes(option.id);
          const share = tallyVisible && totalVotes > 0 ? ((option.votes ?? 0) / totalVotes) * 100 : 0;

          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => void toggle(option.id)}
                disabled={!open}
                aria-pressed={chosen}
                className={`relative w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  chosen
                    ? 'border-brand-500 bg-brand-500/15 text-white'
                    : 'border-white/10 bg-ink-850 text-ink-200 hover:border-white/20'
                } ${open ? '' : 'cursor-default opacity-90'}`}
              >
                {/* The bar is a background layer so the label never reflows as
                    numbers change. */}
                {tallyVisible && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 bg-brand-500/20 transition-[width] duration-500 ease-out"
                    style={{ width: `${share}%` }}
                  />
                )}

                <span className="relative flex items-center gap-2">
                  {chosen && <Check className="h-4 w-4 shrink-0 text-brand-300" />}
                  <span className="min-w-0 flex-1 break-anywhere">{option.label}</span>
                  {tallyVisible && (
                    <span className="shrink-0 text-xs tabular-nums text-ink-300">
                      {option.votes} · {Math.round(share)}%
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {!tallyVisible && open && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-500">
          <Lock className="h-3 w-3" />
          Results are hidden until the poll closes.
        </p>
      )}

      {isHost && open && (
        <Button
          size="sm"
          variant="secondary"
          fullWidth
          className="mt-3"
          onClick={() => void meetingClient.closePoll(poll.id)}
        >
          <X className="h-4 w-4" />
          Close poll and show results
        </Button>
      )}
    </article>
  );
}
