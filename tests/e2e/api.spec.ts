import { test, expect } from '@playwright/test';
import { homedir } from 'os';

/**
 * API endpoint tests.
 */

test.describe('API Endpoints', () => {
  test('GET /api/repos returns array', async ({ request }) => {
    const response = await request.get('/api/repos');

    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('application/json');

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('POST /api/repos requires path', async ({ request }) => {
    const response = await request.post('/api/repos', {
      data: {},
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('path');
  });

  test('POST /api/repos can add a repository', async ({ request }) => {
    const response = await request.post('/api/repos', {
      data: { path: '.' },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.id).toBeDefined();
    expect(data.fullName).toBeDefined();
  });

  test('GET /api/repos/:id returns 404 for unknown repo', async ({ request }) => {
    const response = await request.get('/api/repos/unknown-id-12345');

    expect(response.status()).toBe(404);
  });

  test('GET /api/repos/:id/wiki returns wiki pages', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    if (repos.length === 0) {
      test.skip();
      return;
    }

    const response = await request.get(`/api/repos/${repos[0].id}/wiki`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.pages).toBeDefined();
    expect(data.grouped).toBeDefined();
  });

  test('GET /api/repos/:id/commits returns commits', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    if (repos.length === 0) {
      test.skip();
      return;
    }

    const response = await request.get(`/api/repos/${repos[0].id}/commits`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('POST /api/repos/:id/query requires question', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    if (repos.length === 0) {
      test.skip();
      return;
    }

    const response = await request.post(`/api/repos/${repos[0].id}/query`, {
      data: {},
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Question');
  });

  test('POST /api/repos/:id/process starts processing', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    if (repos.length === 0) {
      // Add a repo first
      await request.post('/api/repos', { data: { path: '.' } });
      const newReposResponse = await request.get('/api/repos');
      const newRepos = await newReposResponse.json();
      if (newRepos.length === 0) {
        test.skip();
        return;
      }
    }

    const updatedReposResponse = await request.get('/api/repos');
    const updatedRepos = await updatedReposResponse.json();

    const response = await request.post(`/api/repos/${updatedRepos[0].id}/process`, {
      data: { iterations: 1 },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.message).toContain('started');
  });

  // Filesystem browse endpoint tests
  test('GET /api/filesystem/browse returns directories', async ({ request }) => {
    const response = await request.get('/api/filesystem/browse');

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.currentPath).toBeDefined();
    expect(data.directories).toBeDefined();
    expect(Array.isArray(data.directories)).toBeTruthy();
  });

  test('GET /api/filesystem/browse with path navigates to subdirectory', async ({ request }) => {
    const home = homedir();
    const response = await request.get(`/api/filesystem/browse?path=${encodeURIComponent(home)}`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.currentPath).toBe(home);
    // At home directory, parent should be null
    expect(data.parent).toBeNull();
  });

  test('GET /api/filesystem/browse blocks access outside home directory', async ({ request }) => {
    const response = await request.get('/api/filesystem/browse?path=/etc');

    expect(response.status()).toBe(403);
    const data = await response.json();
    expect(data.error).toContain('Access denied');
  });

  test('GET /api/filesystem/browse blocks path traversal attacks', async ({ request }) => {
    const home = homedir();
    const response = await request.get(`/api/filesystem/browse?path=${encodeURIComponent(home + '/../../../etc')}`);

    expect(response.status()).toBe(403);
  });

  test('GET /api/filesystem/browse returns 400 for non-directory path', async ({ request }) => {
    const home = homedir();
    // Try to browse a file that likely exists
    const response = await request.get(`/api/filesystem/browse?path=${encodeURIComponent(home + '/.bashrc')}`);

    // Either 400 (not a directory) or 500 (file not found) is acceptable
    expect([400, 500]).toContain(response.status());
  });

  test('GET /api/filesystem/browse includes isGitRepo flag', async ({ request }) => {
    const response = await request.get('/api/filesystem/browse');

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Each directory should have isGitRepo property
    for (const dir of data.directories) {
      expect(dir.name).toBeDefined();
      expect(dir.path).toBeDefined();
      expect(typeof dir.isGitRepo).toBe('boolean');
    }
  });

  test('POST /api/repos/:id/spec requires task', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    if (repos.length === 0) {
      test.skip();
      return;
    }

    const response = await request.post(`/api/repos/${repos[0].id}/spec`, {
      data: {},
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Task');
  });
});
