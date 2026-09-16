import type {
  QuizLiveView,
  QuizProgress,
  QuizQuestionView,
  QuizResults,
  QuizScoreRow,
  QuizSettings,
  QuizSummary,
} from '@orbit/shared';
import { prisma } from '../../lib/prisma';

/**
 * Live quiz.
 *
 * Three rules shape every function here.
 *
 * **The clock belongs to the server.** `startedAt` and `endsAt` are stored
 * instants; clients render a countdown from them. Nothing a browser reports
 * about elapsed time is believed, so refreshing, sleeping the laptop or
 * editing a local timer buys nobody a second.
 *
 * **The answer key never leaves early.** A participant's payload simply has no
 * `isCorrect` field on options and no `correctOptionIds` on questions until
 * the configured reveal point. Filtering in the UI would leave the key sitting
 * in the frame for anyone who opens devtools.
 *
 * **Scores are computed here.** A client submits selections; it never submits
 * a score, and a submitted score would be ignored if it did.
 */

type QuizWithQuestions = NonNullable<Awaited<ReturnType<typeof loadQuiz>>>;

export async function loadQuiz(quizId: string) {
  return prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      questions: {
        orderBy: { position: 'asc' },
        include: { options: { orderBy: { position: 'asc' } } },
      },
    },
  });
}

export function settingsOfQuiz(quiz: {
  timerMode: string;
  flow: string;
  totalSeconds: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  negativeMarking: boolean;
  negativePoints: number;
  allowLateJoin: boolean;
  allowAnswerChange: boolean;
  resultVisibility: string;
  revealMode: string;
}): QuizSettings {
  return {
    timerMode: quiz.timerMode as QuizSettings['timerMode'],
    flow: quiz.flow as QuizSettings['flow'],
    totalSeconds: quiz.totalSeconds,
    shuffleQuestions: quiz.shuffleQuestions,
    shuffleOptions: quiz.shuffleOptions,
    negativeMarking: quiz.negativeMarking,
    negativePoints: quiz.negativePoints,
    allowLateJoin: quiz.allowLateJoin,
    allowAnswerChange: quiz.allowAnswerChange,
    resultVisibility: quiz.resultVisibility as QuizSettings['resultVisibility'],
    revealMode: quiz.revealMode as QuizSettings['revealMode'],
  };
}

/**
 * Deterministic shuffle seeded by participant and quiz.
 *
 * Every participant gets a stable order: the same on a refresh, different from
 * their neighbour's. A random shuffle per request would reorder the paper
 * under someone mid-answer, and storing a per-participant permutation would be
 * a table for something a hash already gives us.
 */
function seededOrder<T>(items: T[], seed: string): T[] {
  const scored = items.map((item, index) => {
    let hash = 2166136261;
    const key = `${seed}:${index}`;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return { item, rank: hash >>> 0 };
  });
  scored.sort((a, b) => a.rank - b.rank);
  return scored.map((entry) => entry.item);
}

/** Whether the answer key may be included for this viewer right now. */
function mayRevealKey(quiz: { status: string; revealMode: string }, isHost: boolean): boolean {
  if (isHost) return true;
  if (quiz.revealMode === 'NEVER') return false;
  if (quiz.status === 'ENDED') return quiz.revealMode !== 'NEVER';
  // AFTER_EACH_QUESTION is handled per question by the caller; while the quiz
  // is still running the key stays out of the payload.
  return false;
}

export interface QuizViewer {
  participantId: string;
  isHost: boolean;
}

/** Builds the quiz as one participant should currently see it. */
export async function buildLiveView(
  quiz: QuizWithQuestions,
  viewer: QuizViewer,
): Promise<QuizLiveView> {
  const attempt = await prisma.quizParticipant.findUnique({
    where: { quizId_participantId: { quizId: quiz.id, participantId: viewer.participantId } },
    include: { answers: true },
  });

  const revealKey = mayRevealKey(quiz, viewer.isHost);

  let questions = quiz.questions;
  if (quiz.shuffleQuestions && !viewer.isHost) {
    questions = seededOrder(questions, `${quiz.id}:${viewer.participantId}:q`);
  }

  // In one-at-a-time flow a participant only ever holds the open question, so
  // the rest cannot be read ahead from the payload.
  if (quiz.flow === 'ONE_AT_A_TIME' && !viewer.isHost) {
    questions = questions.slice(quiz.currentQuestionIndex, quiz.currentQuestionIndex + 1);
  }

  const views: QuizQuestionView[] = questions.map((question) => {
    let options = question.options;
    if (quiz.shuffleOptions && !viewer.isHost) {
      options = seededOrder(options, `${quiz.id}:${viewer.participantId}:${question.id}`);
    }

    return {
      id: question.id,
      position: question.position,
      kind: question.kind as QuizQuestionView['kind'],
      prompt: question.prompt,
      points: question.points,
      seconds: question.seconds,
      options: options.map((option) => ({ id: option.id, label: option.label })),
      ...(revealKey
        ? {
            correctOptionIds: question.options.filter((o) => o.isCorrect).map((o) => o.id),
            explanation: question.explanation,
          }
        : {}),
    };
  });

  const myAnswers: Record<string, string[]> = {};
  for (const answer of attempt?.answers ?? []) {
    myAnswers[answer.questionId] = answer.optionIds;
  }

  return {
    id: quiz.id,
    title: quiz.title,
    status: quiz.status as QuizLiveView['status'],
    settings: settingsOfQuiz(quiz),
    questionCount: quiz.questions.length,
    totalPoints: quiz.questions.reduce((sum, q) => sum + q.points, 0),
    startedAt: quiz.startedAt?.toISOString() ?? null,
    endsAt: quiz.endsAt?.toISOString() ?? null,
    serverTime: new Date().toISOString(),
    currentQuestionIndex: quiz.currentQuestionIndex,
    currentQuestionEndsAt: quiz.currentQuestionEndsAt?.toISOString() ?? null,
    questions: views,
    myAnswers,
    mySubmittedAt: attempt?.submittedAt?.toISOString() ?? null,
  };
}

// ----------------------------------------------------------------- lifecycle

export interface QuizDraftInput {
  meetingId: string;
  createdById: string;
  title: string;
  settings: Partial<QuizSettings>;
  questions: {
    kind: 'SINGLE' | 'MULTI' | 'TRUE_FALSE';
    prompt: string;
    points?: number;
    seconds?: number;
    explanation?: string | null;
    options: { label: string; isCorrect: boolean }[];
  }[];
}

export async function createQuiz(input: QuizDraftInput) {
  const quiz = await prisma.quiz.create({
    data: {
      meetingId: input.meetingId,
      createdById: input.createdById,
      title: input.title,
      status: 'DRAFT',
      timerMode: input.settings.timerMode ?? 'TOTAL',
      flow: input.settings.flow ?? 'ALL_AT_ONCE',
      totalSeconds: input.settings.totalSeconds ?? 300,
      shuffleQuestions: input.settings.shuffleQuestions ?? false,
      shuffleOptions: input.settings.shuffleOptions ?? false,
      negativeMarking: input.settings.negativeMarking ?? false,
      negativePoints: input.settings.negativePoints ?? 1,
      allowLateJoin: input.settings.allowLateJoin ?? true,
      allowAnswerChange: input.settings.allowAnswerChange ?? false,
      resultVisibility: input.settings.resultVisibility ?? 'LEADERBOARD_AND_ANSWERS',
      revealMode: input.settings.revealMode ?? 'AT_END',
      questions: {
        create: input.questions.map((question, position) => ({
          position,
          kind: question.kind,
          prompt: question.prompt,
          points: question.points ?? 10,
          seconds: question.seconds ?? 30,
          explanation: question.explanation ?? null,
          options: {
            create: question.options.map((option, optionPosition) => ({
              position: optionPosition,
              label: option.label,
              isCorrect: option.isCorrect,
            })),
          },
        })),
      },
    },
  });

  return loadQuiz(quiz.id);
}

/**
 * Starts the quiz and fixes its deadline.
 *
 * The deadline is computed once, here, from the server clock. Everything
 * afterwards — countdowns, late joins, auto-submission — derives from it, so
 * every participant is working against the same instant.
 */
export async function startQuiz(quizId: string) {
  const quiz = await loadQuiz(quizId);
  if (!quiz) return null;

  const now = new Date();
  const totalMs =
    quiz.timerMode === 'TOTAL'
      ? quiz.totalSeconds * 1000
      : quiz.questions.reduce((sum, q) => sum + q.seconds, 0) * 1000;

  const firstQuestion = quiz.questions[0];

  /**
   * Enrol everyone who is already in the meeting.
   *
   * A synchronised quiz starts for the room at one instant, so attempts are
   * created here rather than when each client happens to ask. That also makes
   * `timeTakenMs` mean the same thing for everyone: time from the shared
   * start, not from whenever a browser got round to registering.
   *
   * Hosts and co-hosts are left out — they are running the quiz, and a host
   * sitting at the bottom of their own leaderboard with four blanks is noise.
   * A host who wants to take part can still join explicitly.
   */
  const attendees = await prisma.meetingParticipant.findMany({
    where: { meetingId: quiz.meetingId, status: 'ADMITTED', role: 'PARTICIPANT' },
    select: { id: true, displayName: true, avatarUrl: true },
  });

  if (attendees.length > 0) {
    await prisma.quizParticipant.createMany({
      data: attendees.map((person) => ({
        quizId,
        participantId: person.id,
        displayName: person.displayName,
        avatarUrl: person.avatarUrl,
        startedAt: now,
      })),
      // A rerun or a race must not duplicate an attempt; the unique constraint
      // on (quiz, participant) is the guarantee and this just avoids throwing.
      skipDuplicates: true,
    });
  }

  await prisma.quiz.update({
    where: { id: quizId },
    data: {
      status: 'RUNNING',
      startedAt: now,
      endsAt: new Date(now.getTime() + totalMs),
      currentQuestionIndex: 0,
      currentQuestionEndsAt:
        quiz.timerMode === 'PER_QUESTION' && firstQuestion
          ? new Date(now.getTime() + firstQuestion.seconds * 1000)
          : null,
    },
  });

  return loadQuiz(quizId);
}

/** Moves a one-at-a-time quiz to the next question, or ends it. */
export async function advanceQuestion(quizId: string) {
  const quiz = await loadQuiz(quizId);
  if (!quiz || quiz.status !== 'RUNNING') return null;

  const nextIndex = quiz.currentQuestionIndex + 1;
  if (nextIndex >= quiz.questions.length) return { finished: true as const, quiz };

  const next = quiz.questions[nextIndex]!;
  await prisma.quiz.update({
    where: { id: quizId },
    data: {
      currentQuestionIndex: nextIndex,
      currentQuestionEndsAt:
        quiz.timerMode === 'PER_QUESTION' ? new Date(Date.now() + next.seconds * 1000) : null,
    },
  });

  return { finished: false as const, quiz: await loadQuiz(quizId) };
}

/** Extends the deadline for everyone at once. */
export async function extendQuiz(quizId: string, seconds: number) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz?.endsAt) return null;

  await prisma.quiz.update({
    where: { id: quizId },
    data: {
      endsAt: new Date(quiz.endsAt.getTime() + seconds * 1000),
      ...(quiz.currentQuestionEndsAt
        ? { currentQuestionEndsAt: new Date(quiz.currentQuestionEndsAt.getTime() + seconds * 1000) }
        : {}),
    },
  });

  return loadQuiz(quizId);
}

// ---------------------------------------------------------------- attempts

export type JoinQuizResult =
  | { ok: true; attemptId: string }
  | { ok: false; code: 'NOT_RUNNING' | 'LATE_JOIN_CLOSED' };

/**
 * Registers a participant's attempt, or returns the existing one.
 *
 * Idempotent by construction: the unique constraint on (quiz, participant)
 * means a second tab or a reconnect lands on the same attempt rather than
 * starting a fresh one with a fresh clock.
 */
export async function joinQuiz(input: {
  quizId: string;
  participantId: string;
  displayName: string;
  avatarUrl: string | null;
}): Promise<JoinQuizResult> {
  const quiz = await prisma.quiz.findUnique({ where: { id: input.quizId } });
  if (!quiz || quiz.status !== 'RUNNING') return { ok: false, code: 'NOT_RUNNING' };

  const existing = await prisma.quizParticipant.findUnique({
    where: { quizId_participantId: { quizId: input.quizId, participantId: input.participantId } },
  });
  if (existing) return { ok: true, attemptId: existing.id };

  if (!quiz.allowLateJoin && quiz.startedAt && Date.now() - quiz.startedAt.getTime() > 5000) {
    return { ok: false, code: 'LATE_JOIN_CLOSED' };
  }

  const created = await prisma.quizParticipant.create({
    data: {
      quizId: input.quizId,
      participantId: input.participantId,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
    },
  });

  return { ok: true, attemptId: created.id };
}

export type AnswerResult =
  | { ok: true }
  | { ok: false; code: 'NOT_RUNNING' | 'EXPIRED' | 'ALREADY_SUBMITTED' | 'UNKNOWN_QUESTION' | 'LOCKED' | 'NOT_OPEN' };

/**
 * Records an answer.
 *
 * Every gate is checked against server state: the quiz must be running, the
 * deadline must not have passed, the attempt must not already be submitted,
 * and the options must belong to the question being answered. A client that
 * lies about any of these is simply refused.
 */
export async function submitAnswer(input: {
  quizId: string;
  participantId: string;
  questionId: string;
  optionIds: string[];
}): Promise<AnswerResult> {
  const quiz = await loadQuiz(input.quizId);
  if (!quiz || quiz.status !== 'RUNNING') return { ok: false, code: 'NOT_RUNNING' };

  const now = Date.now();
  if (quiz.endsAt && now > quiz.endsAt.getTime()) return { ok: false, code: 'EXPIRED' };

  const question = quiz.questions.find((q) => q.id === input.questionId);
  if (!question) return { ok: false, code: 'UNKNOWN_QUESTION' };

  // In one-at-a-time flow, only the open question accepts answers.
  if (quiz.flow === 'ONE_AT_A_TIME') {
    const open = quiz.questions[quiz.currentQuestionIndex];
    if (!open || open.id !== question.id) return { ok: false, code: 'NOT_OPEN' };
    if (quiz.currentQuestionEndsAt && now > quiz.currentQuestionEndsAt.getTime()) {
      return { ok: false, code: 'EXPIRED' };
    }
  }

  const attempt = await prisma.quizParticipant.findUnique({
    where: { quizId_participantId: { quizId: input.quizId, participantId: input.participantId } },
    include: { answers: { where: { questionId: input.questionId } } },
  });
  if (!attempt) return { ok: false, code: 'NOT_RUNNING' };
  if (attempt.submittedAt) return { ok: false, code: 'ALREADY_SUBMITTED' };

  // Changing an answer is a host setting, not a client choice.
  if (attempt.answers.length > 0 && !quiz.allowAnswerChange) return { ok: false, code: 'LOCKED' };

  const valid = new Set(question.options.map((option) => option.id));
  const chosen = [...new Set(input.optionIds)].filter((id) => valid.has(id));
  const normalised = question.kind === 'MULTI' ? chosen : chosen.slice(0, 1);

  await prisma.quizAnswer.upsert({
    where: {
      quizParticipantId_questionId: {
        quizParticipantId: attempt.id,
        questionId: input.questionId,
      },
    },
    create: {
      quizParticipantId: attempt.id,
      questionId: input.questionId,
      optionIds: normalised,
    },
    update: { optionIds: normalised, answeredAt: new Date() },
  });

  return { ok: true };
}

/**
 * Finalises one attempt and grades it.
 *
 * Grading happens here rather than at quiz end so a participant who submits
 * early gets an honest completion time. Marking the attempt submitted is what
 * makes a second submission impossible.
 */
export async function finishAttempt(quizId: string, participantId: string): Promise<boolean> {
  const quiz = await loadQuiz(quizId);
  if (!quiz) return false;

  const attempt = await prisma.quizParticipant.findUnique({
    where: { quizId_participantId: { quizId, participantId } },
    include: { answers: true },
  });
  if (!attempt || attempt.submittedAt) return false;

  await gradeAttempt(quiz, attempt.id);
  return true;
}

async function gradeAttempt(quiz: QuizWithQuestions, attemptId: string): Promise<void> {
  const attempt = await prisma.quizParticipant.findUnique({
    where: { id: attemptId },
    include: { answers: true },
  });
  if (!attempt) return;

  const answersByQuestion = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));

  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  const updates: { id: string; isCorrect: boolean; awarded: number }[] = [];

  for (const question of quiz.questions) {
    const answer = answersByQuestion.get(question.id);
    const chosen = new Set(answer?.optionIds ?? []);
    const correct = new Set(question.options.filter((o) => o.isCorrect).map((o) => o.id));

    if (chosen.size === 0) {
      unansweredCount += 1;
      // Unanswered never costs points, even with negative marking on.
      if (answer) updates.push({ id: answer.id, isCorrect: false, awarded: 0 });
      continue;
    }

    // A multi-answer question is right only when the selection matches the key
    // exactly — partial credit would need a scheme the host never chose.
    const exact =
      chosen.size === correct.size && [...chosen].every((id) => correct.has(id));

    if (exact) {
      correctCount += 1;
      score += question.points;
      if (answer) updates.push({ id: answer.id, isCorrect: true, awarded: question.points });
    } else {
      wrongCount += 1;
      const penalty = quiz.negativeMarking ? quiz.negativePoints : 0;
      score -= penalty;
      if (answer) updates.push({ id: answer.id, isCorrect: false, awarded: -penalty });
    }
  }

  const now = new Date();
  const timeTakenMs = Math.max(0, now.getTime() - attempt.startedAt.getTime());

  await prisma.$transaction([
    ...updates.map((update) =>
      prisma.quizAnswer.update({
        where: { id: update.id },
        data: { isCorrect: update.isCorrect, awarded: update.awarded },
      }),
    ),
    prisma.quizParticipant.update({
      where: { id: attempt.id },
      data: {
        submittedAt: now,
        // Negative marking can drive a total below zero; a negative score on a
        // leaderboard is confusing, so it floors at zero.
        score: Math.max(0, score),
        correctCount,
        wrongCount,
        unansweredCount,
        timeTakenMs,
      },
    }),
  ]);
}

/**
 * Ends the quiz and grades everyone who had not submitted.
 *
 * Called when the deadline passes or the host ends it early. Unsubmitted
 * attempts are graded exactly as they stand, with blanks counted as
 * unanswered rather than wrong.
 */
export async function endQuiz(quizId: string) {
  const quiz = await loadQuiz(quizId);
  if (!quiz) return null;

  const pending = await prisma.quizParticipant.findMany({
    where: { quizId, submittedAt: null },
    select: { id: true },
  });

  for (const attempt of pending) {
    await gradeAttempt(quiz, attempt.id);
  }

  await prisma.quiz.update({
    where: { id: quizId },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  return loadQuiz(quizId);
}

// ----------------------------------------------------------------- results

export async function buildResults(quizId: string, viewer: QuizViewer): Promise<QuizResults | null> {
  const quiz = await loadQuiz(quizId);
  if (!quiz) return null;

  const attempts = await prisma.quizParticipant.findMany({
    where: { quizId },
    include: { answers: true },
  });

  /**
   * Ranking: score first, then the faster completion. Two people on the same
   * score are separated by who got there sooner, which is the tie-break the
   * spec asks for and the one people expect from a quiz.
   */
  const ordered = [...attempts].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.timeTakenMs - b.timeTakenMs;
  });

  const totalQuestions = quiz.questions.length;

  const rows: QuizScoreRow[] = ordered.map((attempt, index) => ({
    rank: index + 1,
    participantId: attempt.participantId,
    displayName: attempt.displayName,
    avatarUrl: attempt.avatarUrl,
    score: attempt.score,
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount,
    unansweredCount: attempt.unansweredCount,
    accuracy: totalQuestions > 0 ? Math.round((attempt.correctCount / totalQuestions) * 1000) / 10 : 0,
    timeTakenMs: attempt.timeTakenMs,
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
  }));

  const me = rows.find((row) => row.participantId === viewer.participantId) ?? null;

  const correctResponses = attempts.reduce((sum, a) => sum + a.correctCount, 0);
  const wrongResponses = attempts.reduce((sum, a) => sum + a.wrongCount, 0);
  const unansweredResponses = attempts.reduce((sum, a) => sum + a.unansweredCount, 0);
  const scores = attempts.map((a) => a.score);

  // ---- per-question analytics ----
  const analytics = quiz.questions.map((question) => {
    const answers = attempts.flatMap((attempt) =>
      attempt.answers.filter((answer) => answer.questionId === question.id),
    );
    const counts = question.options.map((option) => ({
      optionId: option.id,
      label: option.label,
      count: answers.filter((answer) => answer.optionIds.includes(option.id)).length,
    }));
    const answered = answers.filter((answer) => answer.optionIds.length > 0);
    const correct = answers.filter((answer) => answer.isCorrect).length;

    const responseTimes = attempts.flatMap((attempt) =>
      attempt.answers
        .filter((answer) => answer.questionId === question.id)
        .map((answer) => Math.max(0, answer.answeredAt.getTime() - attempt.startedAt.getTime())),
    );

    return {
      questionId: question.id,
      position: question.position,
      prompt: question.prompt,
      correctOptionIds: question.options.filter((o) => o.isCorrect).map((o) => o.id),
      explanation: question.explanation,
      optionCounts: counts,
      correctCount: correct,
      totalAnswered: answered.length,
      accuracy: attempts.length > 0 ? Math.round((correct / attempts.length) * 1000) / 10 : 0,
      averageResponseMs:
        responseTimes.length > 0
          ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
          : 0,
    };
  });

  const byAccuracy = [...analytics].sort((a, b) => b.accuracy - a.accuracy);

  /**
   * Result visibility is applied by *omitting* data, not by hiding it. A
   * participant under LEADERBOARD_ONLY never receives the answer key, so there
   * is nothing in their payload to uncover.
   */
  const visibility = quiz.resultVisibility;
  const showLeaderboard =
    viewer.isHost || visibility === 'LEADERBOARD_AND_ANSWERS' || visibility === 'LEADERBOARD_ONLY';
  const showAnswers = viewer.isHost || visibility === 'LEADERBOARD_AND_ANSWERS';

  return {
    quizId: quiz.id,
    title: quiz.title,
    status: quiz.status as QuizResults['status'],
    endedAt: quiz.endedAt?.toISOString() ?? null,
    participantCount: attempts.length,
    questionCount: totalQuestions,
    totalResponses: correctResponses + wrongResponses,
    correctResponses,
    wrongResponses,
    unansweredResponses,
    averageScore:
      attempts.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / attempts.length) * 10) / 10 : 0,
    averageAccuracy:
      rows.length > 0 ? Math.round((rows.reduce((s, r) => s + r.accuracy, 0) / rows.length) * 10) / 10 : 0,
    highestScore: scores.length > 0 ? Math.max(...scores) : 0,
    lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
    averageCompletionMs:
      attempts.length > 0
        ? Math.round(attempts.reduce((s, a) => s + a.timeTakenMs, 0) / attempts.length)
        : 0,
    easiest: byAccuracy[0]
      ? { position: byAccuracy[0].position, prompt: byAccuracy[0].prompt, accuracy: byAccuracy[0].accuracy }
      : null,
    hardest: byAccuracy.at(-1)
      ? {
          position: byAccuracy.at(-1)!.position,
          prompt: byAccuracy.at(-1)!.prompt,
          accuracy: byAccuracy.at(-1)!.accuracy,
        }
      : null,
    leaderboard: showLeaderboard ? rows : me ? [me] : [],
    ...(showAnswers ? { questions: analytics } : {}),
    me,
  };
}

export async function quizProgress(quizId: string): Promise<QuizProgress> {
  const [joined, submitted] = await Promise.all([
    prisma.quizParticipant.count({ where: { quizId } }),
    prisma.quizParticipant.count({ where: { quizId, submittedAt: { not: null } } }),
  ]);
  return { quizId, joined, submitted };
}

export async function listQuizzes(meetingId: string): Promise<QuizSummary[]> {
  const quizzes = await prisma.quiz.findMany({
    where: { meetingId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      questions: { select: { id: true } },
      participants: {
        select: { score: true, displayName: true },
        orderBy: { score: 'desc' },
      },
    },
  });

  return quizzes.map((quiz) => ({
    id: quiz.id,
    title: quiz.title,
    status: quiz.status as QuizSummary['status'],
    questionCount: quiz.questions.length,
    participantCount: quiz.participants.length,
    averageScore:
      quiz.participants.length > 0
        ? Math.round(
            (quiz.participants.reduce((sum, p) => sum + p.score, 0) / quiz.participants.length) * 10,
          ) / 10
        : 0,
    topName: quiz.participants[0]?.displayName ?? null,
    createdAt: quiz.createdAt.toISOString(),
    endedAt: quiz.endedAt?.toISOString() ?? null,
  }));
}

/**
 * Quizzes whose deadline has passed but which are still marked running.
 *
 * The sweep exists because a quiz must end on time even if every client has
 * closed their laptop — the deadline is a server fact, not a browser timer.
 */
export async function findExpiredQuizzes(): Promise<{ id: string; meetingId: string }[]> {
  return prisma.quiz.findMany({
    where: { status: 'RUNNING', endsAt: { lte: new Date() } },
    select: { id: true, meetingId: true },
  });
}

// --------------------------------------------------------------------- CSV

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // Escape the separator, quotes and newlines; also neutralise a leading
  // formula character so a result file cannot execute on open in a spreadsheet.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Summary export: one row per participant. */
export async function resultsCsv(quizId: string): Promise<string> {
  const results = await buildResults(quizId, { participantId: '', isHost: true });
  if (!results) return '';

  const header = [
    'Rank',
    'Participant',
    'Participant ID',
    'Score',
    'Correct',
    'Wrong',
    'Unanswered',
    'Accuracy %',
    'Time Taken',
    'Submitted At',
  ];

  const lines = [header.map(csvCell).join(',')];
  for (const row of results.leaderboard) {
    lines.push(
      [
        row.rank,
        row.displayName,
        row.participantId,
        row.score,
        row.correctCount,
        row.wrongCount,
        row.unansweredCount,
        row.accuracy,
        formatDurationMs(row.timeTakenMs),
        row.submittedAt ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return lines.join('\r\n');
}

/** Detailed export: a column pair per question. */
export async function detailedCsv(quizId: string): Promise<string> {
  const quiz = await loadQuiz(quizId);
  if (!quiz) return '';

  const attempts = await prisma.quizParticipant.findMany({
    where: { quizId },
    include: { answers: true },
    orderBy: [{ score: 'desc' }, { timeTakenMs: 'asc' }],
  });

  const header = ['Rank', 'Participant', 'Score', 'Accuracy %'];
  for (const question of quiz.questions) {
    header.push(`Q${question.position + 1} Answer`, `Q${question.position + 1} Correct`);
  }

  const labelOf = new Map<string, string>();
  for (const question of quiz.questions) {
    for (const option of question.options) labelOf.set(option.id, option.label);
  }

  const lines = [header.map(csvCell).join(',')];

  attempts.forEach((attempt, index) => {
    const row: unknown[] = [
      index + 1,
      attempt.displayName,
      attempt.score,
      quiz.questions.length > 0
        ? Math.round((attempt.correctCount / quiz.questions.length) * 1000) / 10
        : 0,
    ];

    for (const question of quiz.questions) {
      const answer = attempt.answers.find((a) => a.questionId === question.id);
      row.push(
        (answer?.optionIds ?? []).map((id) => labelOf.get(id) ?? id).join(' | '),
        answer ? (answer.isCorrect ? 'Correct' : 'Wrong') : 'Unanswered',
      );
    }

    lines.push(row.map(csvCell).join(','));
  });

  return lines.join('\r\n');
}

function formatDurationMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
