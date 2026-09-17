import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  createMeeting,
  joinMeeting,
  hideDevOverlay,
  openFromMoreMenu,
  registerAccount,
  signIn,
  type Account,
} from './helpers';

/**
 * The control surfaces a host actually reaches for: announcements, media
 * locks, the task list, presence checks — plus the two animations and the
 * mobile layout that were reported broken.
 *
 * Every assertion is about what the *other* browser sees, or about a measured
 * layout value, rather than about a button existing. A test that only proves a
 * control is on screen would have passed happily while the reaction faded out
 * halfway up and the chat box sat under the keyboard.
 */

test.describe('host controls and layout', () => {
  let hostContext: BrowserContext;
  let guestContext: BrowserContext;
  let hostPage: Page;
  let guestPage: Page;
  let account: Account;
  let meeting: { code: string; id: string };

  test.beforeAll(async ({ browser }) => {
    account = await registerAccount('Ada Host');
    meeting = await createMeeting(account.accessToken, 'Controls end to end');

    hostContext = await browser.newContext();
    guestContext = await browser.newContext();
    hostPage = await hostContext.newPage();
    guestPage = await guestContext.newPage();

    await signIn(hostPage, account);
    await joinMeeting(hostPage, meeting.code, 'Ada Host');
    await joinMeeting(guestPage, meeting.code, 'Grace Guest');
  });

  test.afterAll(async () => {
    await hostContext?.close();
    await guestContext?.close();
  });

  // ------------------------------------------------------- announcements

  test('an announcement reaches the other participant and can be cleared', async () => {
    const body = `Presentation starts in two minutes ${Date.now()}`;

    await openFromMoreMenu(hostPage, 'Send an announcement');
    await hostPage.getByRole('textbox', { name: 'Announcement' }).fill(body);
    await hostPage.getByRole('button', { name: 'Announce' }).click();

    // The banner is a status region, and it must carry the sender's name so
    // the room knows who is speaking to them.
    const guestBanner = guestPage.getByRole('status').filter({ hasText: body });
    await expect(guestBanner).toBeVisible();
    await expect(guestBanner).toContainText('Ada Host');

    // The host sees their own announcement too, and owns the clear.
    const hostBanner = hostPage.getByRole('status').filter({ hasText: body });
    await expect(hostBanner).toBeVisible();

    await hostPage.getByRole('button', { name: 'Clear announcement for everyone' }).click();
    await expect(guestBanner).toBeHidden();
  });

  test('a participant can hide an announcement without clearing it for everyone', async () => {
    const body = `Reminder ${Date.now()}`;

    await openFromMoreMenu(hostPage, 'Send an announcement');
    await hostPage.getByRole('textbox', { name: 'Announcement' }).fill(body);
    await hostPage.getByRole('button', { name: 'Announce' }).click();

    const guestBanner = guestPage.getByRole('status').filter({ hasText: body });
    await expect(guestBanner).toBeVisible();

    // A participant gets a hide, not a clear — the difference that matters is
    // that the host's copy is untouched.
    await guestPage.getByRole('button', { name: 'Hide this announcement' }).click();
    await expect(guestBanner).toBeHidden();
    await expect(hostPage.getByRole('status').filter({ hasText: body })).toBeVisible();

    await hostPage.getByRole('button', { name: 'Clear announcement for everyone' }).click();
  });

  // ------------------------------------------------------------ reactions

  test('a reaction rises the full height of the meeting area', async () => {
    await hostPage.getByRole('button', { name: 'Send a reaction' }).click();
    await hostPage.getByRole('menuitem', { name: /Send .* reaction/ }).first().click();

    // It must appear for the *other* participant, not just the sender.
    const reaction = guestPage.locator('.animate-reaction-rise').first();
    await expect(reaction).toBeVisible();

    // Anchored here, because a reaction is deliberately short-lived: measuring
    // the wait from the start of the test would be racing its own setup cost
    // rather than testing the lifetime.
    const appearedAt = Date.now();

    /*
     * The regression this guards.
     *
     * `--rise` used to be a hard-coded 230px inside a 288px strip, so the
     * reaction faded out about a third of the way up any real screen. It is
     * now measured from the layer, so it must be close to the meeting area's
     * own height.
     */
    const measured = await reaction.evaluate((element) => {
      const rise = getComputedStyle(element).getPropertyValue('--rise').trim();
      const layer = element.closest('[data-reaction-layer]')!.getBoundingClientRect().height;
      return { rise: Number.parseFloat(rise), layer };
    });

    expect(measured.rise).toBeGreaterThan(200);
    // Within a pixel of the layer it is travelling across.
    expect(Math.abs(measured.rise - measured.layer)).toBeLessThanOrEqual(1);

    /*
     * And it must still be on screen after the old removal deadline.
     *
     * Reactions were dropped from the store at 2600ms while the animation ran
     * for 3200ms, so they were unmounted in mid-air regardless of distance.
     */
    const remaining = 2800 - (Date.now() - appearedAt);
    if (remaining > 0) await guestPage.waitForTimeout(remaining);
    await expect(reaction).toBeVisible();

    // It does clear itself eventually; a reaction that never left would be its
    // own bug.
    await expect(guestPage.locator('.animate-reaction-rise')).toHaveCount(0, { timeout: 15_000 });
  });

  // ---------------------------------------------------------- task list

  test('the task list is host-writable, visible to everyone, and survives a reload', async () => {
    const text = `Send the deck ${Date.now()}`;

    await openFromMoreMenu(hostPage, 'Tasks');
    await hostPage.getByLabel('New task').fill(text);
    await hostPage.getByRole('button', { name: 'Add task' }).click();

    // The participant sees the list but is given no way to change it.
    await openFromMoreMenu(guestPage, 'Tasks');
    const guestPanel = guestPage.getByRole('complementary', { name: 'Tasks' });
    await expect(guestPanel).toContainText(text);
    await expect(guestPanel).toContainText('Only the host can change this list');
    await expect(guestPanel.getByLabel('New task')).toHaveCount(0);

    // Completing it on the host propagates.
    await hostPage.getByRole('button', { name: `Mark "${text}" as done` }).click();
    await expect(guestPanel.getByRole('button', { name: `Mark "${text}" as not done` })).toBeVisible();

    /*
     * Persistence is the point of the whole feature: the list lives in the
     * database, not in the host's tab. A reload is the honest test — it drops
     * every bit of client state and rebuilds from `room:state`.
     */
    await hostPage.reload();
    await expect(hostPage.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible({ timeout: 45_000 });
    await openFromMoreMenu(hostPage, 'Tasks');
    const hostPanel = hostPage.getByRole('complementary', { name: 'Tasks' });
    await expect(hostPanel).toContainText(text);
    await expect(hostPanel.getByRole('button', { name: `Mark "${text}" as not done` })).toBeVisible();

    // Tidy up so the count assertions in later tests are not affected.
    await hostPage.getByRole('button', { name: `Delete task "${text}"` }).click();
    await expect(guestPanel).not.toContainText(text);
    await guestPage.getByRole('button', { name: 'Close Tasks' }).click();
    await hostPage.getByRole('button', { name: 'Close Tasks' }).click();
  });

  // ------------------------------------------------------------- locks

  test('a microphone lock disables the participant control and says why', async () => {
    const guestMic = guestPage.getByRole('button', { name: /^(Mute|Unmute|The host has locked microphones)$/ });

    await openFromMoreMenu(hostPage, 'Lock microphones');

    // The participant's own control reflects it, and refuses the press.
    await expect(guestPage.getByRole('button', { name: 'The host has locked microphones' })).toBeVisible();
    await expect(guestMic).toBeDisabled();

    // And the room is told, rather than leaving it to whoever presses Unmute.
    await expect(guestPage.getByTitle(/locked microphones for participants/)).toBeVisible();

    await openFromMoreMenu(hostPage, 'Unlock microphones');
    await expect(guestPage.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeEnabled();
  });

  test('a camera lock is independent of the microphone lock', async () => {
    await openFromMoreMenu(hostPage, 'Lock cameras');

    await expect(guestPage.getByRole('button', { name: 'The host has locked cameras' })).toBeVisible();
    // The microphone must be untouched by a camera lock.
    await expect(guestPage.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeEnabled();

    await openFromMoreMenu(hostPage, 'Unlock cameras');
    await expect(guestPage.getByRole('button', { name: /Turn camera (on|off)/ })).toBeEnabled();
  });

  // --------------------------------------------------- presence checks

  test('a presence check is asked for, consented to, and answered by the participant', async () => {
    // Consent comes first and is the participant's own. Until it is given the
    // host cannot send anything at all.
    const consent = guestPage.getByRole('dialog').filter({ hasText: 'Allow presence checks?' });
    await expect(consent).toBeVisible();
    await expect(consent).toContainText('your camera and microphone are never touched');
    await consent.getByRole('button', { name: 'Allow' }).click();
    await expect(consent).toBeHidden();

    // Now the host may ask — through the participant list, per person.
    await hostPage.getByRole('button', { name: 'People' }).click();
    const people = hostPage.getByRole('complementary', { name: 'People' });
    await expect(people).toBeVisible();
    await people.getByRole('button', { name: 'Options for Grace Guest' }).click();
    await hostPage.getByRole('menuitem', { name: 'Check they are here' }).click();

    // The participant is prompted and answers themselves; nothing is read
    // from their device and nothing happens without their tap.
    const prompt = guestPage.getByRole('alertdialog');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Ada Host is checking who is still here');
    await prompt.getByRole('button', { name: /I.m here/ }).click();
    await expect(prompt).toBeHidden();

    // The host sees the confirmation against that person.
    await expect(people.getByRole('img', { name: 'Confirmed they are here' })).toBeVisible();
    await hostPage.getByRole('button', { name: 'Close People' }).click();
  });

  // ------------------------------------------------------- mobile chat

  test('the chat composer stays reachable at phone widths', async () => {
    try {
      await checkPhoneWidths(guestPage);
    } finally {
      // Restored even on failure: leaving a phone viewport behind would make
      // every later test fail for a reason that has nothing to do with it.
      await guestPage.setViewportSize({ width: 1280, height: 720 });
    }
  });

  async function checkPhoneWidths(page: Page): Promise<void> {
    // The widths a real phone actually reports, narrowest first.
    for (const width of [320, 360, 375, 390, 414, 430]) {
      await page.setViewportSize({ width, height: 640 });
      await hideDevOverlay(page);

      await page.getByRole('button', { name: 'Chat' }).click();
      const panel = page.getByRole('complementary', { name: 'Chat' });
      await expect(panel).toBeVisible();

      const input = page.getByRole('textbox', { name: 'Message' });
      await expect(input).toBeVisible();

      /*
       * The composer must sit inside the viewport, and the control bar must
       * still be under it rather than covered by the sheet. The old sheet was
       * `absolute inset-0` against the viewport, so it swallowed the control
       * bar entirely and the input was pushed past the bottom edge.
       */
      const box = (await input.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(640);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);

      // Leave is never covered: it is the one control that must always work.
      await expect(page.getByRole('button', { name: 'Leave the meeting' })).toBeVisible();

      // 16px avoids iOS zooming the page on focus, which breaks the layout.
      const fontSize = await input.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(16);

      // And a message still actually sends at this width.
      const message = `hello from ${width}px`;
      await input.fill(message);
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(panel).toContainText(message);

      await page.getByRole('button', { name: 'Close Chat' }).click();
    }
  }

  test('the control bar fits without overflowing the narrowest phone', async () => {
    await guestPage.setViewportSize({ width: 320, height: 640 });
    await hideDevOverlay(guestPage);

    // No horizontal scroll anywhere on the page.
    const overflow = await guestPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Every control on the bar keeps a thumb-sized target.
    for (const name of ['Mute', 'Unmute', 'Chat', 'People', 'More options', 'Leave the meeting']) {
      const button = guestPage.getByRole('button', { name, exact: true });
      if (!(await button.isVisible().catch(() => false))) continue;
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }

    await guestPage.setViewportSize({ width: 1280, height: 720 });
  });

  // ---------------------------------------------------------- avatars

  test('a camera-off participant gets a large avatar that scales with the tile', async () => {
    // The fake device gives every tile real video, so the camera has to be
    // turned off for the avatar to be what is rendered at all.
    for (const page of [hostPage, guestPage]) {
      const camera = page.getByRole('button', { name: 'Turn camera off' });
      if (await camera.isVisible().catch(() => false)) await camera.click();
      await expect(page.getByRole('button', { name: 'Turn camera on' })).toBeVisible();
    }

    const tile = guestPage.locator('[data-identity]').first();
    await expect(tile).toBeVisible();
    await expect(tile.locator('[data-avatar="tile"]')).toBeVisible();

    const measured = await tile.evaluate((element) => {
      const avatar = element.querySelector('[data-avatar="tile"]');
      const box = avatar?.getBoundingClientRect();
      return {
        avatar: box ? Math.round(box.width) : 0,
        tile: Math.round(element.getBoundingClientRect().width),
      };
    });

    // It used to be a fixed 56px circle whatever the tile. It should now be a
    // meaningful share of it.
    expect(measured.avatar).toBeGreaterThan(80);
    expect(measured.avatar / measured.tile).toBeGreaterThan(0.25);
  });
});
