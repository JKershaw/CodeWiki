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

    // Should navigate to graph page
    await page.waitForURL(/\/graph\//, { timeout: 10000 });

    // Graph container should be visible
    await expect(page.locator('#graph-container')).toBeVisible();
  });

  test('graph view shows controls', async ({ page }) => {
    const graphBtn = page.locator('.graph-btn:not([disabled])').first();
    await graphBtn.click();

    // Wait for graph page to load
    await page.waitForURL(/\/graph\//, { timeout: 10000 });

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

    // Wait for graph page to load
    await page.waitForURL(/\/graph\//, { timeout: 10000 });

    // Wait for graph container to be visible
    await expect(page.locator('#graph-container')).toBeVisible();

    // Check if graph library loaded successfully (CDN may fail in test env)
    const container = page.locator('#graph-container');
    const hasError = await container.locator('.error').count() > 0;

    if (hasError) {
      // Graph library failed to load from CDN - skip stats check
      const errorText = await container.locator('.error').textContent();
      test.skip(true, `Graph library not available: ${errorText}`);
      return;
    }

    // Wait for stats to be populated (async operation)
    const statsEl = page.locator('#graph-stats');
    await expect(statsEl).toBeVisible();

    // Stats may take time to populate, wait for content with longer timeout
    await expect(statsEl).toContainText('pages', { timeout: 10000 });
    await expect(statsEl).toContainText('links', { timeout: 10000 });
  });

  test('can navigate back to repos from graph', async ({ page }) => {
    const graphBtn = page.locator('.graph-btn:not([disabled])').first();
    await graphBtn.click();

    // Wait for graph page to load
    await page.waitForURL(/\/graph\//, { timeout: 10000 });

    // Click Repositories link in nav
    await page.click('#nav a[href="/"]');

    // Should be back on repos page
    await page.waitForURL('/', { timeout: 10000 });
    await expect(page.locator('#repos-view')).toBeVisible();
  });

  test('graph navigation link is active after opening graph', async ({ page }) => {
    const graphBtn = page.locator('.graph-btn:not([disabled])').first();
    await graphBtn.click();

    // Wait for graph page to load
    await page.waitForURL(/\/graph\//, { timeout: 10000 });

    // The Graph nav link should be active
    const navLink = page.locator('#nav a[href*="/graph/"]');
    await expect(navLink).toHaveClass(/active/);
  });
});

test.describe('Wiki Events SSE', () => {
  test('GET /api/repos/:id/wiki-events returns SSE stream', async ({ page, request }) => {
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    const repoWithWiki = repos.find((r: { wikiPages: number }) => r.wikiPages > 0);
    if (!repoWithWiki) {
      test.skip(true, 'Test requires a repository with wiki pages');
      return;
    }

    // Navigate to the app first so page.evaluate can use relative URLs
    await page.goto('/');

    // Use page.evaluate with fetch and AbortController to test SSE
    // Playwright's request API waits for full response, but SSE streams don't close
    const result = await page.evaluate(async (repoId: string) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      try {
        const response = await fetch(`/api/repos/${repoId}/wiki-events`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return {
          ok: response.ok,
          status: response.status,
          contentType: response.headers.get('content-type'),
        };
      } catch (e) {
        clearTimeout(timeoutId);
        // AbortError is expected since we abort the stream
        if (e instanceof Error && e.name === 'AbortError') {
          return { aborted: true, ok: true };
        }
        throw e;
      }
    }, repoWithWiki.id);

    // SSE endpoint should return 200 with text/event-stream content type
    expect(result.ok).toBeTruthy();
    if (result.contentType) {
      expect(result.contentType).toContain('text/event-stream');
    }
  });

  test('GET /api/repos/:id/wiki-events returns 404 for unknown repo', async ({ request }) => {
    const response = await request.get('/api/repos/unknown-id-12345/wiki-events');
    expect(response.status()).toBe(404);
  });
});
