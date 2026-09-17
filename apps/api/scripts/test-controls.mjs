#!/usr/bin/env node
/**
 * Integration test for global media locks, the task list, presence checks and
 * recording authorisation.
 *
 * The cases that matter are the ones no UI would send: a participant
 * unmuting while the room is locked, editing the host's task list, or
 * downloading a recording that is not theirs. What is proved here is that the
 * *server* refuses them.
 *
 * Usage:  node apps/api/scripts/test-controls.mjs [apiUrl]
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

async function api(path, { method = 'GET', token, body, raw = false } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return { status: response.status, body: null };
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

const waitFor = (socket, event, ms = 8000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

async function main() {
  console.log(`\nControls integration test against ${API}\n`);

  await waitForApi(API);
  await clearRateLimits();

  const hostToken = await register('Ada');
  const outsiderToken = await register('Mallory');

  const { body: created } = await api('/meetings', {
    method: 'POST',
    token: hostToken,
    body: { title: 'Controls test' },
  });
  const { code, id: meetingId } = created.meeting;

  const hostJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    token: hostToken,
    body: { displayName: 'Ada Host', sessionId: `h${stamp()}` },
  });
  const guestJoin = await api(`/meetings/code/${code}/join`, {
    method: 'POST',
    body: { displayName: 'Grace Guest', sessionId: `g${stamp()}` },
  });

  let hostSocket = await connect(hostJoin.body.ticket.sessionToken);
  const guestSocket = await connect(guestJoin.body.ticket.sessionToken);
  const guestIdentity = guestJoin.body.ticket.identity;

  check('host and guest joined', Boolean(hostSocket && guestSocket));
  check('room state carries locks', guestSocket.roomState?.locks !== undefined);
  check('locks start off', guestSocket.roomState?.locks?.micLocked === false);
  check('participants get no recordings list', guestSocket.roomState?.recordings?.length === 0);

  // ---- microphone lock ----
  console.log('\nMicrophone lock');

  const beforeLock = await emit(guestSocket, 'media:update', { micEnabled: true });
  check('participant can unmute before the lock', beforeLock.ok === true, JSON.stringify(beforeLock));

  const guestLock = await emit(guestSocket, 'host:media-lock', { kind: 'mic', locked: true });
  check('participant cannot lock microphones', guestLock.ok === false && guestLock.code === 'FORBIDDEN');

  const lockSeen = waitFor(guestSocket, 'locks:updated');
  const lock = await emit(hostSocket, 'host:media-lock', { kind: 'mic', locked: true });
  check('host can lock microphones', lock.ok === true, JSON.stringify(lock));

  const lockPayload = await lockSeen;
  check('the lock reaches participants', lockPayload?.locks?.micLocked === true, JSON.stringify(lockPayload));

  const whileLocked = await emit(guestSocket, 'media:update', { micEnabled: true });
  check(
    'participant CANNOT unmute while locked',
    whileLocked.ok === false && whileLocked.code === 'FORBIDDEN',
    JSON.stringify(whileLocked),
  );

  const hostWhileLocked = await emit(hostSocket, 'media:update', { micEnabled: true });
  check('host is exempt from the lock', hostWhileLocked.ok === true, JSON.stringify(hostWhileLocked));

  const unlock = await emit(hostSocket, 'host:media-lock', { kind: 'mic', locked: false });
  check('host can unlock microphones', unlock.ok === true);

  const afterUnlock = await emit(guestSocket, 'media:update', { micEnabled: true });
  check('participant can unmute again after unlock', afterUnlock.ok === true, JSON.stringify(afterUnlock));

  // ---- camera lock ----
  console.log('\nCamera lock');

  const camLockSeen = waitFor(guestSocket, 'locks:updated');
  const camLock = await emit(hostSocket, 'host:media-lock', { kind: 'camera', locked: true });
  check('host can lock cameras', camLock.ok === true);
  const camPayload = await camLockSeen;
  check('the camera lock reaches participants', camPayload?.locks?.cameraLocked === true);

  const camWhileLocked = await emit(guestSocket, 'media:update', { cameraEnabled: true });
  check(
    'participant CANNOT enable camera while locked',
    camWhileLocked.ok === false && camWhileLocked.code === 'FORBIDDEN',
    JSON.stringify(camWhileLocked),
  );

  // The microphone must be unaffected by a camera lock.
  const micDuringCamLock = await emit(guestSocket, 'media:update', { micEnabled: true });
  check('a camera lock does not block the microphone', micDuringCamLock.ok === true);

  await emit(hostSocket, 'host:media-lock', { kind: 'camera', locked: false });
  const camAfter = await emit(guestSocket, 'media:update', { cameraEnabled: true });
  check('participant can enable camera after unlock', camAfter.ok === true, JSON.stringify(camAfter));

  // ---- todos ----
  console.log('\nTask list');

  const guestTodo = await emit(guestSocket, 'host:todo-create', { text: 'Not allowed' });
  check('participant cannot create a task', guestTodo.ok === false && guestTodo.code === 'FORBIDDEN');

  const todosSeen = waitFor(guestSocket, 'todos:updated');
  const todo = await emit(hostSocket, 'host:todo-create', { text: 'Send project file' });
  check('host can create a task', todo.ok === true, JSON.stringify(todo));
  check('the task starts pending', todo.data?.completed === false);

  const todosPayload = await todosSeen;
  check('the task list reaches everyone', todosPayload?.todos?.length === 1, JSON.stringify(todosPayload));

  const guestEdit = await emit(guestSocket, 'host:todo-update', { id: todo.data.id, completed: true });
  check('participant cannot complete a task', guestEdit.ok === false && guestEdit.code === 'FORBIDDEN');

  const completed = await emit(hostSocket, 'host:todo-update', { id: todo.data.id, completed: true });
  check('host can mark a task complete', completed.ok === true && completed.data?.completed === true);
  check('completion is timestamped', Boolean(completed.data?.completedAt));

  const reopened = await emit(hostSocket, 'host:todo-update', { id: todo.data.id, completed: false });
  check('host can reopen a task', reopened.data?.completed === false && reopened.data?.completedAt === null);

  const renamed = await emit(hostSocket, 'host:todo-update', { id: todo.data.id, text: 'Send final file' });
  check('host can edit a task', renamed.data?.text === 'Send final file');

  const empty = await emit(hostSocket, 'host:todo-create', { text: '   ' });
  check('a blank task is refused', empty.ok === false);

  // Persistence: a fresh connection must see the list.
  //
  // Reconnecting with the same session deliberately evicts the previous
  // socket — one participant, one connection — so the new socket replaces the
  // old one for the rest of this run rather than being closed.
  hostSocket.close();
  hostSocket = await connect(hostJoin.body.ticket.sessionToken);
  check(
    'tasks survive a reconnect',
    hostSocket.roomState?.todos?.length === 1,
    JSON.stringify(hostSocket.roomState?.todos?.length),
  );
  check(
    'the edited text persisted',
    hostSocket.roomState?.todos?.[0]?.text === 'Send final file',
  );

  const guestDelete = await emit(guestSocket, 'host:todo-delete', { id: todo.data.id });
  check('participant cannot delete a task', guestDelete.ok === false && guestDelete.code === 'FORBIDDEN');

  const deleted = await emit(hostSocket, 'host:todo-delete', { id: todo.data.id });
  check('host can delete a task', deleted.ok === true);

  // ---- presence check ----
  console.log('\nPresence check');

  const noConsent = await emit(hostSocket, 'host:presence-request', { identity: guestIdentity });
  check(
    'a presence check is refused without consent',
    noConsent.ok === false && noConsent.code === 'FORBIDDEN',
    JSON.stringify(noConsent),
  );

  const denied = await emit(guestSocket, 'presence:consent', { allow: false });
  check('a participant can decline consent', denied.ok === true);

  const afterDecline = await emit(hostSocket, 'host:presence-request', { identity: guestIdentity });
  check('a declined participant is still protected', afterDecline.ok === false);

  const allowed = await emit(guestSocket, 'presence:consent', { allow: true });
  check('a participant can give consent', allowed.ok === true);

  const requestSeen = waitFor(guestSocket, 'presence:requested');
  const requested = await emit(hostSocket, 'host:presence-request', { identity: guestIdentity });
  check('host can request a check once consent is given', requested.ok === true, JSON.stringify(requested));

  const requestPayload = await requestSeen;
  check('the participant is prompted, not overridden', requestPayload?.by === 'Ada Host', JSON.stringify(requestPayload));
  check('the request carries an expiry', Boolean(requestPayload?.expiresAt));

  const guestRequest = await emit(guestSocket, 'host:presence-request', { identity: guestIdentity });
  check('participants cannot request presence checks', guestRequest.ok === false && guestRequest.code === 'FORBIDDEN');

  const confirmed = await emit(guestSocket, 'presence:confirm', {});
  check('the participant can confirm presence themselves', confirmed.ok === true);

  // ---- recordings ----
  console.log('\nRecording authorisation');

  const guestRecordings = await emit(guestSocket, 'host:recordings', {});
  check('participant cannot list recordings', guestRecordings.ok === false && guestRecordings.code === 'FORBIDDEN');

  const hostRecordings = await emit(hostSocket, 'host:recordings', {});
  check('host can list recordings', hostRecordings.ok === true, JSON.stringify(hostRecordings));

  // A download for an id that does not exist must look identical to one that
  // exists but is not yours, so the endpoint cannot be used to probe.
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const outsiderDownload = await api(`/meetings/${meetingId}/recordings/${fakeId}/download`, {
    token: outsiderToken,
  });
  check(
    'a non-host is refused a recording download',
    outsiderDownload.status === 403,
    `status ${outsiderDownload.status}`,
  );

  const anonymousDownload = await api(`/meetings/${meetingId}/recordings/${fakeId}/download`);
  check(
    'an anonymous download is refused',
    anonymousDownload.status === 401 || anonymousDownload.status === 403,
    `status ${anonymousDownload.status}`,
  );

  const hostMissing = await api(`/meetings/${meetingId}/recordings/${fakeId}/download`, {
    token: hostToken,
  });
  check(
    'even the host gets no file for an unknown id',
    hostMissing.status === 403 || hostMissing.status === 404,
    `status ${hostMissing.status}`,
  );

  // ---- co-host delegation and the exit restriction ----
  //
  // A co-host moderates but does not own the room. These two cases are where
  // that distinction actually bites, and both are decided on the server: the
  // client only ever reflects them.
  console.log('\nCo-host limits');

  check(
    'room state says only the host may end the meeting',
    guestSocket.roomState?.hostOnlyExit === true,
    JSON.stringify(guestSocket.roomState?.hostOnlyExit),
  );
  check(
    'co-hosts cannot manage tasks by default',
    guestSocket.roomState?.cohostsManageTodos === false,
  );

  const promoted = await emit(hostSocket, 'host:set-role', {
    identity: guestIdentity,
    role: 'COHOST',
  });
  check('host can promote a co-host', promoted.ok === true, JSON.stringify(promoted));

  // The guest socket is now a co-host; its role is re-read from the database
  // on every privileged call, so no reconnect is needed.
  const cohostEnd = await emit(guestSocket, 'host:end-meeting', {});
  check(
    'a co-host cannot end the meeting for everyone',
    cohostEnd.ok === false && cohostEnd.code === 'FORBIDDEN',
    JSON.stringify(cohostEnd),
  );

  const cohostTodo = await emit(guestSocket, 'host:todo-create', { text: 'Co-host task' });
  check(
    'a co-host cannot manage tasks until allowed',
    cohostTodo.ok === false && cohostTodo.code === 'FORBIDDEN',
    JSON.stringify(cohostTodo),
  );

  const cohostPermission = await emit(guestSocket, 'host:todo-permission', { allow: true });
  check(
    'a co-host cannot grant themselves task access',
    cohostPermission.ok === false && cohostPermission.code === 'FORBIDDEN',
  );

  const permissionSeen = waitFor(guestSocket, 'todos:permission');
  const todoPermissionOn = await emit(hostSocket, 'host:todo-permission', { allow: true });
  check('host can let co-hosts manage tasks', todoPermissionOn.ok === true, JSON.stringify(todoPermissionOn));

  const permissionPayload = await permissionSeen;
  check(
    'the permission change reaches the room',
    permissionPayload?.cohostsManageTodos === true,
    JSON.stringify(permissionPayload),
  );

  const cohostTodoAllowed = await emit(guestSocket, 'host:todo-create', { text: 'Co-host task' });
  check(
    'a co-host can manage tasks once allowed',
    cohostTodoAllowed.ok === true,
    JSON.stringify(cohostTodoAllowed),
  );

  const revokedSeen = waitFor(guestSocket, 'todos:permission');
  await emit(hostSocket, 'host:todo-permission', { allow: false });
  check('revoking the permission is broadcast too', (await revokedSeen)?.cohostsManageTodos === false);

  const cohostTodoAgain = await emit(guestSocket, 'host:todo-create', { text: 'Should fail' });
  check(
    'the co-host loses task access again',
    cohostTodoAgain.ok === false && cohostTodoAgain.code === 'FORBIDDEN',
  );

  // Ending is still the owner's, and still works for them.
  const hostEnd = await emit(hostSocket, 'host:end-meeting', {});
  check('the host can end the meeting', hostEnd.ok === true, JSON.stringify(hostEnd));

  for (const socket of [hostSocket, guestSocket]) socket.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nTest run failed:', error.message);
  process.exit(1);
});
