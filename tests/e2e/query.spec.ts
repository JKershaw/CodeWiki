import { test, expect } from '@playwright/test';

/**
 * E2E tests for wiki querying.
 */

test.describe('Wiki Query', () => {
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

  test('can open query view from repository card', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    // Find the card with wiki pages and click Query
    const queryBtn = page.locator('.query-btn:not([disabled])').first();
    await queryBtn.click();

    // Query view should be visible
    await expect(page.locator('#query-view')).toHaveClass(/active/);
    await expect(page.locator('#query-question')).toBeVisible();
    await expect(page.locator('#submit-query')).toBeVisible();
  });

  test('query input is focused when opening query view', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const queryBtn = page.locator('.query-btn:not([disabled])').first();
    await queryBtn.click();

    // Input should be focused
    await expect(page.locator('#query-question')).toBeFocused();
  });

  test('can submit a query and see results', async ({ page, request }) => {
    // This test requires an API key, so we check if mock or real LLM
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const queryBtn = page.locator('.query-btn:not([disabled])').first();
    await queryBtn.click();

    // Enter a question
    await page.fill('#query-question', 'What is the architecture?');

    // Submit
    await page.click('#submit-query');

    // Should show loading
    await expect(page.locator('#query-answer')).toContainText(/Searching|Loading/);

    // Wait for result (may take a while with real LLM)
    await expect(page.locator('#query-result')).not.toHaveClass(/hidden/, { timeout: 60000 });

    // Result should have content
    await expect(page.locator('#query-answer')).not.toBeEmpty();
  });

  test('query result shows confidence and sources', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const queryBtn = page.locator('.query-btn:not([disabled])').first();
    await queryBtn.click();

    await page.fill('#query-question', 'What is the architecture?');
    await page.click('#submit-query');

    // Wait for result
    await expect(page.locator('#query-meta')).not.toBeEmpty({ timeout: 60000 });

    // Check confidence is shown
    await expect(page.locator('#query-meta')).toContainText('Confidence');
  });

  test('can submit query with Enter key', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const queryBtn = page.locator('.query-btn:not([disabled])').first();
    await queryBtn.click();

    // Enter a question and press Enter
    await page.fill('#query-question', 'What is the architecture?');
    await page.press('#query-question', 'Enter');

    // Should trigger search
    await expect(page.locator('#query-answer')).toContainText(/Searching|Loading/);
  });

  test('can navigate back to repos from query', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);

    if (!repoWithWiki) {
      test.skip();
      return;
    }

    const queryBtn = page.locator('.query-btn:not([disabled])').first();
    await queryBtn.click();

    await expect(page.locator('#query-view')).toHaveClass(/active/);

    // Click back button
    await page.click('#back-to-repos-query');

    // Should be back on repos view
    await expect(page.locator('#repos-view')).toHaveClass(/active/);
  });
});
