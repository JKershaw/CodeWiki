import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E test configuration for CodeWiki.
 *
 * This configuration is optimized for containerized environments
 * like Claude Code on the web, with sandbox disabled.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,  // Retry flaky tests once
  workers: 1,  // Run tests serially to avoid resource issues

  use: {
    baseURL: 'http://localhost:3001',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',

    launchOptions: {
      args: [
        '--no-sandbox',              // CRITICAL: Disable Chrome sandbox
        '--disable-setuid-sandbox',  // CRITICAL: Disable setuid sandbox
        '--disable-dev-shm-usage',   // Use /tmp instead of /dev/shm
        '--disable-gpu',             // Disable GPU acceleration
        '--no-first-run',            // Skip first-run wizards
        '--no-zygote',               // Disable zygote process
        '--single-process',          // Run in single process mode
        '--disable-extensions',      // Disable extensions
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
