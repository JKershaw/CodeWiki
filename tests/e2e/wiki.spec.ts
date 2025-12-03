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
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    await page.goto('/');
    await page.waitForSelector('.card', { timeout: 10000 });
  });

  test('can open wiki view from repository card', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    // Find the card with wiki pages and click Browse Wiki
    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wiki view should be visible
    await expect(page.locator('#wiki-view')).toHaveClass(/active/);
    await expect(page.locator('#wiki-sidebar')).toBeVisible();
    await expect(page.locator('#wiki-content')).toBeVisible();
  });

  test('wiki sidebar shows tree structure', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wait for sidebar to load
    await page.waitForLoadState('networkidle', { timeout: 15000 });

    // Sidebar should have tree structure
    const hasTree = await page.locator('.wiki-tree').count() > 0;
    const hasTreeNodes = await page.locator('.tree-node').count() > 0;

    // Should have tree with nodes
    expect(hasTree || hasTreeNodes).toBeTruthy();

    // Tree nodes should be visible
    if (hasTreeNodes) {
      await expect(page.locator('.tree-node').first()).toBeVisible();
      await expect(page.locator('.tree-node-header').first()).toBeVisible();
    }
  });

  test('can click on a wiki page to view content', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wait for tree to load
    await page.waitForSelector('.tree-node-header', { timeout: 10000 });

    // Find a visible page node - try root level 'overview' first, or any visible page
    // Nested pages may be inside collapsed parent nodes, so we need to find a visible one
    let pageNode = page.locator('.tree-node-header[data-has-page="true"][data-path="overview"]');
    if (!(await pageNode.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Try to find any visible page node at root level (not inside collapsed children)
      pageNode = page.locator('.wiki-tree > .tree-node > .tree-node-header[data-has-page="true"]').first();
    }
    if (!(await pageNode.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Fallback: expand first parent node that has children
      const parentNode = page.locator('.tree-node-header[data-has-children="true"]').first();
      if (await parentNode.isVisible()) {
        await parentNode.locator('.tree-toggle').click();
        await page.waitForTimeout(300);
      }
      pageNode = page.locator('.tree-node-header[data-has-page="true"]:visible').first();
    }

    await pageNode.click();

    // Content should update - check for wiki-body with content or wiki-meta (which appears after load)
    // Note: We check for .wiki-body or .wiki-meta because the markdown library may not be loaded in test env
    await expect(page.locator('#wiki-content .wiki-body, #wiki-content .wiki-meta').first()).toBeVisible({ timeout: 10000 });
  });

  test('wiki page shows confidence score', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wait for tree to load
    await page.waitForSelector('.tree-node-header', { timeout: 10000 });

    // Find a visible page node - try root level 'overview' first
    let pageNode = page.locator('.tree-node-header[data-has-page="true"][data-path="overview"]');
    if (!(await pageNode.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Expand first parent node to reveal nested pages
      const parentNode = page.locator('.tree-node-header[data-has-children="true"]').first();
      if (await parentNode.isVisible()) {
        await parentNode.locator('.tree-toggle').click();
        await page.waitForTimeout(300);
      }
      pageNode = page.locator('.tree-node-header[data-has-page="true"]:visible').first();
    }

    await pageNode.click();

    // Wait for content to load
    await page.waitForSelector('.wiki-meta', { timeout: 10000 });

    // Confidence should be shown
    await expect(page.locator('.wiki-meta')).toContainText('Confidence');
    await expect(page.locator('.confidence-bar')).toBeVisible();
  });

  test('can expand and collapse tree nodes', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wait for tree to load
    await page.waitForSelector('.tree-node-header', { timeout: 10000 });

    // Find a node with children (has visible toggle)
    const nodeWithChildren = page.locator('.tree-node-header[data-has-children="true"]').first();
    const hasExpandableNode = await nodeWithChildren.count() > 0;
    expect(hasExpandableNode, 'Test requires wiki tree with nested structure (expandable nodes)').toBeTruthy();

    // Get the path of this node
    const nodePath = await nodeWithChildren.getAttribute('data-path');

    // Initially collapsed - children should not be visible
    const childrenContainer = page.locator(`.tree-children[data-path="${nodePath}"]`);

    // Click to expand
    await nodeWithChildren.locator('.tree-toggle').click();
    await expect(childrenContainer).toHaveClass(/expanded/);

    // Click again to collapse
    await nodeWithChildren.locator('.tree-toggle').click();
    await expect(childrenContainer).not.toHaveClass(/expanded/);
  });

  test('can navigate back to repos from wiki', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    await expect(page.locator('#wiki-view')).toHaveClass(/active/);

    // Click back button
    await page.click('#back-to-repos');

    // Should be back on repos view
    await expect(page.locator('#repos-view')).toHaveClass(/active/);
  });

  test('selected page is highlighted in tree', async ({ page, request }) => {
    const response = await request.get('/api/repos');
    const repos = await response.json();
    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    const wikiBtn = page.locator('.wiki-btn:not([disabled])').first();
    await wikiBtn.click();

    // Wait for tree to load
    await page.waitForSelector('.tree-node-header', { timeout: 10000 });

    // Find a visible page node - try root level 'overview' first
    let pageNode = page.locator('.tree-node-header[data-has-page="true"][data-path="overview"]');
    if (!(await pageNode.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Expand first parent node to reveal nested pages
      const parentNode = page.locator('.tree-node-header[data-has-children="true"]').first();
      if (await parentNode.isVisible()) {
        await parentNode.locator('.tree-toggle').click();
        await page.waitForTimeout(300);
      }
      pageNode = page.locator('.tree-node-header[data-has-page="true"]:visible').first();
    }

    await pageNode.click();

    // Wait for content to load
    await page.waitForSelector('.wiki-meta', { timeout: 10000 });

    // The clicked node should have active class
    await expect(pageNode).toHaveClass(/active/);
  });
});
