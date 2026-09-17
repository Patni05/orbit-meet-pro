import { expect, test } from '@playwright/test';
import { createMeeting, joinMeeting, registerAccount, signIn } from './helpers';

/**
 * The console must be clean in a working meeting.
 *
 * A React error or a failed request that only shows up as a dev-overlay badge
 * is still a real defect — it means something threw, or a prop contract was
 * broken, on the path a user actually walks. Asserting on it here stops that
 * being discovered later as "a weird overlay covering the chat button".
 *
 * Only genuine errors fail the test. Warnings that come from the dev server
 * itself rather than the application would make this noisy without making it
 * more useful.
 */
test('joining a meeting produces no console errors', async ({ browser }) => {
  const account = await registerAccount('Ada Console');
  const meeting = await createMeeting(account.accessToken, 'Console check');

  const context = await browser.newContext();
  const page = await context.newPage();

  const problems: string[] = [];

  /**
   * Noise that is not an application defect.
   *
   * - The 401 is the session-restore probe the app makes on boot. A visitor
   *   with no refresh cookie gets one, by design; the browser logs every 401
   *   it sees and there is no way to make a real request not 401 quietly.
   * - The LiveKit data-channel message is the SFU client narrating its own
   *   teardown when a page closes, from inside the library.
   * - Autoplay and DevTools notices are the browser and React talking about
   *   the environment.
   *
   * Everything else fails the test, including any React warning, because
   * those come from our own component contracts.
   */
  const expected = [
    /Failed to load resource: the server responded with a status of 401/i,
    /data channel .*closed unexpectedly/i,
    /autoplay|AudioContext|Download the React DevTools/i,
  ];

  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const text = message.text();
    if (expected.some((pattern) => pattern.test(text))) return;
    problems.push(`${message.type()}: ${text}`);
  });

  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });

  await signIn(page, account);
  await joinMeeting(page, meeting.code, 'Ada Console');

  // Exercise the surfaces the new work touches.
  await page.getByRole('button', { name: 'Chat' }).click();
  await expect(page.getByRole('complementary', { name: 'Chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Chat' }).click();

  await page.getByRole('button', { name: 'People' }).click();
  await expect(page.getByRole('complementary', { name: 'People' })).toBeVisible();
  await page.getByRole('button', { name: 'Close People' }).click();

  await page.waitForTimeout(1500);

  expect(problems, `console problems:\n${problems.join('\n')}`).toEqual([]);

  await context.close();
});
