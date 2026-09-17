import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API_URL, createMeeting, joinMeeting, openFromMoreMenu, registerAccount, signIn } from './helpers';

/**
 * Audio recording, proved by the file it produces.
 *
 * This has to be a browser test rather than a socket script: the SFU only
 * creates a room once a real client connects to it, so there is nothing to
 * record until somebody has actually joined with media.
 *
 * The assertion that matters is the last one. A recording that reaches
 * "Ready to download" but whose bytes are not an audio container would mean
 * the feature only looks finished — so the file is fetched through the same
 * authorised route the UI uses, and its container signature is checked. That
 * also catches the API and the egress worker disagreeing about where the file
 * lives, which is easy to get wrong because one runs on the host and the other
 * in a container.
 *
 * Skipped, not failed, when the optional egress worker is not running:
 *   docker compose --profile recording up -d egress
 *   RECORDING_ENABLED=true in .env, then restart the API
 */
test.describe('audio recording', () => {
  test.describe.configure({ timeout: 240_000 });

  test('records the meeting and hands the host a real audio file', async ({ browser }) => {
    const account = await registerAccount('Rita Host');
    const meeting = await createMeeting(account.accessToken, 'Recording end to end');
    await enableRecording(account.accessToken, meeting.id);

    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, account);
    await joinMeeting(page, meeting.code, 'Rita Host');

    await openFromMoreMenu(page, 'Start recording');
    await page.getByRole('button', { name: /^Start recording$/ }).click();

    // A server without the egress worker says so. That is a configuration
    // state, not a failure of this feature.
    const unavailable = page.getByText(/recording service is unavailable/i);
    if (await unavailable.isVisible({ timeout: 6_000 }).catch(() => false)) {
      test.skip(true, 'the egress worker is not running — start the recording compose profile');
    }

    // Recording being visible to the room is part of the feature, not decoration.
    await expect(page.getByText('Recording', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    /*
     * Long enough for the recorder to actually be recording.
     *
     * A room-composite egress launches Chromium, joins the room and only then
     * signals that it has started. Stopping before that arrives aborts the job
     * with "Start signal not received" and produces no file at all — which is
     * indistinguishable, from the outside, from recording being broken.
     */
    await page.waitForTimeout(30_000);

    await openFromMoreMenu(page, 'Stop recording');
    await page.getByRole('button', { name: /^Stop recording$/ }).click();

    // The panel is where a host actually collects the file.
    await openFromMoreMenu(page, 'Recordings');
    const panel = page.getByRole('complementary', { name: 'Recordings' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Audio only');

    // Finalising happens in the worker and takes a few seconds.
    const download = panel.getByRole('button', { name: 'Download' });
    await expect(download).toBeVisible({ timeout: 150_000 });
    await expect(panel).toContainText('Ready to download');

    /*
     * Watch the actual request, not just the outcome.
     *
     * The download is a fetch carrying the session's bearer token, turned into
     * a blob and handed to an anchor — so if the route refuses it, the only
     * visible symptom is a save that never happens. Capturing the response
     * makes a 403 or a 404 say so instead of timing out anonymously.
     */
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/recordings/') && r.url().endsWith('/download'),
      { timeout: 60_000 },
    );
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });

    await download.click();

    // Checked first, so a refused request reports its own status rather than
    // surfacing as a save that never happened.
    const response = await responsePromise;
    expect(response.status(), `the download route refused: ${await response.text().catch(() => '')}`).toBe(200);
    expect(response.headers()['cache-control'] ?? '').toContain('no-store');

    const saved = await downloadPromise;

    const file = await saved.path();
    expect(file, 'the recording was not written to disk').toBeTruthy();

    const bytes = readFileSync(file!);
    expect(bytes.length, 'the recording is empty').toBeGreaterThan(0);
    // "OggS" is the four-byte capture pattern every OGG stream begins with.
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('OggS');

    await context.close();
  });
});

async function enableRecording(token: string, meetingId: string): Promise<void> {
  const response = await fetch(`${API_URL}/meetings/${meetingId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ settings: { recordingEnabled: true } }),
  });
  if (!response.ok) {
    throw new Error(`could not enable recording: ${response.status} ${await response.text()}`);
  }
}
