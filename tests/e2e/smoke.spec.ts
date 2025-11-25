import { test, expect } from '@playwright/test';

/**
 * Smoke tests for CodeWiki web interface.
 *
 * These tests verify the basic functionality of the application
 * to catch major regressions quickly.
 */

test.describe('Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle('CodeWiki');

    // Check header is visible
    await expect(page.locator('header h1')).toHaveText('CodeWiki');
    await expect(page.locator('.tagline')).toHaveText('Living documentation from your Git history');
  });

  test('navigation buttons are present', async ({ page }) => {
    await page.goto('/');

    // Check navigation buttons
    await expect(page.locator('[data-view="repos"]')).toBeVisible();
    await expect(page.locator('[data-view="wiki"]')).toBeVisible();
    await expect(page.locator('[data-view="query"]')).toBeVisible();

    // Repos should be active by default
    await expect(page.locator('[data-view="repos"]')).toHaveClass(/active/);
  });

  test('repositories view is visible by default', async ({ page }) => {
    await page.goto('/');

    // Repos view should be active
    await expect(page.locator('#repos-view')).toHaveClass(/active/);

    // Add Repository button should be visible
    await expect(page.locator('#add-repo-btn')).toBeVisible();
  });

  test('add repository form can be toggled', async ({ page }) => {
    await page.goto('/');

    // Form should be hidden initially
    await expect(page.locator('#add-repo-form')).toHaveClass(/hidden/);

    // Click add button
    await page.click('#add-repo-btn');

    // Form should be visible
    await expect(page.locator('#add-repo-form')).not.toHaveClass(/hidden/);

    // Click cancel
    await page.click('#cancel-repo-btn');

    // Form should be hidden again
    await expect(page.locator('#add-repo-form')).toHaveClass(/hidden/);
  });

  test('API endpoint returns valid JSON', async ({ request }) => {
    const response = await request.get('/api/repos');

    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('application/json');

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('footer is visible', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('footer')).toBeVisible();
    await expect(page.locator('footer')).toContainText('CodeWiki');
  });
});
