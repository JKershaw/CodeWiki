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

    expect(repos.length, 'Test requires at least one repository').toBeGreaterThan(0);

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

    expect(repos.length, 'Test requires at least one repository').toBeGreaterThan(0);

    const response = await request.get(`/api/repos/${repos[0].id}/commits`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('POST /api/repos/:id/query requires question', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    expect(repos.length, 'Test requires at least one repository').toBeGreaterThan(0);

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
      expect(newRepos.length, 'Test requires at least one repository (failed to add one)').toBeGreaterThan(0);
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

    expect(repos.length, 'Test requires at least one repository').toBeGreaterThan(0);

    const response = await request.post(`/api/repos/${repos[0].id}/spec`, {
      data: {},
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Task');
  });

  // Work queue endpoint tests
  test('GET /api/repos/:id/work-queue returns work queue structure', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();

    if (repos.length === 0) {
      // Add a repo first
      await request.post('/api/repos', { data: { path: '.' } });
      const newReposResponse = await request.get('/api/repos');
      const newRepos = await newReposResponse.json();
      expect(newRepos.length, 'Test requires at least one repository (failed to add one)').toBeGreaterThan(0);
    }

    const updatedReposResponse = await request.get('/api/repos');
    const updatedRepos = await updatedReposResponse.json();

    const response = await request.get(`/api/repos/${updatedRepos[0].id}/work-queue`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.workQueue).toBeDefined();
    expect(data.workQueue.pending).toBeDefined();
    expect(data.workQueue.claimed).toBeDefined();
    expect(data.workQueue.completed).toBeDefined();
    expect(data.workQueue.failed).toBeDefined();
    expect(data.workQueue.counts).toBeDefined();
    expect(Array.isArray(data.workQueue.pending)).toBeTruthy();
    expect(Array.isArray(data.workQueue.claimed)).toBeTruthy();
    expect(Array.isArray(data.workQueue.completed)).toBeTruthy();
    expect(Array.isArray(data.workQueue.failed)).toBeTruthy();
    expect(typeof data.workQueue.counts.pending).toBe('number');
    expect(typeof data.workQueue.counts.claimed).toBe('number');
    expect(typeof data.workQueue.counts.completed).toBe('number');
    expect(typeof data.workQueue.counts.failed).toBe('number');
  });

  test('GET /api/repos/:id/work-queue returns 404 for unknown repo', async ({ request }) => {
    const response = await request.get('/api/repos/unknown-id-12345/work-queue');

    expect(response.status()).toBe(404);
  });

  test('GET /api/repos/:id/work-queue items have correct structure', async ({ request }) => {
    // First get a repo and trigger processing to generate work items
    const reposResponse = await request.get('/api/repos');
    let repos = await reposResponse.json();

    if (repos.length === 0) {
      await request.post('/api/repos', { data: { path: '.' } });
      const newReposResponse = await request.get('/api/repos');
      repos = await newReposResponse.json();
      expect(repos.length, 'Test requires at least one repository (failed to add one)').toBeGreaterThan(0);
    }

    const response = await request.get(`/api/repos/${repos[0].id}/work-queue`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // Check structure of work items if any exist
    const allItems = [
      ...data.workQueue.pending,
      ...data.workQueue.claimed,
      ...data.workQueue.completed,
      ...data.workQueue.failed,
    ];

    for (const item of allItems) {
      expect(item.id).toBeDefined();
      expect(item.agentType).toBeDefined();
      expect(item.status).toBeDefined();
      expect(item.createdAt).toBeDefined();
      // targetCommitId and targetPagePath can be null
      expect('targetCommitId' in item).toBeTruthy();
      expect('targetPagePath' in item).toBeTruthy();
    }
  });

  // Stop processing endpoint tests
  test('PATCH /api/repos/:id/processing/stop returns 404 for unknown repo', async ({ request }) => {
    const response = await request.patch('/api/repos/unknown-id-12345/processing/stop');

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not found');
  });

  test('PATCH /api/repos/:id/processing/stop returns 404 when not processing', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    let repos = await reposResponse.json();

    if (repos.length === 0) {
      await request.post('/api/repos', { data: { path: '.' } });
      const newReposResponse = await request.get('/api/repos');
      repos = await newReposResponse.json();
      expect(repos.length, 'Test requires at least one repository (failed to add one)').toBeGreaterThan(0);
    }

    const repoId = repos[0].id;

    // First, ensure no processing is currently running by stopping any active runs
    // This handles test isolation issues where other tests may have started processing
    let processingResponse = await request.get(`/api/repos/${repoId}/processing`);
    if (processingResponse.ok()) {
      const processingData = await processingResponse.json();
      if (processingData.processing?.status === 'running') {
        // Stop the running processing first
        await request.patch(`/api/repos/${repoId}/processing/stop`);
        // Wait for it to actually stop
        const maxWaitMs = 10000;
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
          await new Promise(resolve => setTimeout(resolve, 200));
          processingResponse = await request.get(`/api/repos/${repoId}/processing`);
          const data = await processingResponse.json();
          if (!data.processing || data.processing.status !== 'running') break;
        }
      }
    }

    // Now try to stop when no processing is active
    const response = await request.patch(`/api/repos/${repoId}/processing/stop`);

    // Should return 404 (no active processing) or 400 (not in running state)
    expect([404, 400]).toContain(response.status());
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('GET /api/repos/:id/processing returns processing status structure', async ({ request }) => {
    // First get a repo
    const reposResponse = await request.get('/api/repos');
    let repos = await reposResponse.json();

    if (repos.length === 0) {
      await request.post('/api/repos', { data: { path: '.' } });
      const newReposResponse = await request.get('/api/repos');
      repos = await newReposResponse.json();
      expect(repos.length, 'Test requires at least one repository (failed to add one)').toBeGreaterThan(0);
    }

    const response = await request.get(`/api/repos/${repos[0].id}/processing`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.processing).toBeDefined();
    // processing can be null if no active run, or an object with status
    if (data.processing) {
      expect(data.processing.status).toBeDefined();
      expect(['pending', 'running', 'stopping', 'stopped', 'completed', 'failed']).toContain(data.processing.status);
      expect(typeof data.processing.completedIterations).toBe('number');
      expect(typeof data.processing.totalIterations).toBe('number');
    }
  });
});
