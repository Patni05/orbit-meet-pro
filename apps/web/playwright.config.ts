import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Chromium is launched with fake media devices, which give getUserMedia a real
 * synthetic camera and microphone. That means these tests exercise the genuine
 * WebRTC path — capture, publish through the SFU, subscribe, decode — rather
 * than stubbing media out.
 */
export default defineConfig({
  testDir: './e2e',
  // Resets the API's rate-limit budget; see e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  // A meeting test with two peers is stateful; retries hide flakes rather than
  // fixing them, so keep it at one attempt locally.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // The LAN proxy used for device testing presents a self-signed
    // certificate. Accepting it here lets the same suite run against
    // https://<lan-ip>:8443 to verify the path a phone actually takes.
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera', 'microphone'],
        launchOptions: {
          args: [
            // Grant and satisfy getUserMedia without a real webcam.
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            // Needed for WebRTC between headless instances on some CI hosts.
            '--disable-features=WebRtcHideLocalIpsWithMdns',
          ],
        },
      },
    },
  ],
});
