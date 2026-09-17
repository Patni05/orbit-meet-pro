import { expect, type Page } from '@playwright/test';

/**
 * Shared setup for the end-to-end suites.
 *
 * Kept separate from any one spec so a second suite does not have to copy the
 * registration and join dance — and so a change to the pre-join screen is
 * fixed in one place rather than in every file that walks through it.
 */

export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000';

export interface Account {
  email: string;
  password: string;
  name: string;
  accessToken: string;
}

/**
 * Fetch with a short retry, because the dev server may be mid-reload during
 * setup and a single refused connection would fail the suite with a bare
 * "fetch failed" that says nothing about the cause.
 */
export async function apiFetch(path: string, init: RequestInit = {}, attempts = 5): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(`${API_URL}${path}`, init);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`could not reach the API at ${API_URL}${path} after ${attempts} attempts: ${lastError}`);
}

export async function registerAccount(name = 'Ada Host'): Promise<Account> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const account = {
    name,
    email: `${name.split(' ')[0]!.toLowerCase()}${stamp}@example.test`,
    password: 'Str0ngPassw0rd!',
  };

  const response = await apiFetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  if (!response.ok) throw new Error(`registration failed: ${response.status} ${await response.text()}`);

  const data = (await response.json()) as { accessToken: string };
  return { ...account, accessToken: data.accessToken };
}

export async function createMeeting(token: string, title: string): Promise<{ code: string; id: string }> {
  const response = await apiFetch('/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error(`meeting creation failed: ${response.status} ${await response.text()}`);

  const data = (await response.json()) as { meeting: { code: string; id: string } };
  return data.meeting;
}

export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Walks the pre-join screen and lands inside the meeting. */
export async function joinMeeting(page: Page, code: string, displayName?: string): Promise<void> {
  await page.goto(`/room/${code}`);

  const nameField = page.getByLabel('Your name');
  await expect(nameField).toBeVisible({ timeout: 30_000 });
  if (displayName) await nameField.fill(displayName);

  await page.getByRole('button', { name: /Join now|Ask to join/ }).click();
  await expect(page.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible({ timeout: 45_000 });
}

/**
 * Hides the Next.js dev overlay for layout assertions.
 *
 * `next dev` pins an issues badge to the bottom-left corner of the viewport.
 * At 320px that lands on top of the control bar and swallows clicks meant for
 * the Chat button — a failure about the dev server, not about the layout under
 * test. The overlay does not exist in a production build, so removing it here
 * measures what a user would actually get rather than what the dev server adds.
 */
export async function hideDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({
    content: 'nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }',
  });
}

/**
 * Opens an item from the control bar's More menu.
 *
 * Most of the newer panels live there rather than on the bar, and on a phone
 * so do the rest, so going through the menu is the path a real user takes.
 */
export async function openFromMoreMenu(page: Page, item: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'More options' }).click();
  const menu = page.getByRole('menu', { name: 'More options' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item }).click();
}
