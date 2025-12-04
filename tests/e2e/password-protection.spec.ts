import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';

/**
 * E2E tests for password protection feature.
 *
 * Tests two scenarios:
 * 1. When SITE_PASSWORD is not set - site should be publicly accessible
 * 2. When SITE_PASSWORD is set - site should require authentication
 */

test.describe('Password Protection', () => {
  test.describe('Without password (default server)', () => {
    // These tests use the default server without SITE_PASSWORD

    test('homepage is accessible without authentication', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle('CodeWiki');
      await expect(page.locator('header h1')).toHaveText('CodeWiki');
    });

    test('API endpoints are accessible without authentication', async ({ request }) => {
      const response = await request.get('/api/repos');
      expect(response.ok()).toBeTruthy();
    });

    test('/login redirects to home when password not set', async ({ page }) => {
      await page.goto('/login');
      // Should redirect to home page
      await expect(page).toHaveURL('/');
      await expect(page).toHaveTitle('CodeWiki');
    });
  });

  test.describe('With password protection', () => {
    let serverProcess: ChildProcess | null = null;
    const PROTECTED_PORT = 3002;
    const PROTECTED_URL = `http://localhost:${PROTECTED_PORT}`;
    const TEST_PASSWORD = 'testpassword123';

    test.beforeAll(async () => {
      // Start a separate server with SITE_PASSWORD set
      serverProcess = spawn('npm', ['run', 'web'], {
        env: {
          ...process.env,
          PORT: String(PROTECTED_PORT),
          SITE_PASSWORD: TEST_PASSWORD,
          SESSION_SECRET: 'test-session-secret',
        },
        stdio: 'pipe',
        shell: true,
      });

      // Wait for server to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Server startup timeout'));
        }, 30000);

        const checkServer = async () => {
          try {
            const response = await fetch(`${PROTECTED_URL}/login`);
            if (response.ok) {
              clearTimeout(timeout);
              resolve();
            } else {
              setTimeout(checkServer, 500);
            }
          } catch {
            setTimeout(checkServer, 500);
          }
        };

        // Give the server a moment to start before checking
        setTimeout(checkServer, 2000);
      });
    });

    test.afterAll(async () => {
      if (serverProcess) {
        serverProcess.kill('SIGTERM');
        // Wait for process to exit
        await new Promise<void>((resolve) => {
          if (serverProcess) {
            serverProcess.on('exit', () => resolve());
            // Force kill after 5 seconds
            setTimeout(() => {
              if (serverProcess && !serverProcess.killed) {
                serverProcess.kill('SIGKILL');
              }
              resolve();
            }, 5000);
          } else {
            resolve();
          }
        });
      }
    });

    test('homepage redirects to login when not authenticated', async ({ page }) => {
      await page.goto(PROTECTED_URL);
      await expect(page).toHaveURL(`${PROTECTED_URL}/login`);
      await expect(page.locator('.login-header h1')).toHaveText('CodeWiki');
      await expect(page.locator('input[name="password"]')).toBeVisible();
    });

    test('login page displays correctly', async ({ page }) => {
      await page.goto(`${PROTECTED_URL}/login`);
      await expect(page.locator('.login-header h1')).toHaveText('CodeWiki');
      await expect(page.locator('.login-header p')).toHaveText('Enter password to continue');
      await expect(page.locator('input[name="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toHaveText('Sign In');
    });

    test('wrong password shows error message', async ({ page }) => {
      await page.goto(`${PROTECTED_URL}/login`);
      await page.fill('input[name="password"]', 'wrongpassword');
      await page.click('button[type="submit"]');

      // Should stay on login page with error
      await expect(page).toHaveURL(/\/login\?error=invalid/);
      await expect(page.locator('.error-message')).toBeVisible();
      await expect(page.locator('.error-message')).toContainText('Invalid password');
    });

    test('correct password grants access and redirects to home', async ({ page }) => {
      await page.goto(`${PROTECTED_URL}/login`);
      await page.fill('input[name="password"]', TEST_PASSWORD);
      await page.click('button[type="submit"]');

      // Should redirect to home page
      await expect(page).toHaveURL(PROTECTED_URL + '/');
      await expect(page).toHaveTitle('CodeWiki');
      await expect(page.locator('header h1')).toHaveText('CodeWiki');
    });

    test('authenticated user can access protected pages', async ({ page }) => {
      // First login
      await page.goto(`${PROTECTED_URL}/login`);
      await page.fill('input[name="password"]', TEST_PASSWORD);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(PROTECTED_URL + '/');

      // Now navigate to other pages - should remain authenticated
      await page.goto(PROTECTED_URL);
      await expect(page.locator('header h1')).toHaveText('CodeWiki');
    });

    test('API returns 401 when not authenticated', async ({ request }) => {
      const response = await request.get(`${PROTECTED_URL}/api/repos`);
      expect(response.status()).toBe(401);

      const data = await response.json();
      expect(data.error).toBe('Authentication required');
    });

    test('logout clears authentication', async ({ page }) => {
      // First login
      await page.goto(`${PROTECTED_URL}/login`);
      await page.fill('input[name="password"]', TEST_PASSWORD);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(PROTECTED_URL + '/');

      // Now logout
      await page.goto(`${PROTECTED_URL}/logout`);

      // Should redirect to login
      await expect(page).toHaveURL(`${PROTECTED_URL}/login`);

      // Trying to access home should redirect to login again
      await page.goto(PROTECTED_URL);
      await expect(page).toHaveURL(`${PROTECTED_URL}/login`);
    });
  });
});
