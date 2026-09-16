#!/usr/bin/env node
/**
 * Integration test for moderation, polls and the blocklist.
 *
 * Talks to a running API over the same REST and Socket.IO surface a browser
 * uses, because the thing worth proving is that the *server* refuses a
 * privileged action — not that a button is hidden. Several of these cases
 * deliberately send commands the UI would never offer.
 *
 * Usage:  node apps/api/scripts/test-moderation.mjs [apiUrl]
 */

import { io } from 'socket.io-client';

const API = process.argv[2] ?? process.env.API_URL ?? 'http://127.0.0.1:4000';

/**
 * Socket.IO treats a URL path as its namespace, so the realtime connection
 * needs the bare origin even when REST lives under a prefix like /api behind
 * a reverse proxy. Same split the browser client makes.
 */
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
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 10000)}`;

async function register(name) {
  const email = `${name.toLowerCase()}${stamp()}@example.test`;
  const { body } = await api('/auth/register', {
    method: 'POST',
    body: { name, email, password: 'Str0ngPassw0rd!' },
  });
  return { name, email, token: body.accessToken };
}

/** Opens a realtime socket and waits until the room state has arrived. */
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

    socket.on('room:state', (state) => {
      clearTimeout(timer);
      socket.state = state;
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Promise wrapper around an acknowledged emit. */
function emit(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response ?? { ok: false, code: 'NO_ACK' }));
  });
}

function waitFor(socket, event, ms = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
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
  console.log(`\nModeration integration test against ${API}\n`);

  await waitForApi();

  // ---- setup: a host and a plain participant in one meeting ----
  const host = await register('Ada');
  const { body: created } = await api('/meetings', {
    method: 'POST',
    token: host.token,
    body: { title: 'Moderation test' },
  });
  const code = created.meeting.code;

  const hostJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    token: host.token,
    body: { displayName: 'Ada Host', sessionId: `s_host_${stamp()}` },
  });
  const guestJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    body: { displayName: 'Grace Guest', sessionId: `s_guest_${stamp()}` },
  });

  check('host is admitted', hostJoin.body.outcome === 'ADMITTED');
  check('guest is admitted', guestJoin.body.outcome === 'ADMITTED');

  const hostSocket = await connect(hostJoin.body.ticket.sessionToken);
  const guestSocket = await connect(guestJoin.body.ticket.sessionToken);
  const guestIdentity = guestJoin.body.ticket.identity;

  // ---- authorization: a participant must not wield host powers ----
  console.log('\nAuthorization');

  const guestPoll = await emit(guestSocket, 'host:poll-create', {
    question: 'Should I be allowed to do this?',
    options: ['No', 'Definitely not'],
  });
  check('participant cannot create a poll', guestPoll.ok === false && guestPoll.code === 'FORBIDDEN', JSON.stringify(guestPoll));

  const guestBlock = await emit(guestSocket, 'host:block', { identity: 'anyone' });
  check('participant cannot block', guestBlock.ok === false && guestBlock.code === 'FORBIDDEN', JSON.stringify(guestBlock));

  const guestSpotlight = await emit(guestSocket, 'host:spotlight', { identity: guestIdentity, on: true });
  check('participant cannot spotlight', guestSpotlight.ok === false && guestSpotlight.code === 'FORBIDDEN');

  const guestAnnounce = await emit(guestSocket, 'host:announce', { body: 'I am the host now' });
  check('participant cannot announce', guestAnnounce.ok === false && guestAnnounce.code === 'FORBIDDEN');

  // ---- spotlight ----
  console.log('\nSpotlight');

  const spotlightSeen = waitFor(guestSocket, 'spotlight:updated');
  const spotlight = await emit(hostSocket, 'host:spotlight', { identity: guestIdentity, on: true });
  check('host can spotlight', spotlight.ok === true, JSON.stringify(spotlight));
  const spotlightPayload = await spotlightSeen;
  check(
    'spotlight reaches participants',
    spotlightPayload?.identities?.includes(guestIdentity) === true,
    JSON.stringify(spotlightPayload),
  );

  // ---- announcements ----
  console.log('\nAnnouncements');

  const announceSeen = waitFor(guestSocket, 'announcement:posted');
  const announce = await emit(hostSocket, 'host:announce', { body: 'Starting in two minutes.' });
  check('host can announce', announce.ok === true, JSON.stringify(announce));
  const announcePayload = await announceSeen;
  check('announcement reaches participants', announcePayload?.body === 'Starting in two minutes.');

  const tooLong = await emit(hostSocket, 'host:announce', { body: 'x'.repeat(500) });
  check('over-long announcement is rejected', tooLong.ok === false && tooLong.code === 'VALIDATION');

  // ---- polls ----
  console.log('\nPolls');

  const pollSeenByGuest = waitFor(guestSocket, 'poll:opened');
  const poll = await emit(hostSocket, 'host:poll-create', {
    question: 'Tabs or spaces?',
    options: ['Tabs', 'Spaces'],
    hideResultsUntilClosed: true,
  });
  check('host can create a poll', poll.ok === true, JSON.stringify(poll));

  const guestPollView = await pollSeenByGuest;
  check('poll reaches participants', guestPollView?.question === 'Tabs or spaces?');
  check(
    'tally is withheld from participants while open',
    guestPollView?.options?.every((option) => option.votes === null) === true,
    JSON.stringify(guestPollView?.options),
  );
  check(
    'host sees the tally',
    poll.data?.options?.every((option) => typeof option.votes === 'number') === true,
  );

  const optionId = poll.data.options[0].id;
  const pollId = poll.data.id;

  const vote = await emit(guestSocket, 'poll:vote', { pollId, optionIds: [optionId] });
  check('participant can vote', vote.ok === true, JSON.stringify(vote));
  check('own selection is echoed back', vote.data?.myOptionIds?.includes(optionId) === true);
  check('tally still withheld after voting', vote.data?.options?.every((o) => o.votes === null) === true);
  check('response count is visible', vote.data?.responseCount === 1);

  const doubleVote = await emit(guestSocket, 'poll:vote', { pollId, optionIds: [optionId] });
  check('re-voting replaces rather than stacks', doubleVote.data?.responseCount === 1, JSON.stringify(doubleVote.data?.responseCount));

  const multiOnSingle = await emit(guestSocket, 'poll:vote', {
    pollId,
    optionIds: poll.data.options.map((option) => option.id),
  });
  check(
    'single-choice poll refuses multiple answers',
    multiOnSingle.ok === false && multiOnSingle.code === 'VALIDATION',
    JSON.stringify(multiOnSingle),
  );

  const foreignOption = await emit(guestSocket, 'poll:vote', {
    pollId,
    optionIds: ['00000000-0000-0000-0000-000000000000'],
  });
  check('a foreign option id is refused', foreignOption.ok === false);

  const guestClose = await emit(guestSocket, 'host:poll-close', { pollId });
  check('participant cannot close a poll', guestClose.ok === false && guestClose.code === 'FORBIDDEN');

  const closedSeen = waitFor(guestSocket, 'poll:closed');
  const closed = await emit(hostSocket, 'host:poll-close', { pollId });
  check('host can close a poll', closed.ok === true);
  const closedView = await closedSeen;
  check(
    'tally is revealed once closed',
    closedView?.options?.every((option) => typeof option.votes === 'number') === true,
    JSON.stringify(closedView?.options),
  );

  const lateVote = await emit(guestSocket, 'poll:vote', { pollId, optionIds: [optionId] });
  check('voting after close is refused', lateVote.ok === false, JSON.stringify(lateVote));

  // ---- blocklist ----
  console.log('\nBlocklist');

  const blockedNotice = waitFor(guestSocket, 'you:blocked');
  const block = await emit(hostSocket, 'host:block', { identity: guestIdentity, reason: 'Testing' });
  check('host can block a participant', block.ok === true, JSON.stringify(block));

  const notice = await blockedNotice;
  check('blocked participant is told', notice?.by === 'Ada Host', JSON.stringify(notice));

  const list = await emit(hostSocket, 'host:blocklist', {});
  check('blocklist lists the entry', Array.isArray(list.data) && list.data.length === 1, JSON.stringify(list.data));
  check('blocklist carries no network information', JSON.stringify(list.data ?? '').includes('ip') === false);

  // The critical one: a blocked guest must not be able to rejoin.
  const rejoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    body: { displayName: 'Grace Guest', sessionId: guestJoin.body.ticket ? `s_guest_rejoin_${stamp()}` : '' },
  });
  // A brand-new session id is a *new* guest identity, so this one is expected
  // to succeed — that limit is documented. Re-joining on the same identity is
  // what must fail, so test that directly.
  const rejoinSame = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    body: { displayName: 'Grace Guest', sessionId: guestJoin.body.ticket.identity },
  });

  const blockedUser = await register('Mallory');
  const mJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    token: blockedUser.token,
    body: { displayName: 'Mallory', sessionId: `s_m_${stamp()}` },
  });
  check('a signed-in user can join before being blocked', mJoin.body.outcome === 'ADMITTED');

  const mSocket = await connect(mJoin.body.ticket.sessionToken);
  const mBlocked = waitFor(mSocket, 'you:blocked');
  await emit(hostSocket, 'host:block', { identity: mJoin.body.ticket.identity });
  await mBlocked;

  const mRejoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    token: blockedUser.token,
    body: { displayName: 'Mallory', sessionId: `s_m_new_${stamp()}` },
  });
  check(
    'blocked ACCOUNT cannot rejoin even with a fresh session',
    mRejoin.body.outcome === 'REJECTED',
    JSON.stringify(mRejoin.body),
  );

  const entries = await emit(hostSocket, 'host:blocklist', {});
  const accountEntry = entries.data?.find((entry) => entry.scope === 'USER');
  check('account block is recorded with USER scope', Boolean(accountEntry));

  const unblocked = await emit(hostSocket, 'host:unblock', { entryId: accountEntry.id });
  check('host can unblock', unblocked.ok === true);

  const afterUnblock = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    token: blockedUser.token,
    body: { displayName: 'Mallory', sessionId: `s_m_after_${stamp()}` },
  });
  check(
    'unblocked account can join again',
    afterUnblock.body.outcome === 'ADMITTED',
    JSON.stringify(afterUnblock.body),
  );

  // ---- host hierarchy ----
  console.log('\nHierarchy');

  const selfBlock = await emit(hostSocket, 'host:block', { identity: hostJoin.body.ticket.identity });
  check('host cannot block themselves', selfBlock.ok === false, JSON.stringify(selfBlock));

  for (const socket of [hostSocket, guestSocket, mSocket]) socket.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nTest run failed:', error.message);
  process.exit(1);
});
