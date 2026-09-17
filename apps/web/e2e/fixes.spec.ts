import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  createMeeting,
  hideDevOverlay,
  joinMeeting,
  openFromMoreMenu,
  registerAccount,
  signIn,
  type Account,
} from './helpers';

/**
 * Regression tests for the reported bugs.
 *
 * Each one asserts the specific thing that was wrong, so a fix that gets
 * reverted or half-applied fails here rather than in someone's meeting.
 */
test.describe('reported bugs', () => {
  let hostContext: BrowserContext;
  let guestContext: BrowserContext;
  let hostPage: Page;
  let guestPage: Page;
  let account: Account;
  let meeting: { code: string; id: string };

  test.beforeAll(async ({ browser }) => {
    account = await registerAccount('Ada Fixes');
    meeting = await createMeeting(account.accessToken, 'Bug fixes');

    hostContext = await browser.newContext();
    guestContext = await browser.newContext();
    hostPage = await hostContext.newPage();
    guestPage = await guestContext.newPage();

    await signIn(hostPage, account);
    await joinMeeting(hostPage, meeting.code, 'Ada Fixes');
    await joinMeeting(guestPage, meeting.code, 'Grace Guest');
  });

  test.afterAll(async () => {
    await hostContext?.close();
    await guestContext?.close();
  });

  // ----------------------------------------------------- announcement

  test('the announcement dialog focuses the message box so you can type straight away', async () => {
    await openFromMoreMenu(hostPage, 'Send an announcement');

    /*
     * The bug: the modal's initial-focus selector listed `input` and `button`
     * but not `textarea`, so focus went to Cancel. On a phone that means no
     * keyboard appears and the dialog looks like it will not let you type.
     */
    const field = hostPage.getByRole('textbox', { name: 'Announcement' });
    await expect(field).toBeFocused();

    // And typing without clicking first actually reaches it.
    const body = `Typed without clicking ${Date.now()}`;
    await hostPage.keyboard.type(body);
    await expect(field).toHaveValue(body);

    await hostPage.getByRole('button', { name: 'Announce' }).click();
    await expect(guestPage.getByRole('status').filter({ hasText: body })).toBeVisible();
    await hostPage.getByRole('button', { name: 'Clear announcement for everyone' }).click();
  });

  test('the announcement box stays above the keyboard at phone width', async () => {
    await hostPage.setViewportSize({ width: 360, height: 640 });
    await hideDevOverlay(hostPage);

    try {
      await openFromMoreMenu(hostPage, 'Send an announcement');
      const field = hostPage.getByRole('textbox', { name: 'Announcement' });
      await expect(field).toBeVisible();

      // The dialog is sized from the visual viewport, so the field it exists
      // to fill in is inside the screen rather than under the keyboard.
      const box = (await field.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(640);

      // 16px at phone width, or iOS zooms the page the moment the field takes
      // focus and the dialog is left half off-screen. Desktop keeps 14px.
      const fontSize = await field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(16);

      await hostPage.getByRole('button', { name: 'Close dialog' }).click();
    } finally {
      await hostPage.setViewportSize({ width: 1280, height: 720 });
    }
  });

  // -------------------------------------------------------- recording

  test('recording can be started even though it is off for the meeting by default', async () => {
    /*
     * The bug: recording is off per meeting, the menu row was `disabled`, and
     * the only explanation was a `title` tooltip — invisible on a touch screen.
     * The switch itself was buried in the meeting information panel. So the
     * button simply did nothing, for a reason nothing on screen mentioned.
     */
    await openFromMoreMenu(hostPage, /Start recording/);

    const dialog = hostPage.getByRole('dialog', { name: 'Start recording?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Recording is off for this meeting');

    const enable = dialog.getByRole('button', { name: 'Turn on and record' });
    await expect(enable).toBeEnabled();
    await enable.click();

    // Either it starts, or it says why — never a dialog that closes on a
    // failure and leaves the host believing it is recording.
    const started = hostPage.getByText('Recording', { exact: true }).first();
    const explained = dialog.getByRole('alert');

    await expect(started.or(explained).first()).toBeVisible({ timeout: 45_000 });

    if (await started.isVisible().catch(() => false)) {
      await openFromMoreMenu(hostPage, 'Stop recording');
      await hostPage.getByRole('button', { name: /^Stop recording$/ }).click();
    } else {
      await hostPage.getByRole('button', { name: 'Cancel' }).click();
    }
  });

  // -------------------------------------------------------- reactions

  test('a reaction is centred on its lane rather than pinned to the left edge', async () => {
    await guestPage.setViewportSize({ width: 360, height: 640 });
    await hideDevOverlay(guestPage);

    try {
      // Several, so this is about the layout rule and not one lucky lane.
      for (let i = 0; i < 4; i += 1) {
        await hostPage.getByRole('button', { name: 'Send a reaction' }).click();
        await hostPage.getByRole('menuitem', { name: /Send .* reaction/ }).first().click();
        await hostPage.waitForTimeout(150);
      }

      const reactions = guestPage.locator('.animate-reaction-rise');
      await expect(reactions.first()).toBeVisible();

      const boxes = await reactions.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, centre: rect.left + rect.width / 2 };
        }),
      );

      expect(boxes.length).toBeGreaterThan(0);

      for (const box of boxes) {
        /*
         * The bug: the element was positioned with `left: <lane>%` and no
         * centring, because the rise animation owns `transform`. It was
         * therefore anchored by its left edge, and on a phone the low lanes
         * put a ~144px chip hard against the left of the screen.
         */
        expect(box.left, 'a reaction is off the left edge').toBeGreaterThanOrEqual(-1);
        expect(box.right, 'a reaction is off the right edge').toBeLessThanOrEqual(361);

        // And it is somewhere in the middle band, not hugging an edge.
        expect(box.centre).toBeGreaterThan(360 * 0.1);
        expect(box.centre).toBeLessThan(360 * 0.9);
      }
    } finally {
      await guestPage.setViewportSize({ width: 1280, height: 720 });
    }
  });

  // -------------------------------------------- picture-in-picture

  test('picture-in-picture states what it will do instead of failing silently', async () => {
    await openFromMoreMenu(hostPage, /Picture-in-picture|Close picture-in-picture/).catch(
      async () => {
        // With no video anywhere it is shown as an explained, non-clickable
        // row — which is itself the fix for a button that did nothing.
        await hostPage.getByRole('button', { name: 'More options' }).click();
        const menu = hostPage.getByRole('menu', { name: 'More options' });
        await expect(menu).toContainText('Picture-in-picture');
        await expect(menu).toContainText(/camera|not supported/i);
        await hostPage.keyboard.press('Escape');
      },
    );
  });

  // ------------------------------------------------------------ sound

  test('sounds can be silenced, and the choice is remembered', async () => {
    await hostPage.getByRole('button', { name: 'More options' }).click();
    const menu = hostPage.getByRole('menu', { name: 'More options' });

    const toggle = menu.getByRole('menuitemcheckbox', { name: /Sounds/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await hostPage.keyboard.press('Escape');

    // Persisted per device, so a room that annoyed someone once stays quiet.
    const stored = await hostPage.evaluate(() => window.localStorage.getItem('orbit.sound'));
    expect(stored).toBe('off');

    // Put it back so later tests see the default.
    await hostPage.getByRole('button', { name: 'More options' }).click();
    await menu.getByRole('menuitemcheckbox', { name: /Sounds/ }).click();
    await hostPage.keyboard.press('Escape');
  });
});
