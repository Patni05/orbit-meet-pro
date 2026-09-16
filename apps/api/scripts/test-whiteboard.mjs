#!/usr/bin/env node
/**
 * Integration test for the collaborative whiteboard.
 *
 * Two participants draw at the same time and each must see the other's work.
 * The cases that matter most are the ones a UI would never send: drawing after
 * being revoked, oversized payloads, and clearing the board as a participant.
 *
 * Usage:  node apps/api/scripts/test-whiteboard.mjs [apiUrl]
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

function waitFor(socket, event, ms = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

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

const pen = (points) => ({ tool: 'pen', color: '#ef4444', width: 4, points });

async function main() {
  console.log(`\nWhiteboard integration test against ${API}\n`);

  await waitForApi();

  const hostToken = await register('Ada');
  const { body: created } = await api('/meetings', {
    method: 'POST',
    token: hostToken,
    body: { title: 'Whiteboard test' },
  });
  const code = created.meeting.code;

  const hostJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    token: hostToken,
    body: { displayName: 'Ada Host', sessionId: `s_h_${stamp()}` },
  });
  const guestJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    body: { displayName: 'Grace Guest', sessionId: `s_g_${stamp()}` },
  });

  const hostSocket = await connect(hostJoin.ticket?.sessionToken ?? hostJoin.body?.ticket?.sessionToken);
  const guestSocket = await connect(guestJoin.body.ticket.sessionToken);
  const guestIdentity = guestJoin.body.ticket.identity;

  check('host and guest joined', Boolean(hostSocket && guestSocket));

  // ---- default permissions ----
  console.log('\nPermissions');

  const board = await emit(guestSocket, 'whiteboard:load', {});
  check('participant can load the board', board.ok === true, JSON.stringify(board));
  check('board starts empty', board.data?.strokes?.length === 0);
  check('everyone may draw by default', board.data?.canDraw === true);
  check('default mode is EVERYONE', board.data?.mode === 'EVERYONE');

  // ---- realtime sync ----
  console.log('\nSynchronisation');

  const seenByHost = waitFor(hostSocket, 'whiteboard:stroke');
  const drawn = await emit(guestSocket, 'whiteboard:draw', pen([0.1, 0.1, 0.5, 0.5]));
  check('participant can draw', drawn.ok === true, JSON.stringify(drawn));

  const received = await seenByHost;
  check('the stroke reaches the other participant', received?.id === drawn.data?.id, JSON.stringify(received));
  check('the author is recorded', received?.authorName === 'Grace Guest');
  check('points survive the round trip', JSON.stringify(received?.points) === JSON.stringify([0.1, 0.1, 0.5, 0.5]));

  // Simultaneous drawing from both sides.
  const hostSeen = waitFor(hostSocket, 'whiteboard:stroke');
  const guestSeen = waitFor(guestSocket, 'whiteboard:stroke');
  const [a, b] = await Promise.all([
    emit(guestSocket, 'whiteboard:draw', pen([0.2, 0.2, 0.6, 0.6])),
    emit(hostSocket, 'whiteboard:draw', pen([0.3, 0.3, 0.7, 0.7])),
  ]);
  check('both simultaneous strokes are accepted', a.ok === true && b.ok === true);
  check('each side sees the other', Boolean(await hostSeen) && Boolean(await guestSeen));
  check('sequence numbers are distinct', a.data?.seq !== b.data?.seq, `${a.data?.seq} vs ${b.data?.seq}`);

  // ---- late joiner ----
  const reloaded = await emit(hostSocket, 'whiteboard:load', {});
  check('a late joiner receives the whole board', reloaded.data?.strokes?.length === 3, JSON.stringify(reloaded.data?.strokes?.length));
  check(
    'strokes come back in order',
    reloaded.data.strokes.every((s, i, all) => i === 0 || all[i - 1].seq < s.seq),
  );

  // ---- undo ----
  console.log('\nUndo');

  const undoSeen = waitFor(guestSocket, 'whiteboard:undo');
  const undone = await emit(guestSocket, 'whiteboard:undo', {});
  check('participant can undo their own stroke', undone.ok === true, JSON.stringify(undone));
  const undoPayload = await undoSeen;
  check('the undo reaches everyone', Boolean(undoPayload?.strokeId));

  const afterUndo = await emit(hostSocket, 'whiteboard:load', {});
  check('the undone stroke is gone', afterUndo.data?.strokes?.length === 2);
  check(
    'undo removed the undoer\'s stroke, not the host\'s',
    afterUndo.data.strokes.some((s) => s.authorName === 'Ada Host'),
  );

  // ---- validation ----
  console.log('\nValidation');

  const huge = await emit(guestSocket, 'whiteboard:draw', {
    ...pen(Array.from({ length: 5000 }, (_, i) => (i % 100) / 100)),
  });
  check('an oversized stroke is refused', huge.ok === false, JSON.stringify(huge)?.slice(0, 120));

  const badColor = await emit(guestSocket, 'whiteboard:draw', {
    tool: 'pen',
    color: 'javascript:alert(1)',
    width: 4,
    points: [0.1, 0.1, 0.2, 0.2],
  });
  check('a non-hex colour is refused', badColor.ok === false, JSON.stringify(badColor));

  const badTool = await emit(guestSocket, 'whiteboard:draw', {
    tool: 'script',
    color: '#ffffff',
    width: 4,
    points: [0.1, 0.1, 0.2, 0.2],
  });
  check('an unknown tool is refused', badTool.ok === false);

  const badWidth = await emit(guestSocket, 'whiteboard:draw', {
    ...pen([0.1, 0.1, 0.2, 0.2]),
    width: 9999,
  });
  check('an absurd line width is refused', badWidth.ok === false);

  // ---- authorization ----
  console.log('\nAuthorization');

  const guestClear = await emit(guestSocket, 'host:whiteboard-clear', {});
  check('participant cannot clear the board', guestClear.ok === false && guestClear.code === 'FORBIDDEN');

  const guestMode = await emit(guestSocket, 'host:whiteboard-mode', { mode: 'HOSTS_ONLY' });
  check('participant cannot change the mode', guestMode.ok === false && guestMode.code === 'FORBIDDEN');

  const guestGrant = await emit(guestSocket, 'host:whiteboard-permission', {
    identity: guestIdentity,
    canDraw: true,
  });
  check('participant cannot grant themselves access', guestGrant.ok === false && guestGrant.code === 'FORBIDDEN');

  // ---- host revokes drawing ----
  console.log('\nRevocation');

  const revokedNotice = waitFor(guestSocket, 'whiteboard:permissions');
  const revoke = await emit(hostSocket, 'host:whiteboard-permission', {
    identity: guestIdentity,
    canDraw: false,
  });
  check('host can revoke one person', revoke.ok === true, JSON.stringify(revoke));

  const notice = await revokedNotice;
  check('the revoked participant is told', notice?.canDraw === false, JSON.stringify(notice));

  const afterRevoke = await emit(guestSocket, 'whiteboard:draw', pen([0.4, 0.4, 0.8, 0.8]));
  check(
    'a revoked participant cannot draw',
    afterRevoke.ok === false && afterRevoke.code === 'FORBIDDEN',
    JSON.stringify(afterRevoke),
  );

  const restore = await emit(hostSocket, 'host:whiteboard-permission', {
    identity: guestIdentity,
    canDraw: true,
  });
  check('host can restore access', restore.ok === true);

  const afterRestore = await emit(guestSocket, 'whiteboard:draw', pen([0.45, 0.45, 0.85, 0.85]));
  check('access is genuinely restored', afterRestore.ok === true, JSON.stringify(afterRestore));

  // ---- hosts-only mode ----
  const modeNotice = waitFor(guestSocket, 'whiteboard:permissions');
  await emit(hostSocket, 'host:whiteboard-mode', { mode: 'HOSTS_ONLY' });
  const modePayload = await modeNotice;
  check('hosts-only mode reaches participants', modePayload?.mode === 'HOSTS_ONLY', JSON.stringify(modePayload));

  // An explicit grant outranks the mode, which is what makes "selected people"
  // usable without flipping the whole policy.
  check('an explicit grant still applies', modePayload?.canDraw === true);

  const hostDraw = await emit(hostSocket, 'whiteboard:draw', pen([0.5, 0.5, 0.9, 0.9]));
  check('hosts can still draw in hosts-only mode', hostDraw.ok === true);

  // ---- clear ----
  console.log('\nClear');

  const clearedSeen = waitFor(guestSocket, 'whiteboard:cleared');
  const cleared = await emit(hostSocket, 'host:whiteboard-clear', {});
  check('host can clear the board', cleared.ok === true);
  const clearedPayload = await clearedSeen;
  check('the clear reaches everyone', clearedPayload?.by === 'Ada Host', JSON.stringify(clearedPayload));

  const empty = await emit(hostSocket, 'whiteboard:load', {});
  check('the board is empty afterwards', empty.data?.strokes?.length === 0);

  for (const socket of [hostSocket, guestSocket]) socket.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nTest run failed:', error.message);
  process.exit(1);
});
