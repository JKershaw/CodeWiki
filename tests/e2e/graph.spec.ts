import { test, expect } from '@playwright/test';

/**
 * E2E tests for wiki graph visualization.
 */

test.describe('Wiki Graph API', () => {
  test('GET /api/repos/:id/wiki-graph returns graph structure', async ({ request }) => {
    // First get a repo with wiki pages
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    if (!repoWithWiki) {
      test.skip(true, 'Test requires a repository with wiki pages');
      return;
    }

    const response = await request.get(`/api/repos/${repoWithWiki.id}/wiki-graph`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // Should have nodes, edges, and stats
    expect(data.nodes).toBeDefined();
    expect(data.edges).toBeDefined();
    expect(data.stats).toBeDefined();

    expect(Array.isArray(data.nodes)).toBeTruthy();
    expect(Array.isArray(data.edges)).toBeTruthy();

    // Stats should have expected properties
    expect(typeof data.stats.nodeCount).toBe('number');
    expect(typeof data.stats.edgeCount).toBe('number');
    expect(typeof data.stats.avgLinks).toBe('number');
    expect(Array.isArray(data.stats.categories)).toBeTruthy();
  });

  test('GET /api/repos/:id/wiki-graph nodes have correct structure', async ({ request }) => {
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    if (!repoWithWiki) {
      test.skip(true, 'Test requires a repository with wiki pages');
      return;
    }

    const response = await request.get(`/api/repos/${repoWithWiki.id}/wiki-graph`);
    const data = await response.json();

    // Check node structure if any nodes exist
    if (data.nodes.length > 0) {
      const node = data.nodes[0];
      expect(node.id).toBeDefined();
      expect(node.path).toBeDefined();
      expect(node.title).toBeDefined();
      expect(typeof node.confidence).toBe('number');
      expect(typeof node.linkCount).toBe('number');
      expect(typeof node.backlinkCount).toBe('number');
      expect(node.updatedAt).toBeDefined();
    }
  });

  test('GET /api/repos/:id/wiki-graph edges have correct structure', async ({ request }) => {
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    if (!repoWithWiki) {
      test.skip(true, 'Test requires a repository with wiki pages');
      return;
    }

    const response = await request.get(`/api/repos/${repoWithWiki.id}/wiki-graph`);
    const data = await response.json();

    // Check edge structure if any edges exist
    if (data.edges.length > 0) {
      const edge = data.edges[0];
      expect(edge.id).toBeDefined();
      expect(edge.source).toBeDefined();
      expect(edge.target).toBeDefined();
    }
  });

  test('GET /api/repos/:id/wiki-graph returns 404 for unknown repo', async ({ request }) => {
    const response = await request.get('/api/repos/unknown-id-12345/wiki-graph');
    expect(response.status()).toBe(404);
  });

  test('GET /api/repos/:id/wiki-graph supports category filter', async ({ request }) => {
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    if (!repoWithWiki) {
      test.skip(true, 'Test requires a repository with wiki pages');
      return;
    }

    // Get graph with a category filter (even if no matching nodes, should return valid response)
    const response = await request.get(`/api/repos/${repoWithWiki.id}/wiki-graph?category=test-category`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.nodes).toBeDefined();
    expect(data.edges).toBeDefined();
    expect(data.stats).toBeDefined();
  });

  test('GET /api/repos/:id/wiki-graph supports minConfidence filter', async ({ request }) => {
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    if (!repoWithWiki) {
      test.skip(true, 'Test requires a repository with wiki pages');
      return;
    }

    // Get graph with high confidence filter
    const response = await request.get(`/api/repos/${repoWithWiki.id}/wiki-graph?minConfidence=0.9`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // All nodes should have confidence >= 0.9
    for (const node of data.nodes) {
      expect(node.confidence).toBeGreaterThanOrEqual(0.9);
    }
  });
});

test.describe('Wiki Graph UI', () => {
  test.beforeEach(async ({ page, request }) => {
    // Ensure we have a repo with wiki pages
    const response = await request.get('/api/repos');
    const repos = await response.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    expect(repoWithWiki, 'Test requires a repository with wiki pages (wikiPages > 0)').toBeTruthy();

    await page.goto('/');
    await page.waitForSelector('.card', { timeout: 10000 });
  });

  test('can open graph view from repository card', async ({ page }) => {
    // Find a repo with wiki pages and click Graph button
    const graphBtn = page.locator('.graph-btn:not([disabled])').first();
    await graphBtn.click();

    // Graph view should be visible
    await expect(page.locator('#graph-view')).toHaveClass(/active/);
    await expect(page.locator('#graph-container')).toBeVisible();
  });

  test('graph view shows controls', async ({ page }) => {
    const graphBtn = page.locator('.graph-btn:not([disabled])').first();
    await graphBtn.click();

    // Controls should be visible
    await expect(page.locator('#graph-search')).toBeVisible();
    await expect(page.locator('#graph-category-filter')).toBeVisible();
    await expect(page.locator('#graph-center-btn')).toBeVisible();
    await expect(page.locator('#graph-layout-btn')).toBeVisible();
    await expect(page.locator('#graph-refresh-btn')).toBeVisible();
  });

  test('graph view shows stats', async ({ page }) => {
    const graphBtn = page.locator('.graph-btn:not([disabled])').first();
    await graphBtn.click();

    // Wait for graph to load
    await page.waitForTimeout(2000);

    // Stats should be visible (if there are pages)
    const statsEl = page.locator('#graph-stats');
    await expect(statsEl).toBeVisible();
    await expect(statsEl).toContainText('pages');
    await expect(statsEl).toContainText('links');
  });

  test('can navigate back to repos from graph', async ({ page }) => {
    const graphBtn = page.locator('.graph-btn:not([disabled])').first();
    await graphBtn.click();

    await expect(page.locator('#graph-view')).toHaveClass(/active/);

    // Click back button
    await page.click('#back-to-repos-graph');

    // Should be back on repos view
    await expect(page.locator('#repos-view')).toHaveClass(/active/);
  });

  test('graph navigation button is enabled after opening graph', async ({ page }) => {
    const graphBtn = page.locator('.graph-btn:not([disabled])').first();
    await graphBtn.click();

    // The Graph nav button should be enabled
    const navBtn = page.locator('[data-view="graph"]');
    await expect(navBtn).not.toBeDisabled();
  });
});

test.describe('Wiki Events SSE', () => {
  test('GET /api/repos/:id/wiki-events returns SSE stream', async ({ request }) => {
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    if (!repoWithWiki) {
      test.skip(true, 'Test requires a repository with wiki pages');
      return;
    }

    // Note: Playwright's request API doesn't directly support streaming
    // We just verify the endpoint exists and returns correct content type
    const response = await request.get(`/api/repos/${repoWithWiki.id}/wiki-events`);

    // SSE endpoint should return 200 with text/event-stream content type
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/event-stream');
  });

  test('GET /api/repos/:id/wiki-events returns 404 for unknown repo', async ({ request }) => {
    const response = await request.get('/api/repos/unknown-id-12345/wiki-events');
    expect(response.status()).toBe(404);
  });
});
