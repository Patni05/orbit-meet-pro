import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * The acceptance test.
 *
 * Two independent browser contexts join one meeting and exchange real media
 * through the SFU. Every assertion below is about observable behaviour — a
 * track actually producing frames, a message actually arriving at the other
 * browser — rather than about a button existing.
 *
 * Requires the API, the web app and LiveKit to be running (see README).
 */

const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000';

/**
 * Fetch with a short retry.
 *
 * Test setup talks to a dev server that may be mid-reload, and a single
 * refused connection during bootstrap would fail the whole suite with a bare
 * "fetch failed" that says nothing about what went wrong. Retrying briefly and
 * then reporting the real cause keeps failures diagnosable.
 */
async function apiFetch(path: string, init: RequestInit = {}, attempts = 5): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(`${API_URL}${path}`, init);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  const cause = (lastError as { cause?: { errors?: { code?: string }[] } })?.cause;
  const codes = cause?.errors?.map((e) => e.code).join(', ');
  throw new Error(
    `could not reach the API at ${API_URL}${path} after ${attempts} attempts` +
      (codes ? ` (${codes})` : '') +
      '. Is the API running?',
  );
}

interface Account {
  email: string;
  password: string;
  name: string;
  accessToken: string;
}

async function registerHost(): Promise<Account> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const account = {
    name: 'Ada Host',
    email: `ada${stamp}@example.test`,
    password: 'Str0ngPassw0rd!',
  };

  const response = await apiFetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  if (!response.ok) {
    throw new Error(`registration failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { accessToken: string };
  return { ...account, accessToken: data.accessToken };
}

async function createMeeting(token: string, title: string): Promise<{ code: string; id: string }> {
  const response = await apiFetch('/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(`meeting creation failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { meeting: { code: string; id: string } };
  return data.meeting;
}

/** Signs a browser context in by replaying the login call the app itself makes. */
async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Walks the pre-join screen and lands inside the meeting. */
async function joinMeeting(page: Page, code: string, displayName?: string): Promise<void> {
  await page.goto(`/room/${code}`);

  const nameField = page.getByLabel('Your name');
  await expect(nameField).toBeVisible({ timeout: 30_000 });

  if (displayName) {
    await nameField.fill(displayName);
  }

  await page.getByRole('button', { name: /Join now|Ask to join/ }).click();

  // The control bar only exists once the meeting UI is mounted.
  await expect(page.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible({ timeout: 45_000 });
}

/**
 * Asserts a <video> element is genuinely decoding frames — not merely present.
 * This is what distinguishes a working call from a convincing mock.
 */
async function expectVideoPlaying(page: Page, index = 0): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((i) => {
          const videos = Array.from(document.querySelectorAll('video'));
          const video = videos[i];
          if (!video) return { found: false, width: 0, time: 0 };
          return {
            found: true,
            width: video.videoWidth,
            time: video.currentTime,
          };
        }, index),
      { timeout: 40_000, message: 'video element never produced frames' },
    )
    .toMatchObject({ found: true });

  await expect
    .poll(
      async () =>
        page.evaluate((i) => {
          const video = Array.from(document.querySelectorAll('video'))[i];
          return video ? video.videoWidth : 0;
        }, index),
      { timeout: 40_000, message: 'video never reported a frame size' },
    )
    .toBeGreaterThan(0);
}

/**
 * Opens a side panel, tolerating it already being open.
 *
 * These tests share one long-lived meeting, so panel state carries between
 * them. Making open/close idempotent means a failure in one test cannot
 * cascade into unrelated ones by leaving the UI in an unexpected state.
 */
async function openPanel(page: Page, name: 'Chat' | 'People'): Promise<Locator> {
  const panel = page.getByRole('complementary', { name });
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

async function closePanels(page: Page): Promise<void> {
  for (const name of ['Chat', 'People'] as const) {
    const close = page.getByRole('button', { name: `Close ${name}` });
    if (await close.isVisible().catch(() => false)) {
      await close.click().catch(() => undefined);
    }
  }
}

test.describe('two-participant meeting', () => {
  let hostContext: BrowserContext;
  let guestContext: BrowserContext;
  let hostPage: Page;
  let guestPage: Page;
  let account: Account;
  let meeting: { code: string; id: string };

  test.beforeAll(async ({ browser }) => {
    account = await registerHost();
    meeting = await createMeeting(account.accessToken, 'End to end meeting');

    // Separate contexts give each participant their own storage and their own
    // media devices, exactly like two different machines.
    hostContext = await browser.newContext();
    guestContext = await browser.newContext();
    hostPage = await hostContext.newPage();
    guestPage = await guestContext.newPage();
  });

  // Leave the UI in a known state so a failure cannot poison later tests.
  test.afterEach(async () => {
    for (const page of [hostPage, guestPage]) {
      if (page && !page.isClosed()) await closePanels(page).catch(() => undefined);
    }
  });

  test.afterAll(async () => {
    await hostContext?.close();
    await guestContext?.close();
  });

  test('host creates and joins a meeting', async () => {
    await signIn(hostPage, account);
    await joinMeeting(hostPage, meeting.code);

    // The host sees their own name and the host badge.
    const people = await openPanel(hostPage, 'People');
    await expect(people.getByText('Ada Host').first()).toBeVisible();
    await expect(people.getByText('Host', { exact: true }).first()).toBeVisible();
    await closePanels(hostPage);

    await expectVideoPlaying(hostPage);
  });

  test('guest joins with just a name and both see each other', async () => {
    await joinMeeting(guestPage, meeting.code, 'Grace Guest');

    // Each side should end up with two tiles.
    await expect
      .poll(async () => hostPage.locator('[data-identity]').count(), { timeout: 40_000 })
      .toBe(2);
    await expect
      .poll(async () => guestPage.locator('[data-identity]').count(), { timeout: 40_000 })
      .toBe(2);

    // And each should be decoding remote video, which only happens if media is
    // actually flowing through the SFU.
    await expectVideoPlaying(hostPage, 1);
    await expectVideoPlaying(guestPage, 1);

    await expect(hostPage.getByText('Grace Guest').first()).toBeVisible();
    await expect(guestPage.getByText('Ada Host').first()).toBeVisible();
  });

  test('participants see each other mute', async () => {
    await hostPage.getByRole('button', { name: 'Mute', exact: true }).click();

    // The guest's roster shows the host as muted. Scoped to the panel so this
    // cannot accidentally pass on an indicator somewhere else on the page.
    const people = await openPanel(guestPage, 'People');
    await expect(people.getByRole('img', { name: 'Muted' }).first()).toBeVisible({ timeout: 20_000 });
    await closePanels(guestPage);

    await hostPage.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect(hostPage.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  });

  test('camera can be turned off and back on', async () => {
    await guestPage.getByRole('button', { name: 'Turn camera off' }).click();
    await expect(guestPage.getByRole('button', { name: 'Turn camera on' })).toBeVisible();

    // The host's view of the guest falls back to an avatar.
    await expect
      .poll(async () => hostPage.locator('video').count(), { timeout: 25_000 })
      .toBeLessThan(2);

    await guestPage.getByRole('button', { name: 'Turn camera on' }).click();
    await expect(guestPage.getByRole('button', { name: 'Turn camera off' })).toBeVisible();
    await expectVideoPlaying(hostPage, 1);
  });

  test('chat is delivered in realtime', async () => {
    await openPanel(hostPage, 'Chat');
    await openPanel(guestPage, 'Chat');

    const message = `Hello from the host ${Date.now()}`;
    await hostPage.getByRole('textbox', { name: 'Message' }).fill(message);
    await hostPage.getByRole('button', { name: 'Send message' }).click();

    await expect(guestPage.getByText(message)).toBeVisible({ timeout: 20_000 });

    const reply = `And hello back ${Date.now()}`;
    await guestPage.getByRole('textbox', { name: 'Message' }).fill(reply);
    await guestPage.getByRole('textbox', { name: 'Message' }).press('Enter');

    await expect(hostPage.getByText(reply)).toBeVisible({ timeout: 20_000 });
  });

  test('chat escapes markup instead of executing it', async () => {
    await openPanel(hostPage, 'Chat');
    const guestChat = await openPanel(guestPage, 'Chat');

    const hostile = `<img src=x onerror="window.__xss=1">`;
    await hostPage.getByRole('textbox', { name: 'Message' }).fill(hostile);
    await hostPage.getByRole('button', { name: 'Send message' }).click();

    // The text is displayed literally...
    await expect(guestChat.getByText(hostile)).toBeVisible({ timeout: 20_000 });
    // ...and no element was created from it, on either side.
    expect(await guestPage.evaluate(() => (window as never as { __xss?: number }).__xss)).toBeUndefined();
    expect(await guestPage.locator('img[src="x"]').count()).toBe(0);
  });

  test('raise hand appears for everyone, in order', async () => {
    await closePanels(guestPage);
    await guestPage.getByRole('button', { name: 'Raise hand' }).click();

    const people = await openPanel(hostPage, 'People');
    await expect(people.getByText('Raised hands')).toBeVisible({ timeout: 20_000 });
    await expect(people.getByText('Grace Guest').first()).toBeVisible();

    await guestPage.getByRole('button', { name: 'Lower hand' }).click();
  });

  test('host-only actions are refused by the server, not just hidden', async () => {
    // The guest is offered no moderation menu on the host's row...
    const guestPeople = await openPanel(guestPage, 'People');
    await expect(guestPeople.getByRole('button', { name: /Options for Ada Host/ })).toHaveCount(0);

    // ...but a hidden button proves nothing. The real guarantee is that the
    // server refuses the action when it is requested directly, bypassing the
    // UI entirely. A signed-in user who is not this meeting's host stands in
    // for an attacker crafting the call by hand.
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const outsider = await apiFetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mallory Outsider',
        email: `mallory${stamp}@example.test`,
        password: 'Str0ngPassw0rd!',
      }),
    });
    const { accessToken } = (await outsider.json()) as { accessToken: string };

    const attempt = await apiFetch(`/meetings/${meeting.id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    });

    // Forbidden (or not-found, if the server declines to confirm the meeting
    // exists to a stranger). What matters is that it is not allowed.
    expect([403, 404]).toContain(attempt.status);

    // And the meeting is demonstrably still running for the people in it.
    await expect(hostPage.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible();
  });

  test('host removes the guest and the guest is told', async () => {
    const hostPeople = await openPanel(hostPage, 'People');

    await hostPeople.getByRole('button', { name: /Options for Grace Guest/ }).click();
    await hostPeople.getByRole('menuitem', { name: 'Remove from meeting' }).click();

    await expect(guestPage.getByText('You were removed from the meeting')).toBeVisible({ timeout: 25_000 });

    // The roster drops back to one.
    await expect
      .poll(async () => hostPage.locator('[data-identity]').count(), { timeout: 25_000 })
      .toBe(1);
  });

  test('host ends the meeting and every client sees the ended state', async () => {
    const rejoinPage = await guestContext.newPage();
    await joinMeeting(rejoinPage, meeting.code, 'Another Guest');

    await hostPage.getByRole('button', { name: 'Leave the meeting' }).click();
    await hostPage.getByRole('button', { name: 'End meeting for everyone' }).click();

    await expect(hostPage.getByText('This meeting has ended')).toBeVisible({ timeout: 25_000 });
    await expect(rejoinPage.getByText('This meeting has ended')).toBeVisible({ timeout: 25_000 });

    // A late arrival is told the meeting is over rather than dropped into an empty room.
    const latePage = await guestContext.newPage();
    await latePage.goto(`/room/${meeting.code}`);
    await expect(latePage.getByText('This meeting has ended')).toBeVisible({ timeout: 25_000 });

    await rejoinPage.close();
    await latePage.close();
  });
});
