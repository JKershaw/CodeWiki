import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E test configuration for CodeWiki.
 *
 * This configuration is optimized for containerized environments
 * like Claude Code on the web, with sandbox disabled.
 *
 * NOTE: --single-process was removed because it causes browser instability -
 * closing a context closes the entire browser, leading to "Target closed" errors.
 * See: https://github.com/microsoft/playwright/issues/1904
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60000,  // Increased timeout for stability
  retries: 2,  // Retry flaky tests twice for containerized env stability
  workers: 1,  // Run tests serially to avoid resource issues

  use: {
    baseURL: 'http://localhost:3001',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15000,  // Longer action timeout for slow environments

    launchOptions: {
      args: [
        '--no-sandbox',              // CRITICAL: Disable Chrome sandbox
        '--disable-setuid-sandbox',  // CRITICAL: Disable setuid sandbox
        '--disable-dev-shm-usage',   // Use /tmp instead of /dev/shm
        '--disable-gpu',             // Disable GPU acceleration
        '--no-first-run',            // Skip first-run wizards
        '--no-zygote',               // Disable zygote process (needed with --no-sandbox)
        // '--single-process',       // REMOVED: Causes context close to kill browser
        '--disable-extensions',      // Disable extensions
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--mute-audio',
        '--hide-scrollbars',
        '--metrics-recording-only',
      ],
    },
  },

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],

  webServer: {
    command: 'PORT=3001 npm run web',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
