import { test, expect } from '@playwright/test';

/**
 * E2E tests for Wiki Management API - Happy Paths.
 *
 * These tests cover the full user journey for managing multiple wikis per repository.
 */

test.describe('Wiki Management API', () => {
  let repoId: string;
  // Use unique suffix to avoid conflicts between test runs
  const testId = Date.now().toString(36);

  test.beforeAll(async ({ request }) => {
    // Ensure we have a repository to work with
    const response = await request.post('/api/repos', {
      data: { path: '.' },
    });

    if (response.ok()) {
      const data = await response.json();
      repoId = data.id;
    } else {
      // Repo might already exist, get it
      const reposResponse = await request.get('/api/repos');
      const repos = await reposResponse.json();
      if (repos.length > 0) {
        repoId = repos[0].id;
      }
    }
  });

  test('list wikis for a repository', async ({ request }) => {
    const response = await request.get(`/api/repos/${repoId}/wikis`);

    expect(response.ok()).toBeTruthy();
    const wikis = await response.json();
    expect(Array.isArray(wikis)).toBeTruthy();
  });

  test('create a new wiki with basic info', async ({ request }) => {
    const wikiName = `test-wiki-basic-${testId}`;
    const response = await request.post(`/api/repos/${repoId}/wikis`, {
      data: {
        name: wikiName,
        description: 'A test wiki for e2e tests',
      },
    });

    expect(response.status()).toBe(201);
    const wiki = await response.json();
    expect(wiki.name).toBe(wikiName);
    expect(wiki.description).toBe('A test wiki for e2e tests');
    expect(wiki.repoId).toBe(repoId);
    expect(wiki.slug).toBe(wikiName);
  });

  test('create a wiki with branch filter', async ({ request }) => {
    const wikiName = `feature-branch-wiki-${testId}`;
    const response = await request.post(`/api/repos/${repoId}/wikis`, {
      data: {
        name: wikiName,
        branchFilter: 'feature/*',
      },
    });

    expect(response.status()).toBe(201);
    const wiki = await response.json();
    expect(wiki.branchFilter).toBe('feature/*');
  });

  test('create a wiki with path filters', async ({ request }) => {
    const wikiName = `api-docs-wiki-${testId}`;
    const response = await request.post(`/api/repos/${repoId}/wikis`, {
      data: {
        name: wikiName,
        pathFilters: ['src/api/**', 'docs/api/**'],
      },
    });

    expect(response.status()).toBe(201);
    const wiki = await response.json();
    expect(wiki.pathFilters).toEqual(['src/api/**', 'docs/api/**']);
  });

  test('get wiki details with stats', async ({ request }) => {
    // First create a wiki
    const wikiName = `wiki-with-stats-${testId}`;
    const createResponse = await request.post(`/api/repos/${repoId}/wikis`, {
      data: { name: wikiName },
    });
    const wiki = await createResponse.json();

    // Get details
    const response = await request.get(`/api/repos/${repoId}/wikis/${wiki.id}`);

    expect(response.ok()).toBeTruthy();
    const details = await response.json();
    expect(details.id).toBe(wiki.id);
    expect(details.stats).toBeDefined();
    expect(details.stats.pageCount).toBeDefined();
    expect(details.stats.avgConfidence).toBeDefined();
  });

  test('update wiki settings', async ({ request }) => {
    // Create a wiki
    const wikiName = `wiki-to-update-${testId}`;
    const createResponse = await request.post(`/api/repos/${repoId}/wikis`, {
      data: { name: wikiName },
    });
    const wiki = await createResponse.json();

    // Update it
    const updatedName = `updated-wiki-name-${testId}`;
    const response = await request.put(`/api/repos/${repoId}/wikis/${wiki.id}`, {
      data: {
        name: updatedName,
        description: 'Updated description',
        branchFilter: 'main',
      },
    });

    expect(response.ok()).toBeTruthy();
    const updated = await response.json();
    expect(updated.name).toBe(updatedName);
    expect(updated.description).toBe('Updated description');
    expect(updated.branchFilter).toBe('main');
  });

  test('activate a different wiki', async ({ request }) => {
    // Create an active wiki first by getting the active one
    const wikisResponse = await request.get(`/api/repos/${repoId}/wikis`);
    const wikis = await wikisResponse.json();

    // Create a new non-active wiki
    const wikiName = `wiki-to-activate-${testId}`;
    const createResponse = await request.post(`/api/repos/${repoId}/wikis`, {
      data: {
        name: wikiName,
        setActive: false,
      },
    });
    expect(createResponse.status()).toBe(201);
    const newWiki = await createResponse.json();
    expect(newWiki.isActive).toBe(false);

    // Activate it
    const activateResponse = await request.post(`/api/repos/${repoId}/wikis/${newWiki.id}/activate`);

    expect(activateResponse.ok()).toBeTruthy();
    const activated = await activateResponse.json();
    expect(activated.isActive).toBe(true);
  });

  test('delete a non-active wiki', async ({ request }) => {
    // Ensure we have an active wiki
    const wikisResponse = await request.get(`/api/repos/${repoId}/wikis`);
    const wikis = await wikisResponse.json();

    // Make sure there's an active one (if not, create one)
    const activeWiki = wikis.find((w: any) => w.isActive);
    if (!activeWiki) {
      await request.post(`/api/repos/${repoId}/wikis`, {
        data: { name: `active-wiki-for-delete-test-${testId}`, setActive: true },
      });
    }

    // Create a non-active wiki to delete
    const wikiName = `wiki-to-delete-${testId}`;
    const createResponse = await request.post(`/api/repos/${repoId}/wikis`, {
      data: {
        name: wikiName,
        setActive: false,
      },
    });
    const wikiToDelete = await createResponse.json();

    // Delete it
    const deleteResponse = await request.delete(`/api/repos/${repoId}/wikis/${wikiToDelete.id}`);

    expect(deleteResponse.status()).toBe(204);

    // Verify it's gone
    const verifyResponse = await request.get(`/api/repos/${repoId}/wikis/${wikiToDelete.id}`);
    expect(verifyResponse.status()).toBe(404);
  });

  test('cannot delete active wiki', async ({ request }) => {
    // Find or create an active wiki
    const wikisResponse = await request.get(`/api/repos/${repoId}/wikis`);
    const wikis = await wikisResponse.json();

    let activeWiki = wikis.find((w: any) => w.isActive);
    if (!activeWiki) {
      const createResponse = await request.post(`/api/repos/${repoId}/wikis`, {
        data: { name: `active-wiki-nodelete-${testId}`, setActive: true },
      });
      activeWiki = await createResponse.json();
    }

    // Try to delete active wiki
    const deleteResponse = await request.delete(`/api/repos/${repoId}/wikis/${activeWiki.id}`);

    expect(deleteResponse.status()).toBe(400);
    const error = await deleteResponse.json();
    expect(error.error).toContain('active');
  });

  test('repos endpoint includes active wiki info', async ({ request }) => {
    const response = await request.get('/api/repos');

    expect(response.ok()).toBeTruthy();
    const repos = await response.json();

    // Find our test repo
    const repo = repos.find((r: any) => r.id === repoId);
    if (repo) {
      expect(repo.activeWiki).toBeDefined();
      expect(repo.activeWiki.id).toBeDefined();
      expect(repo.activeWiki.name).toBeDefined();
      expect(repo.wikiCount).toBeGreaterThanOrEqual(1);
    }
  });

  test('single repo endpoint includes active wiki info', async ({ request }) => {
    const response = await request.get(`/api/repos/${repoId}`);

    expect(response.ok()).toBeTruthy();
    const repo = await response.json();

    expect(repo.activeWiki).toBeDefined();
    expect(repo.activeWiki.id).toBeDefined();
    expect(repo.activeWiki.name).toBeDefined();
    expect(repo.wikiCount).toBeGreaterThanOrEqual(1);
  });

  test('cannot create wiki without name', async ({ request }) => {
    const response = await request.post(`/api/repos/${repoId}/wikis`, {
      data: { description: 'No name provided' },
    });

    expect(response.status()).toBe(400);
    const error = await response.json();
    expect(error.error).toContain('name');
  });

  test('cannot create wiki with duplicate slug', async ({ request }) => {
    const wikiName = `duplicate-test-${testId}`;
    // Create first wiki
    await request.post(`/api/repos/${repoId}/wikis`, {
      data: { name: wikiName },
    });

    // Try to create second with same name
    const response = await request.post(`/api/repos/${repoId}/wikis`, {
      data: { name: wikiName },
    });

    expect(response.status()).toBe(400);
    const error = await response.json();
    expect(error.error).toContain('already exists');
  });
});
