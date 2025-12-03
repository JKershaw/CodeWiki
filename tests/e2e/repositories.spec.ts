import { test, expect } from '@playwright/test';

/**
 * E2E tests for repository management.
 */

// A very small public GitHub repo for testing (only 3 commits)
const TEST_GITHUB_REPO_URL = 'https://github.com/octocat/Hello-World';
const TEST_GITHUB_REPO_NAME = 'octocat/Hello-World';

test.describe('Repository Management', () => {
  test('can add a new repository', async ({ page }) => {
    await page.goto('/');

    // Open add form (folder browser)
    await page.click('#add-repo-btn');

    // Wait for folder browser to load
    await expect(page.locator('#folder-list')).toBeVisible({ timeout: 10000 });

    // Wait for the folder list to finish loading (should show folders or "No subdirectories")
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // The global setup creates a test git repo under $HOME (e2e-test-repo)
    // Find and click on a git repository folder (has git-badge)
    const gitFolder = page.locator('.folder-item:has(.git-badge)').first();
    const gitFolderVisible = await gitFolder.isVisible({ timeout: 5000 }).catch(() => false);

    expect(gitFolderVisible, 'Test requires a git repository to be visible in the folder browser. Global setup should have created one under $HOME.').toBeTruthy();

    await gitFolder.click();

    // Submit should now be enabled
    await expect(page.locator('#submit-repo-btn')).not.toBeDisabled();
    await page.click('#submit-repo-btn');

    // Wait for repository to appear in the list (use .first() to avoid strict mode with multiple cards)
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });

    // The newly added repo should appear - verify we have at least 2 cards now
    // (one from global setup, one we just added)
    await expect(page.locator('.card')).toHaveCount(2, { timeout: 10000 });

    // Verify the new card shows with expected elements
    const newCard = page.locator('.card').last();
    await expect(newCard).toBeVisible();
    await expect(newCard.locator('.card-status')).toBeVisible();
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

    // If no repos exist, fail this test (global setup should have created one)
    const existingCard = page.locator('.card').first();
    const cardVisible = await existingCard.isVisible({ timeout: 3000 }).catch(() => false);
    expect(cardVisible, 'Test requires at least one repository card to be visible').toBeTruthy();

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

  test('can add a GitHub repository by URL', async ({ page }) => {
    await page.goto('/');

    // Get initial repo count
    await page.waitForSelector('.card, .placeholder', { timeout: 10000 });
    const initialCards = await page.locator('.card').count();

    // Open add form
    await page.click('#add-repo-btn');

    // Wait for form to appear
    await expect(page.locator('#add-repo-form')).toBeVisible({ timeout: 5000 });

    // Click the GitHub URL toggle button
    await page.click('#source-github-btn');

    // Verify GitHub URL panel is visible and local panel is hidden
    await expect(page.locator('#github-source-panel')).toBeVisible();
    await expect(page.locator('#local-source-panel')).toBeHidden();

    // Submit button should be disabled initially
    await expect(page.locator('#submit-repo-btn')).toBeDisabled();

    // Enter the GitHub URL
    await page.fill('#github-url', TEST_GITHUB_REPO_URL);

    // Submit button should now be enabled
    await expect(page.locator('#submit-repo-btn')).not.toBeDisabled();

    // Button text should say "Clone Repository"
    await expect(page.locator('#submit-repo-btn')).toHaveText('Clone Repository');

    // Click to clone the repository
    await page.click('#submit-repo-btn');

    // Wait for the cloning card to appear with "cloning" status
    await expect(page.locator('.card-status:has-text("cloning")')).toBeVisible({ timeout: 10000 });

    // Wait for cloning to complete - the card should update to show the repo name
    // This may take a while for the clone + commit loading
    await expect(page.locator(`.card-title:has-text("${TEST_GITHUB_REPO_NAME}")`)).toBeVisible({ timeout: 60000 });

    // Verify we have one more card than before
    await expect(page.locator('.card')).toHaveCount(initialCards + 1, { timeout: 10000 });

    // The new repo card should have stats displayed
    const newCard = page.locator(`.card:has(.card-title:has-text("${TEST_GITHUB_REPO_NAME}"))`);
    await expect(newCard).toBeVisible();
    await expect(newCard.locator('.stat')).toHaveCount(4);
  });

  test('shows error for invalid GitHub URL', async ({ page }) => {
    await page.goto('/');

    // Open add form
    await page.click('#add-repo-btn');
    await expect(page.locator('#add-repo-form')).toBeVisible({ timeout: 5000 });

    // Switch to GitHub URL mode
    await page.click('#source-github-btn');

    // Enter an invalid URL
    await page.fill('#github-url', 'https://example.com/not-github');

    // Submit button should remain disabled for invalid URL
    await expect(page.locator('#submit-repo-btn')).toBeDisabled();

    // Try a URL that looks like GitHub but has wrong format
    await page.fill('#github-url', 'https://github.com/only-owner');
    await expect(page.locator('#submit-repo-btn')).toBeDisabled();

    // Valid URL should enable the button
    await page.fill('#github-url', 'https://github.com/owner/repo');
    await expect(page.locator('#submit-repo-btn')).not.toBeDisabled();
  });
});
