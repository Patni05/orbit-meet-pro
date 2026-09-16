#!/usr/bin/env node
/**
 * Integration test for the live quiz.
 *
 * Drives the realtime API exactly as a browser would, with several concurrent
 * participants. The cases that matter most are the ones a UI would never
 * send: answering after the deadline, submitting twice, asking for results
 * early, and creating a quiz as a plain participant.
 *
 * Usage:  node apps/api/scripts/test-quiz.mjs [apiUrl]
 */

import { io } from 'socket.io-client';

const API = process.argv[2] ?? process.env.API_URL ?? 'http://127.0.0.1:4000';
const RT_BASE = process.env.RT_URL ?? new URL(API).origin;
const RT_NAMESPACE = '/rt';

let passed = 0;
let failed = 0;
const c = { reset: '[0m', green: '[32m', red: '[31m', dim: '[2m' };

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ${c.green}PASS${c.reset}  ${name}`);
  } else {
    failed += 1;
    console.log(`  ${c.red}FAIL${c.reset}  ${name}${detail ? `\n        ${c.dim}${detail}${c.reset}` : ''}`);
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { raw: text } };
  }
}

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function register(name) {
  const { body } = await api('/auth/register', {
    method: 'POST',
    body: { name, email: `${name.toLowerCase()}${stamp()}@example.test`, password: 'Str0ngPassw0rd!' },
  });
  return body.accessToken;
}

function connect(sessionToken) {
  return new Promise((resolve, reject) => {
    const socket = io(`${RT_BASE}${RT_NAMESPACE}`, {
      path: '/realtime',
      transports: ['websocket'],
      auth: { sessionToken },
      reconnection: false,
      timeout: 10_000,
    });
    const timer = setTimeout(() => reject(new Error('socket timed out')), 12_000);
    socket.on('room:state', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emit(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response ?? { ok: false, code: 'NO_ACK' }));
  });
}

function waitFor(socket, event, ms = 12_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** A four-question quiz with a known key, used by most cases below. */
function sampleQuestions() {
  return [
    {
      kind: 'SINGLE',
      prompt: 'What does XSS stand for?',
      points: 10,
      seconds: 30,
      explanation: 'Cross-Site Scripting: injecting script into a page other people load.',
      options: [
        { label: 'Cross-Site Scripting', isCorrect: true },
        { label: 'Extra Secure Sockets', isCorrect: false },
        { label: 'XML Style Sheets', isCorrect: false },
      ],
    },
    {
      kind: 'SINGLE',
      prompt: 'Which port does HTTPS normally use?',
      points: 10,
      seconds: 30,
      options: [
        { label: '80', isCorrect: false },
        { label: '443', isCorrect: true },
        { label: '22', isCorrect: false },
      ],
    },
    {
      kind: 'MULTI',
      prompt: 'Which of these are HTTP methods?',
      points: 20,
      seconds: 45,
      options: [
        { label: 'GET', isCorrect: true },
        { label: 'POST', isCorrect: true },
        { label: 'FETCH', isCorrect: false },
      ],
    },
    {
      kind: 'TRUE_FALSE',
      prompt: 'DNS stands for Domain Name System.',
      points: 10,
      seconds: 20,
      options: [
        { label: 'True', isCorrect: true },
        { label: 'False', isCorrect: false },
      ],
    },
  ];
}

async function setupMeeting() {
  const hostToken = await register('Ada');
  const { body: created } = await api('/meetings', {
    method: 'POST',
    token: hostToken,
    body: { title: 'Quiz test' },
  });
  return { hostToken, code: created.meeting.code };
}

async function joinAs(code, name, token) {
  const { body } = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    token,
    body: { displayName: name, sessionId: `s_${name}_${stamp()}` },
  });
  return body;
}

/**
 * Waits until the API is genuinely serving.
 *
 * A freshly started server spends its first seconds opening database and Redis
 * connections, and this suite has real deadlines in it — a cold start would
 * show up as a timing failure that says nothing about the code.
 */
async function waitForApi(attempts = 20) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const body = await response.json();
        if (body?.checks?.database === 'ok' && body?.checks?.redis === 'ok') return;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`API at ${API} did not become healthy`);
}

async function main() {
  console.log(`\nLive quiz integration test against ${API}\n`);

  await waitForApi();

  const { hostToken, code } = await setupMeeting();
  const hostJoin = await joinAs(code, 'Ada Host', hostToken);
  const hostSocket = await connect(hostJoin.ticket.sessionToken);

  // Three concurrent participants, so ranking and tie-breaks are real.
  const names = ['Rahul', 'Vivek', 'Neha'];
  const guests = [];
  for (const name of names) {
    const join = await joinAs(code, name);
    guests.push({ name, join, socket: await connect(join.ticket.sessionToken) });
  }
  check('host and three participants joined', guests.length === 3);

  // ---- authorization ----
  console.log('\nAuthorization');

  const guestCreate = await emit(guests[0].socket, 'host:quiz-create', {
    title: 'Not allowed',
    questions: sampleQuestions(),
  });
  check(
    'participant cannot create a quiz',
    guestCreate.ok === false && guestCreate.code === 'FORBIDDEN',
    JSON.stringify(guestCreate),
  );

  // ---- creation validation ----
  console.log('\nCreation');

  const noKey = await emit(hostSocket, 'host:quiz-create', {
    title: 'Missing key',
    questions: [
      {
        kind: 'SINGLE',
        prompt: 'No correct answer marked',
        options: [
          { label: 'A', isCorrect: false },
          { label: 'B', isCorrect: false },
        ],
      },
    ],
  });
  check('quiz without a correct answer is refused', noKey.ok === false, JSON.stringify(noKey));

  const multiKeyOnSingle = await emit(hostSocket, 'host:quiz-create', {
    title: 'Bad single',
    questions: [
      {
        kind: 'SINGLE',
        prompt: 'Two correct on a single-choice question',
        options: [
          { label: 'A', isCorrect: true },
          { label: 'B', isCorrect: true },
        ],
      },
    ],
  });
  check('single-choice with two keys is refused', multiKeyOnSingle.ok === false);

  const created = await emit(hostSocket, 'host:quiz-create', {
    title: 'Web Security Challenge',
    settings: {
      timerMode: 'TOTAL',
      flow: 'ALL_AT_ONCE',
      totalSeconds: 25,
      shuffleQuestions: true,
      shuffleOptions: true,
      resultVisibility: 'LEADERBOARD_AND_ANSWERS',
      revealMode: 'AT_END',
    },
    questions: sampleQuestions(),
  });
  check('host can create a multi-question quiz', created.ok === true, JSON.stringify(created));
  const quizId = created.data.quizId;

  // ---- start and synchronisation ----
  console.log('\nStart and timer');

  const startedPromises = guests.map((g) => waitFor(g.socket, 'quiz:started'));
  const lobbyPromise = waitFor(guests[0].socket, 'quiz:starting');

  const start = await emit(hostSocket, 'host:quiz-start', { quizId });
  check('host can start the quiz', start.ok === true, JSON.stringify(start));

  const lobby = await lobbyPromise;
  check('participants get a lobby countdown', lobby?.quizId === quizId, JSON.stringify(lobby));

  const views = await Promise.all(startedPromises);
  check('every participant receives the quiz', views.every((v) => v?.id === quizId));

  check(
    'all participants share one deadline',
    new Set(views.map((v) => v.endsAt)).size === 1,
    JSON.stringify(views.map((v) => v?.endsAt)),
  );
  check('deadline is a server instant', typeof views[0]?.endsAt === 'string');
  check('server time is supplied for countdown', typeof views[0]?.serverTime === 'string');

  // ---- answer key must not leak ----
  console.log('\nAnswer key confidentiality');

  const participantView = views[0];
  const leaked = JSON.stringify(participantView).toLowerCase();
  check(
    'participant payload contains no correctness flags',
    leaked.includes('iscorrect') === false,
    'payload mentioned isCorrect',
  );
  check(
    'participant payload contains no answer key',
    participantView.questions.every((q) => q.correctOptionIds === undefined),
  );
  check(
    'explanations are withheld before reveal',
    participantView.questions.every((q) => q.explanation === undefined),
  );

  // ---- shuffling ----
  const orders = views.map((v) => v.questions.map((q) => q.id).join(','));
  check(
    'question order is shuffled per participant',
    new Set(orders).size > 1,
    'all three received identical order',
  );

  // ---- answering ----
  console.log('\nAnswering');

  /** Looks up a participant's own option id for a known label. */
  const optionFor = (view, promptStart, label) => {
    const question = view.questions.find((q) => q.prompt.startsWith(promptStart));
    return { questionId: question.id, optionId: question.options.find((o) => o.label === label)?.id };
  };

  // Rahul answers everything correctly.
  const rahul = views[0];
  for (const [promptStart, labels] of [
    ['What does XSS', ['Cross-Site Scripting']],
    ['Which port', ['443']],
    ['Which of these are HTTP', ['GET', 'POST']],
    ['DNS stands', ['True']],
  ]) {
    const question = rahul.questions.find((q) => q.prompt.startsWith(promptStart));
    const optionIds = labels.map((l) => question.options.find((o) => o.label === l).id);
    const result = await emit(guests[0].socket, 'quiz:answer', {
      quizId,
      questionId: question.id,
      optionIds,
    });
    if (!result.ok) check(`Rahul answers "${promptStart}"`, false, JSON.stringify(result));
  }
  check('all-correct participant answered every question', true);

  // Vivek gets two right, one wrong, one blank.
  const vivek = views[1];
  const vXss = optionFor(vivek, 'What does XSS', 'Cross-Site Scripting');
  await emit(guests[1].socket, 'quiz:answer', { quizId, questionId: vXss.questionId, optionIds: [vXss.optionId] });
  const vPort = optionFor(vivek, 'Which port', '80');
  await emit(guests[1].socket, 'quiz:answer', { quizId, questionId: vPort.questionId, optionIds: [vPort.optionId] });
  const vDns = optionFor(vivek, 'DNS stands', 'True');
  await emit(guests[1].socket, 'quiz:answer', { quizId, questionId: vDns.questionId, optionIds: [vDns.optionId] });

  // Neha answers a multi question partially, which must count as wrong.
  const neha = views[2];
  const nHttp = neha.questions.find((q) => q.prompt.startsWith('Which of these are HTTP'));
  await emit(guests[2].socket, 'quiz:answer', {
    quizId,
    questionId: nHttp.id,
    optionIds: [nHttp.options.find((o) => o.label === 'GET').id],
  });

  // ---- tampering ----
  console.log('\nTampering');

  // Aimed at a question this participant has not answered, so the refusal (if
  // any) is about the option id rather than the no-answer-changes rule.
  const nehaUnanswered = neha.questions.find((q) => q.prompt.startsWith('Which port'));
  const foreign = await emit(guests[2].socket, 'quiz:answer', {
    quizId,
    questionId: nehaUnanswered.id,
    optionIds: ['00000000-0000-0000-0000-000000000000'],
  });
  // Unknown ids are filtered out, leaving an empty selection — a valid "no
  // answer". What matters is that a foreign id can never score.
  check('an option id from outside the question cannot score', foreign.ok === true, JSON.stringify(foreign));

  const earlyResults = await emit(guests[0].socket, 'quiz:results', { quizId });
  check(
    'participants cannot read results while the quiz runs',
    earlyResults.ok === false && earlyResults.code === 'FORBIDDEN',
    JSON.stringify(earlyResults),
  );

  const guestEnd = await emit(guests[0].socket, 'host:quiz-end', { quizId });
  check('participant cannot end the quiz', guestEnd.ok === false && guestEnd.code === 'FORBIDDEN');

  const guestExtend = await emit(guests[0].socket, 'host:quiz-extend', { quizId, seconds: 600 });
  check('participant cannot extend the timer', guestExtend.ok === false && guestExtend.code === 'FORBIDDEN');

  // ---- rejoin must not reset anything ----
  console.log('\nReconnect');

  const rejoin = await emit(guests[0].socket, 'quiz:join', { quizId });
  check('rejoining returns the same attempt', rejoin.ok === true);
  check(
    'saved answers survive a rejoin',
    Object.keys(rejoin.data?.myAnswers ?? {}).length >= 3,
    JSON.stringify(Object.keys(rejoin.data?.myAnswers ?? {}).length),
  );
  check(
    'rejoining does not extend the deadline',
    rejoin.data?.endsAt === views[0].endsAt,
    `${rejoin.data?.endsAt} vs ${views[0].endsAt}`,
  );

  // ---- early submission ----
  console.log('\nSubmission');

  const submit = await emit(guests[0].socket, 'quiz:submit', { quizId });
  check('participant can submit early', submit.ok === true, JSON.stringify(submit));

  const doubleSubmit = await emit(guests[0].socket, 'quiz:submit', { quizId });
  check('a second submission is refused', doubleSubmit.ok === false, JSON.stringify(doubleSubmit));

  const afterSubmit = await emit(guests[0].socket, 'quiz:answer', {
    quizId,
    questionId: rahul.questions[1].id,
    optionIds: [rahul.questions[1].options[0].id],
  });
  check('answers after submitting are refused', afterSubmit.ok === false, JSON.stringify(afterSubmit));

  // ---- deadline expiry ----
  console.log('\nExpiry (waiting for the server clock)');

  const endedEvent = waitFor(guests[1].socket, 'quiz:ended', 40_000);
  const resultsEvent = waitFor(guests[1].socket, 'quiz:results', 40_000);

  const ended = await endedEvent;
  check('quiz ends on the server deadline without any client asking', ended?.quizId === quizId);

  const results = await resultsEvent;
  check('results are pushed when the quiz ends', results?.quizId === quizId, JSON.stringify(results)?.slice(0, 200));

  // ---- grading ----
  console.log('\nGrading');

  const board = results?.leaderboard ?? [];
  const byName = (name) => board.find((row) => row.displayName === name);

  check('every participant is graded', board.length === 3, JSON.stringify(board.map((r) => r.displayName)));

  const r = byName('Rahul');
  check('all-correct participant scores full marks', r?.score === 50, JSON.stringify(r));
  check('correct count is right', r?.correctCount === 4, JSON.stringify(r?.correctCount));
  check('accuracy is right', r?.accuracy === 100, JSON.stringify(r?.accuracy));
  check('all-correct participant ranks first', r?.rank === 1);

  const v = byName('Vivek');
  check('partly-correct participant scores correctly', v?.score === 20, JSON.stringify(v));
  check('wrong answers are counted', v?.wrongCount === 1, JSON.stringify(v?.wrongCount));
  check('unanswered questions are counted', v?.unansweredCount === 1, JSON.stringify(v?.unansweredCount));

  const n = byName('Neha');
  check(
    'a partial multi-select answer counts as wrong',
    n?.wrongCount === 1 && n?.score === 0,
    JSON.stringify(n),
  );

  check('ranks are ordered by score', board[0].score >= board[1].score && board[1].score >= board[2].score);

  // ---- analytics ----
  console.log('\nAnalytics');

  check('per-question analytics are present', Array.isArray(results?.questions) && results.questions.length === 4);
  check('average score is computed', typeof results?.averageScore === 'number');
  check('hardest question is identified', results?.hardest != null, JSON.stringify(results?.hardest));
  check('easiest question is identified', results?.easiest != null);
  check(
    'the answer key is revealed once the quiz has ended',
    results?.questions?.every((q) => Array.isArray(q.correctOptionIds) && q.correctOptionIds.length > 0) === true,
  );
  check('explanations appear after the quiz', results?.questions?.some((q) => q.explanation));

  // ---- CSV ----
  console.log('\nExport');

  const csv = await emit(hostSocket, 'host:quiz-export', { quizId });
  check('host can export results as CSV', csv.ok === true && typeof csv.data?.csv === 'string');
  check('CSV has a header row', csv.data?.csv?.startsWith('Rank,Participant'), csv.data?.csv?.slice(0, 60));
  check('CSV contains every participant', ['Rahul', 'Vivek', 'Neha'].every((name) => csv.data.csv.includes(name)));

  const detailed = await emit(hostSocket, 'host:quiz-export', { quizId, detailed: true });
  check('host can export a per-question CSV', detailed.ok === true && detailed.data.csv.includes('Q1 Answer'));

  const guestExport = await emit(guests[1].socket, 'host:quiz-export', { quizId });
  check('participant cannot export results', guestExport.ok === false && guestExport.code === 'FORBIDDEN');

  // ---- history ----
  const history = await emit(hostSocket, 'host:quiz-list', {});
  check('quiz appears in history', Array.isArray(history.data) && history.data.length >= 1);
  check(
    'history carries the headline numbers',
    history.data?.[0]?.participantCount === 3 && history.data?.[0]?.questionCount === 4,
    JSON.stringify(history.data?.[0]),
  );

  for (const socket of [hostSocket, ...guests.map((g) => g.socket)]) socket.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nTest run failed:', error.message);
  process.exit(1);
});
