import { test, expect } from '@playwright/test';

/**
 * E2E tests for wiki browsing.
 */

test.describe('Wiki Browser', () => {
  test.beforeEach(async ({ page, request }) => {
    // Ensure we have a repo with wiki pages
    const response = await request.get('/api/repos');
    const repos = await response.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    if (!repoWithWiki) {
      test.skip();
      return;
    }

    await page.goto('/');
    await page.waitForSelector('.card', { timeout: 10000 });
  });

  test('can open wiki view from repository card', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    // Find the card with wiki pages and click Browse Wiki
    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wiki view should be visible
    await expect(page.locator('#wiki-view')).toHaveClass(/active/);
    await expect(page.locator('#wiki-sidebar')).toBeVisible();
    await expect(page.locator('#wiki-content')).toBeVisible();
  });

  test('wiki sidebar shows categories', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wait for sidebar to load
    await page.waitForSelector('.wiki-category', { timeout: 10000 });

    // Categories should be visible
    await expect(page.locator('.wiki-category')).toBeVisible();
    await expect(page.locator('.wiki-category-title')).toBeVisible();
  });

  test('can click on a wiki page to view content', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wait for pages to load
    await page.waitForSelector('.wiki-page-link', { timeout: 10000 });

    // Click first page
    await page.locator('.wiki-page-link').first().click();

    // Content should update
    await expect(page.locator('#wiki-content h1, #wiki-content h2')).toBeVisible({ timeout: 10000 });
  });

  test('wiki page shows confidence score', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    await page.waitForSelector('.wiki-page-link', { timeout: 10000 });
    await page.locator('.wiki-page-link').first().click();

    // Wait for content to load
    await page.waitForSelector('.wiki-meta', { timeout: 10000 });

    // Confidence should be shown
    await expect(page.locator('.wiki-meta')).toContainText('Confidence');
    await expect(page.locator('.confidence-bar')).toBeVisible();
  });

  test('can navigate back to repos from wiki', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    await expect(page.locator('#wiki-view')).toHaveClass(/active/);

    // Click back button
    await page.click('#back-to-repos');

    // Should be back on repos view
    await expect(page.locator('#repos-view')).toHaveClass(/active/);
  });
});
