import { test, expect } from '@playwright/test';

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
});
