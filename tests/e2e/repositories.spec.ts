import { test, expect } from '@playwright/test';

/**
 * E2E tests for repository management.
 */

test.describe('Repository Management', () => {
  test('can add a new repository', async ({ page }) => {
    await page.goto('/');

    // Open add form (folder browser)
    await page.click('#add-repo-btn');

    // Wait for folder browser to load
    await expect(page.locator('#folder-list')).toBeVisible({ timeout: 10000 });

    // Find and click on a git repository folder (has git-badge)
    const gitFolder = page.locator('.folder-item:has(.git-badge)').first();
    if (await gitFolder.isVisible({ timeout: 5000 }).catch(() => false)) {
      await gitFolder.click();

      // Submit should now be enabled
      await expect(page.locator('#submit-repo-btn')).not.toBeDisabled();
      await page.click('#submit-repo-btn');

      // Wait for repository to appear
      await expect(page.locator('.card')).toBeVisible({ timeout: 10000 });

      // Verify repository card shows
      const card = page.locator('.card').first();
      await expect(card).toBeVisible();
      await expect(card.locator('.card-status')).toBeVisible();
    } else {
      // No git repos found in folder browser, skip test
      test.skip();
    }
  });

  test('can view repository details', async ({ page }) => {
    await page.goto('/');

    // Wait for repos to load
    await page.waitForSelector('.card, .placeholder', { timeout: 10000 });

    // If a repo exists, check its stats
    const card = page.locator('.card').first();
    if (await card.isVisible()) {
      // Check stats are displayed
      await expect(card.locator('.stat')).toHaveCount(4);
      await expect(card.locator('.stat-label')).toContainText(['Commits', 'Processed', 'Wiki Pages', 'Coverage']);
    }
  });

  test('can start processing a repository', async ({ page }) => {
    await page.goto('/');

    // Wait for repos to load - should have at least one from global setup
    await page.waitForSelector('.card, .placeholder', { timeout: 10000 });

    // If no repos exist, skip this test (global setup should have created one)
    const existingCard = page.locator('.card').first();
    if (!(await existingCard.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Click process button
    const processBtn = page.locator('.process-btn').first();
    await processBtn.click();

    // Button should show processing state
    await expect(processBtn).toHaveText(/Processing|Starting/);
  });

  test('wiki and query buttons are disabled when no wiki pages exist', async ({ page, request }) => {
    // First check if we have any repos with wiki pages
    const response = await request.get('/api/repos');
    const repos = await response.json();

    await page.goto('/');
    await page.waitForSelector('.card, .placeholder', { timeout: 10000 });

    // If we have repos, check button states match wiki page count
    if (repos.length > 0) {
      const firstRepo = repos[0];
      const card = page.locator('.card').first();

      if (firstRepo.wikiPages > 0) {
        // Buttons should be enabled
        await expect(card.locator('.wiki-btn')).not.toBeDisabled();
        await expect(card.locator('.query-btn')).not.toBeDisabled();
      } else {
        // Buttons should be disabled
        await expect(card.locator('.wiki-btn')).toBeDisabled();
        await expect(card.locator('.query-btn')).toBeDisabled();
      }
    }
  });
});
