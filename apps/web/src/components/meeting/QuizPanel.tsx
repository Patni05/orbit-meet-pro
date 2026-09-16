'use client';

import type { QuizLiveView, QuizResults, QuizSettings } from '@orbit/shared';
import {
  Check,
  Download,
  GraduationCap,
  Plus,
  Timer,
  Trash2,
  Trophy,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/primitives';
import { meetingClient } from '@/lib/meeting-client';
import { selectIsHost, useRoomStore } from '@/lib/room-store';

/**
 * Live quiz.
 *
 * The countdown here is derived from the server's `endsAt` and the clock skew
 * measured at join, never from a local interval that started when the
 * component mounted. Refreshing, sleeping the laptop or editing anything in
 * the page therefore buys no extra time — the deadline is a fact the server
 * already decided.
 *
 * Correct answers are absent from a participant's payload until the quiz's
 * reveal rules allow them, so nothing here needs to hide a key it was given.
 */
export function QuizPanel() {
  const quiz = useRoomStore((state) => state.quiz);
  const starting = useRoomStore((state) => state.quizStarting);
  const results = useRoomStore((state) => state.quizResults);
  const isHost = useRoomStore(selectIsHost);

  if (starting) return <QuizLobby starting={starting} />;
  if (results) return <QuizResultsView results={results} isHost={isHost} />;
  if (quiz && quiz.status === 'RUNNING') return <QuizTaking quiz={quiz} isHost={isHost} />;
  if (isHost) return <QuizHostHome />;

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <GraduationCap className="h-8 w-8 text-ink-600" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-400">No quiz is running.</p>
      <p className="mt-1 text-xs text-ink-500">The host will start one when they are ready.</p>
    </div>
  );
}

// ------------------------------------------------------------------- timer

/**
 * Remaining time against a server deadline.
 *
 * `serverTime` from the payload is compared with the local clock once, and the
 * difference is applied to every later tick. A device with a wrong clock — or
 * a user who changes it — still sees the same countdown as everyone else.
 */
function useServerCountdown(endsAt: string | null, serverTime: string | null): number {
  const offsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (serverTime) offsetRef.current = new Date(serverTime).getTime() - Date.now();
  }, [serverTime]);

  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [endsAt]);

  if (!endsAt) return 0;
  return Math.max(0, new Date(endsAt).getTime() - (now + offsetRef.current));
}

function formatMs(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ------------------------------------------------------------------- lobby

function QuizLobby({
  starting,
}: {
  starting: { quizId: string; title: string; questionCount: number; startsAt: number };
}) {
  const [remaining, setRemaining] = useState(() => starting.startsAt - Date.now());

  useEffect(() => {
    const timer = setInterval(() => setRemaining(starting.startsAt - Date.now()), 100);
    return () => clearInterval(timer);
  }, [starting.startsAt]);

  const seconds = Math.max(0, Math.ceil(remaining / 1000));

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <GraduationCap className="h-10 w-10 text-brand-400" aria-hidden="true" />
      <h3 className="mt-4 text-lg font-semibold text-ink-100">{starting.title}</h3>
      <p className="mt-1 text-sm text-ink-400">
        {starting.questionCount} {starting.questionCount === 1 ? 'question' : 'questions'}
      </p>

      <p
        className="mt-8 font-mono text-6xl font-bold tabular-nums text-brand-400"
        aria-live="polite"
        aria-label={`Starting in ${seconds}`}
      >
        {seconds > 0 ? seconds : 'Go'}
      </p>
      <p className="mt-3 text-xs text-ink-500">Starting…</p>
    </div>
  );
}

// ------------------------------------------------------------------ taking

function QuizTaking({ quiz, isHost }: { quiz: QuizLiveView; isHost: boolean }) {
  const progress = useRoomStore((state) => state.quizProgress);
  const [answers, setAnswers] = useState<Record<string, string[]>>(quiz.myAnswers);
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const perQuestion = quiz.settings.timerMode === 'PER_QUESTION';
  const deadline = perQuestion ? quiz.currentQuestionEndsAt : quiz.endsAt;
  const remaining = useServerCountdown(deadline, quiz.serverTime);

  // Restore answers whenever the server sends a fresh view, so a reconnect
  // shows what was actually recorded rather than local guesses.
  useEffect(() => setAnswers(quiz.myAnswers), [quiz.myAnswers]);

  /**
   * Tab-away counter, recorded as a plain number for the host's information.
   * Deliberately not used to accuse anyone of anything.
   */
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') void meetingClient.reportQuizAway(quiz.id);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [quiz.id]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    await meetingClient.submitQuiz(quiz.id);
    setSubmitting(false);
  }, [quiz.id]);

  // When the clock runs out the server finalises the attempt; submitting here
  // as well just saves a round trip and is harmless if it loses the race.
  useEffect(() => {
    if (remaining <= 0 && deadline && !quiz.mySubmittedAt && !isHost) void submit();
  }, [remaining, deadline, quiz.mySubmittedAt, isHost, submit]);

  const questions = quiz.questions;
  const current = questions[Math.min(index, questions.length - 1)];

  async function choose(questionId: string, optionId: string, multi: boolean) {
    const existing = answers[questionId] ?? [];
    const next = multi
      ? existing.includes(optionId)
        ? existing.filter((id) => id !== optionId)
        : [...existing, optionId]
      : [optionId];

    setAnswers((current) => ({ ...current, [questionId]: next }));
    const result = await meetingClient.answerQuiz(quiz.id, questionId, next);
    // The server is the record; roll back a refused answer rather than showing
    // a selection that was not stored.
    if (!result.ok) setAnswers((current) => ({ ...current, [questionId]: existing }));
  }

  if (quiz.mySubmittedAt && !isHost) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <Check className="h-10 w-10 text-success-400" aria-hidden="true" />
        <h3 className="mt-4 text-lg font-semibold text-ink-100">Answers submitted</h3>
        <p className="mt-2 text-sm text-ink-400">Results appear when the quiz ends.</p>
        {deadline && (
          <p className="mt-4 font-mono text-2xl tabular-nums text-ink-300">{formatMs(remaining)}</p>
        )}
      </div>
    );
  }

  const answeredCount = questions.filter((q) => (answers[q.id] ?? []).length > 0).length;
  const urgent = remaining <= 10_000 && remaining > 0;

  return (
    <div className="flex h-full flex-col">
      {/* ---- header: title, clock ---- */}
      <div className="shrink-0 border-b border-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">{quiz.title}</h3>
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-sm font-semibold tabular-nums ${
              urgent ? 'bg-danger-500/20 text-danger-300' : 'bg-white/10 text-ink-200'
            }`}
            role="timer"
            aria-live={urgent ? 'assertive' : 'off'}
          >
            <Timer className="h-3.5 w-3.5" />
            {formatMs(remaining)}
          </span>
        </div>

        {isHost && progress && (
          <p className="mt-2 text-xs text-ink-400">
            {progress.submitted} of {progress.joined} submitted
          </p>
        )}

        {quiz.settings.negativeMarking && (
          <p className="mt-2 rounded-lg bg-warning-500/15 px-2.5 py-1.5 text-[11px] text-warning-200">
            Negative marking is on: −{quiz.settings.negativePoints} for a wrong answer.
          </p>
        )}

        {/* ---- question map ---- */}
        {questions.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5" role="list" aria-label="Questions">
            {questions.map((question, position) => {
              const answered = (answers[question.id] ?? []).length > 0;
              const isCurrent = position === index;
              return (
                <button
                  key={question.id}
                  type="button"
                  role="listitem"
                  onClick={() => setIndex(position)}
                  aria-current={isCurrent}
                  aria-label={`Question ${position + 1}${answered ? ', answered' : ', unanswered'}`}
                  className={`h-8 w-8 rounded-lg text-xs font-semibold transition-colors ${
                    isCurrent
                      ? 'bg-brand-600 text-white'
                      : answered
                        ? 'bg-success-500/25 text-success-300'
                        : 'bg-white/10 text-ink-400 hover:bg-white/20'
                  }`}
                >
                  {position + 1}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- the question ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim p-4">
        {current && (
          <>
            <p className="text-xs text-ink-500">
              Question {index + 1} of {questions.length} · {current.points} points
            </p>
            <h4 className="mt-2 break-anywhere text-base font-medium leading-relaxed text-ink-100">
              {current.prompt}
            </h4>
            {current.kind === 'MULTI' && (
              <p className="mt-1 text-xs text-brand-300">Select every correct answer.</p>
            )}

            <ul className="mt-4 space-y-2">
              {current.options.map((option) => {
                const chosen = (answers[current.id] ?? []).includes(option.id);
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      onClick={() => void choose(current.id, option.id, current.kind === 'MULTI')}
                      aria-pressed={chosen}
                      // Large touch target: this is answered on phones as often
                      // as on desktops, under time pressure.
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-sm transition-colors ${
                        chosen
                          ? 'border-brand-500 bg-brand-500/15 text-white'
                          : 'border-white/10 bg-ink-850 text-ink-200 hover:border-white/25'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center border ${
                          current.kind === 'MULTI' ? 'rounded' : 'rounded-full'
                        } ${chosen ? 'border-brand-400 bg-brand-500' : 'border-white/30'}`}
                      >
                        {chosen && <Check className="h-3 w-3 text-white" />}
                      </span>
                      <span className="min-w-0 flex-1 break-anywhere">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* ---- navigation ---- */}
      <div className="shrink-0 space-y-2 border-t border-white/10 p-4">
        {questions.length > 1 && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={index >= questions.length - 1}
              onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
            >
              Next
            </Button>
          </div>
        )}

        {isHost ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => void meetingClient.extendQuiz(quiz.id, 30)}
            >
              +30 seconds
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              onClick={() => {
                if (
                  window.confirm(
                    'End the quiz now? Unanswered questions will be submitted as unanswered.',
                  )
                ) {
                  void meetingClient.endQuiz(quiz.id);
                }
              }}
            >
              End quiz
            </Button>
          </div>
        ) : (
          <Button fullWidth loading={submitting} onClick={() => void submit()}>
            Submit {answeredCount} of {questions.length}
          </Button>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- results

function QuizResultsView({ results, isHost }: { results: QuizResults; isHost: boolean }) {
  const [tab, setTab] = useState<'leaderboard' | 'questions'>('leaderboard');
  const podium = results.leaderboard.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];

  async function exportCsv(detailed: boolean) {
    const result = await meetingClient.exportQuiz(results.quizId, detailed);
    if (!result.ok || !result.data) return;

    // A Blob download keeps the file entirely client-side: no temporary
    // object on the server, and nothing to leak through a guessable URL.
    const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.data.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim">
      <div className="border-b border-white/10 p-4">
        <h3 className="text-sm font-semibold text-ink-100">{results.title}</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          {results.participantCount} {results.participantCount === 1 ? 'participant' : 'participants'} ·{' '}
          {results.questionCount} questions
        </p>

        {results.me && (
          <div className="mt-3 rounded-xl border border-brand-500/30 bg-brand-500/10 p-3">
            <p className="text-xs text-brand-200">Your result</p>
            <p className="mt-1 text-2xl font-bold text-white">
              {results.me.score}
              <span className="text-sm font-normal text-ink-400"> points</span>
            </p>
            <p className="mt-1 text-xs text-ink-300">
              {results.me.correctCount} correct · {results.me.wrongCount} wrong ·{' '}
              {results.me.unansweredCount} unanswered · {results.me.accuracy}% accuracy
            </p>
            {results.leaderboard.length > 1 && (
              <p className="mt-1 text-xs font-medium text-brand-300">
                Rank #{results.me.rank} of {results.participantCount}
              </p>
            )}
          </div>
        )}
      </div>

      {podium.length > 0 && (
        <div className="border-b border-white/10 p-4">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <Trophy className="h-3.5 w-3.5" />
            Top {podium.length}
          </h4>
          <ol className="mt-3 space-y-2">
            {podium.map((row, position) => (
              <li key={row.participantId} className="flex items-center gap-2.5">
                <span className="text-lg" aria-hidden="true">
                  {medals[position]}
                </span>
                <Avatar name={row.displayName} src={row.avatarUrl} seed={row.participantId} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-100">{row.displayName}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-200">
                  {row.score}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {isHost && (
        <div className="grid grid-cols-2 gap-2 border-b border-white/10 p-4 text-xs">
          <Stat label="Average score" value={String(results.averageScore)} />
          <Stat label="Average accuracy" value={`${results.averageAccuracy}%`} />
          <Stat label="Highest" value={String(results.highestScore)} />
          <Stat label="Lowest" value={String(results.lowestScore)} />
          {results.easiest && (
            <Stat label="Easiest" value={`Q${results.easiest.position + 1} · ${results.easiest.accuracy}%`} />
          )}
          {results.hardest && (
            <Stat label="Hardest" value={`Q${results.hardest.position + 1} · ${results.hardest.accuracy}%`} />
          )}
        </div>
      )}

      {results.questions && (
        <div className="flex gap-1 border-b border-white/10 px-4 pt-3" role="tablist">
          {(['leaderboard', 'questions'] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-t-lg px-3 py-2 text-xs font-medium capitalize ${
                tab === id ? 'bg-white/10 text-white' : 'text-ink-400 hover:text-ink-100'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 p-4">
        {tab === 'leaderboard' || !results.questions ? (
          <ol className="space-y-1.5">
            {results.leaderboard.map((row) => (
              <li
                key={row.participantId}
                className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2"
              >
                <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-ink-400">
                  {row.rank}
                </span>
                <Avatar name={row.displayName} src={row.avatarUrl} seed={row.participantId} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-100">{row.displayName}</p>
                  <p className="text-[11px] text-ink-500">
                    {row.correctCount}✓ {row.wrongCount}✗ · {row.accuracy}% ·{' '}
                    {formatMs(row.timeTakenMs)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-200">
                  {row.score}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="space-y-3">
            {results.questions.map((question) => (
              <li key={question.questionId} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-ink-500">Question {question.position + 1}</p>
                <p className="mt-1 break-anywhere text-sm text-ink-100">{question.prompt}</p>
                <p className="mt-2 text-xs text-ink-400">
                  {question.correctCount} of {results.participantCount} correct · {question.accuracy}%
                </p>

                <ul className="mt-2 space-y-1">
                  {question.optionCounts.map((option) => {
                    const correct = question.correctOptionIds.includes(option.optionId);
                    return (
                      <li
                        key={option.optionId}
                        className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                          correct ? 'bg-success-500/15 text-success-300' : 'text-ink-400'
                        }`}
                      >
                        {correct && <Check className="h-3 w-3 shrink-0" />}
                        <span className="min-w-0 flex-1 break-anywhere">{option.label}</span>
                        <span className="shrink-0 tabular-nums">{option.count}</span>
                      </li>
                    );
                  })}
                </ul>

                {question.explanation && (
                  <p className="mt-2 rounded-lg bg-white/5 p-2 text-[11px] leading-relaxed text-ink-400">
                    {question.explanation}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {isHost && (
        <div className="flex gap-2 border-t border-white/10 p-4">
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => void exportCsv(false)}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => void exportCsv(true)}>
            <Download className="h-4 w-4" />
            Detailed
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 p-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-100">{value}</p>
    </div>
  );
}

// -------------------------------------------------------------- host home

function QuizHostHome() {
  const [composing, setComposing] = useState(false);
  if (composing) return <QuizComposer onDone={() => setComposing(false)} />;

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <GraduationCap className="h-8 w-8 text-ink-600" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-400">No quiz yet.</p>
      <p className="mt-1 text-xs text-ink-500">
        Questions are graded by the server, so scores and ranks are computed from real answers.
      </p>
      <Button size="sm" className="mt-5" onClick={() => setComposing(true)}>
        <Plus className="h-4 w-4" />
        Create a quiz
      </Button>
    </div>
  );
}

interface DraftQuestion {
  kind: 'SINGLE' | 'MULTI' | 'TRUE_FALSE';
  prompt: string;
  points: number;
  seconds: number;
  explanation: string;
  options: { label: string; isCorrect: boolean }[];
}

const blankQuestion = (): DraftQuestion => ({
  kind: 'SINGLE',
  prompt: '',
  points: 10,
  seconds: 30,
  explanation: '',
  options: [
    { label: '', isCorrect: true },
    { label: '', isCorrect: false },
  ],
});

function QuizComposer({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([blankQuestion()]);
  const [settings, setSettings] = useState<Partial<QuizSettings>>({
    timerMode: 'TOTAL',
    flow: 'ALL_AT_ONCE',
    totalSeconds: 300,
    shuffleQuestions: false,
    shuffleOptions: false,
    resultVisibility: 'LEADERBOARD_AND_ANSWERS',
    revealMode: 'AT_END',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const field =
    'w-full rounded-lg border border-white/15 bg-ink-850 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-2 focus:outline-brand-500';

  function patchQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) => current.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  async function create(startNow: boolean) {
    setError(null);

    if (!title.trim()) return setError('Give the quiz a name.');
    for (const [index, question] of questions.entries()) {
      if (!question.prompt.trim()) return setError(`Question ${index + 1} needs text.`);
      const filled = question.options.filter((o) => o.label.trim());
      if (filled.length < 2) return setError(`Question ${index + 1} needs two options.`);
      if (!filled.some((o) => o.isCorrect)) {
        return setError(`Question ${index + 1} needs a correct answer marked.`);
      }
    }

    setBusy(true);
    const result = await meetingClient.createQuiz({
      title: title.trim(),
      settings,
      questions: questions.map((question) => ({
        kind: question.kind,
        prompt: question.prompt.trim(),
        points: question.points,
        seconds: question.seconds,
        explanation: question.explanation.trim() || null,
        options: question.options
          .filter((o) => o.label.trim())
          .map((o) => ({ label: o.label.trim(), isCorrect: o.isCorrect })),
      })),
    });

    if (!result.ok || !result.data) {
      setBusy(false);
      return setError(result.message ?? 'The quiz could not be created.');
    }

    if (startNow) await meetingClient.startQuiz(result.data.quizId);
    setBusy(false);
    onDone();
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-slim p-4">
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-500/15 px-3 py-2 text-xs text-danger-300">
          {error}
        </p>
      )}

      <label htmlFor="quiz-title" className="text-xs font-medium text-ink-300">
        Quiz name
      </label>
      <input
        id="quiz-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={150}
        placeholder="Web Security Challenge"
        className={`mt-1 ${field}`}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="quiz-total" className="text-xs font-medium text-ink-300">
            Total time (seconds)
          </label>
          <input
            id="quiz-total"
            type="number"
            min={10}
            max={7200}
            value={settings.totalSeconds}
            onChange={(event) =>
              setSettings((s) => ({ ...s, totalSeconds: Number(event.target.value) || 60 }))
            }
            className={`mt-1 ${field}`}
          />
        </div>
        <div>
          <label htmlFor="quiz-reveal" className="text-xs font-medium text-ink-300">
            Results
          </label>
          <select
            id="quiz-reveal"
            value={settings.resultVisibility}
            onChange={(event) =>
              setSettings((s) => ({
                ...s,
                resultVisibility: event.target.value as QuizSettings['resultVisibility'],
              }))
            }
            className={`mt-1 ${field}`}
          >
            <option value="LEADERBOARD_AND_ANSWERS">Leaderboard and answers</option>
            <option value="LEADERBOARD_ONLY">Leaderboard only</option>
            <option value="OWN_ONLY">Own result only</option>
            <option value="HOST_ONLY">Host only</option>
          </select>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 rounded-lg bg-white/5 p-3">
        {(
          [
            ['shuffleQuestions', 'Shuffle question order'],
            ['shuffleOptions', 'Shuffle answer options'],
            ['negativeMarking', 'Negative marking for wrong answers'],
            ['allowAnswerChange', 'Allow changing an answer'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-xs text-ink-200">
            <input
              type="checkbox"
              checked={Boolean(settings[key])}
              onChange={(event) => setSettings((s) => ({ ...s, [key]: event.target.checked }))}
              className="h-4 w-4 rounded border-white/20 bg-ink-850"
            />
            {label}
          </label>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {questions.map((question, index) => (
          <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-300">Question {index + 1}</span>
              {questions.length > 1 && (
                <button
                  type="button"
                  onClick={() => setQuestions((c) => c.filter((_, i) => i !== index))}
                  aria-label={`Remove question ${index + 1}`}
                  className="rounded p-1 text-ink-400 hover:text-danger-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <input
              value={question.prompt}
              onChange={(event) => patchQuestion(index, { prompt: event.target.value })}
              placeholder="What does XSS stand for?"
              aria-label={`Question ${index + 1} text`}
              maxLength={500}
              className={`mt-2 ${field}`}
            />

            <div className="mt-2 grid grid-cols-3 gap-2">
              <select
                value={question.kind}
                aria-label={`Question ${index + 1} type`}
                onChange={(event) => {
                  const kind = event.target.value as DraftQuestion['kind'];
                  patchQuestion(index, {
                    kind,
                    options:
                      kind === 'TRUE_FALSE'
                        ? [
                            { label: 'True', isCorrect: true },
                            { label: 'False', isCorrect: false },
                          ]
                        : question.options,
                  });
                }}
                className={field}
              >
                <option value="SINGLE">Single</option>
                <option value="MULTI">Multiple</option>
                <option value="TRUE_FALSE">True / False</option>
              </select>
              <input
                type="number"
                min={1}
                max={100}
                value={question.points}
                aria-label={`Question ${index + 1} points`}
                onChange={(event) => patchQuestion(index, { points: Number(event.target.value) || 10 })}
                className={field}
              />
              <input
                type="number"
                min={5}
                max={600}
                value={question.seconds}
                aria-label={`Question ${index + 1} seconds`}
                onChange={(event) => patchQuestion(index, { seconds: Number(event.target.value) || 30 })}
                className={field}
              />
            </div>

            <ul className="mt-2 space-y-1.5">
              {question.options.map((option, optionIndex) => (
                <li key={optionIndex} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      patchQuestion(index, {
                        options: question.options.map((o, i) =>
                          question.kind === 'MULTI'
                            ? i === optionIndex
                              ? { ...o, isCorrect: !o.isCorrect }
                              : o
                            : { ...o, isCorrect: i === optionIndex },
                        ),
                      })
                    }
                    aria-label={`Mark option ${optionIndex + 1} correct`}
                    aria-pressed={option.isCorrect}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border ${
                      option.isCorrect
                        ? 'border-success-400 bg-success-500/30 text-success-300'
                        : 'border-white/20 text-transparent'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <input
                    value={option.label}
                    onChange={(event) =>
                      patchQuestion(index, {
                        options: question.options.map((o, i) =>
                          i === optionIndex ? { ...o, label: event.target.value } : o,
                        ),
                      })
                    }
                    placeholder={`Option ${optionIndex + 1}`}
                    aria-label={`Question ${index + 1} option ${optionIndex + 1}`}
                    maxLength={200}
                    className={field}
                  />
                </li>
              ))}
            </ul>

            {question.kind !== 'TRUE_FALSE' && question.options.length < 8 && (
              <button
                type="button"
                onClick={() =>
                  patchQuestion(index, {
                    options: [...question.options, { label: '', isCorrect: false }],
                  })
                }
                className="mt-1.5 text-[11px] font-medium text-brand-400 hover:underline"
              >
                Add option
              </button>
            )}

            <input
              value={question.explanation}
              onChange={(event) => patchQuestion(index, { explanation: event.target.value })}
              placeholder="Explanation (optional, shown after the reveal)"
              aria-label={`Question ${index + 1} explanation`}
              maxLength={500}
              className={`mt-2 ${field}`}
            />
          </div>
        ))}
      </div>

      {questions.length < 50 && (
        <button
          type="button"
          onClick={() => setQuestions((c) => [...c, blankQuestion()])}
          className="mt-3 text-xs font-medium text-brand-400 hover:underline"
        >
          Add question
        </button>
      )}

      <div className="mt-4 flex gap-2 pb-2">
        <Button size="sm" loading={busy} className="flex-1" onClick={() => void create(true)}>
          Start quiz
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void create(false)}>
          Save draft
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
