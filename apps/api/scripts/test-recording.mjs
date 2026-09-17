#!/usr/bin/env node
/**
 * Recording control and messaging.
 *
 * Deliberately narrow. Whether a recording produces a real audio file cannot
 * be proved from a socket script — the SFU only creates a room once a client
 * connects with media, so there is nothing here to record. That question is
 * answered by `apps/web/e2e/recording.spec.ts`, which drives a real browser
 * and checks the downloaded bytes are an OGG container.
 *
 * What is checked here is everything around it: who may start and stop a
 * recording, and whether a host who presses Record in an empty meeting is told
 * something true.
 *
 * Usage:  node apps/api/scripts/test-recording.mjs [apiUrl]
 */

import { io } from 'socket.io-client';
import { clearRateLimits, requireToken, waitForApi } from './_harness.mjs';

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

async function register(name) {
  const { body } = await api('/auth/register', {
    method: 'POST',
    body: { name, email: `${name.toLowerCase()}${stamp()}@example.test`, password: 'Str0ngPassw0rd!' },
  });
  return requireToken(body, name);
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
    socket.on('room:state', (state) => {
      clearTimeout(timer);
      socket.roomState = state;
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const emit = (socket, event, payload) =>
  new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response ?? { ok: false, code: 'NO_ACK' }));
  });

async function main() {
  console.log(`\nRecording control test against ${API}\n`);

  await waitForApi(API);
  await clearRateLimits();

  const hostToken = await register('Rita');
  const { body: created } = await api('/meetings', {
    method: 'POST',
    token: hostToken,
    body: { title: 'Recording control test', settings: { recordingEnabled: true } },
  });
  const { code } = created.meeting;

  const hostJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    token: hostToken,
    body: { displayName: 'Rita Host', sessionId: `h${stamp()}` },
  });
  const guestJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    body: { displayName: 'Gil Guest', sessionId: `g${stamp()}` },
  });

  const hostSocket = await connect(hostJoin.body.ticket.sessionToken);
  const guestSocket = await connect(guestJoin.body.ticket.sessionToken);

  console.log('Authorisation');

  const guestStart = await emit(guestSocket, 'host:recording', { action: 'start' });
  check(
    'a participant cannot start a recording',
    guestStart.ok === false && guestStart.code === 'FORBIDDEN',
    JSON.stringify(guestStart),
  );

  const guestStop = await emit(guestSocket, 'host:recording', { action: 'stop' });
  check(
    'a participant cannot stop a recording',
    guestStop.ok === false && guestStop.code === 'FORBIDDEN',
    JSON.stringify(guestStop),
  );

  const guestList = await emit(guestSocket, 'host:recordings', {});
  check(
    'a participant cannot list recordings',
    guestList.ok === false && guestList.code === 'FORBIDDEN',
    JSON.stringify(guestList),
  );

  check(
    'a participant is given no recordings in their room state',
    guestSocket.roomState?.recordings?.length === 0,
  );

  console.log('\nEmpty meeting');

  /*
   * Neither of these sockets has connected media, so the SFU has no room for
   * this meeting — exactly the state a host is in when they press Record
   * before anybody has actually joined.
   *
   * The SFU answers "requested room does not exist". Passing that through as
   * "the recording service is unavailable" sends a host looking for a broken
   * server when all they need to do is wait, so it is translated.
   */
  const early = await emit(hostSocket, 'host:recording', { action: 'start' });
  check('recording an empty meeting is refused', early.ok === false, JSON.stringify(early));
  check(
    'the host is told the meeting has not started, not that the service is broken',
    /nobody has joined/i.test(early.message ?? ''),
    early.message,
  );
  check(
    'it does not claim the recording service is unavailable',
    !/service is unavailable/i.test(early.message ?? ''),
    early.message,
  );

  for (const socket of [hostSocket, guestSocket]) socket.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(
    `${c.dim}The recorded file itself is verified by apps/web/e2e/recording.spec.ts${c.reset}\n`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nTest run failed:', error.message);
  process.exit(1);
});
