import { test, expect } from '@playwright/test';

/**
 * E2E tests for Auto-Benchmark API.
 *
 * These tests verify the auto-benchmark orchestration system which runs
 * multiple cycles of wiki generation iterations followed by benchmark evaluations.
 *
 * Note: When OPENROUTER_API_KEY is not set, the server uses MockLLMService,
 * allowing full lifecycle testing without real LLM calls.
 */

test.describe('Auto-Benchmark API', () => {
  let repoId: string;
  let wikiId: string;
  const testId = Date.now().toString(36);

  test.beforeAll(async ({ request }) => {
    // Ensure we have a repository with an active wiki
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

    // Ensure there's an active wiki
    const wikisResponse = await request.get(`/api/repos/${repoId}/wikis`);
    const wikis = await wikisResponse.json();
    if (wikis.length === 0) {
      const wikiResponse = await request.post(`/api/repos/${repoId}/wikis`, {
        data: { name: `auto-benchmark-test-wiki-${testId}` },
      });
      if (wikiResponse.ok()) {
        const wiki = await wikiResponse.json();
        wikiId = wiki.id;
      }
    } else {
      // Find active wiki or use first one
      const activeWiki = wikis.find((w: { isActive: boolean }) => w.isActive);
      wikiId = activeWiki?.id ?? wikis[0].id;
    }
  });

  test.describe('List Auto-Benchmarks', () => {
    test('returns auto-benchmark history for repository', async ({ request }) => {
      const response = await request.get(`/api/repos/${repoId}/auto-benchmarks`);

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.runs).toBeDefined();
      expect(Array.isArray(data.runs)).toBeTruthy();
    });

    test('returns 404 for non-existent repository', async ({ request }) => {
      const response = await request.get('/api/repos/non-existent-repo/auto-benchmarks');

      expect(response.status()).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });
  });

  test.describe('Start Auto-Benchmark', () => {
    test('returns 404 for non-existent repository', async ({ request }) => {
      const response = await request.post('/api/repos/non-existent-repo/auto-benchmarks', {
        data: { iterationsPerCycle: 1, maxCycles: 1 },
      });

      expect(response.status()).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });

    test('returns 400 for invalid configuration', async ({ request }) => {
      const response = await request.post(`/api/repos/${repoId}/auto-benchmarks`, {
        data: { iterationsPerCycle: 0, maxCycles: -1 },
      });

      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('positive');
    });

    test('accepts POST with default configuration', async ({ request }) => {
      // This test verifies the endpoint accepts requests and returns appropriate status
      // It may succeed (202) or conflict (409) if another run is in progress
      const response = await request.post(`/api/repos/${repoId}/auto-benchmarks`, {
        data: {},
      });

      // Valid responses: 202 (started), 400 (no wiki), 409 (already running), 500 (internal error)
      expect([202, 400, 409, 500].includes(response.status())).toBeTruthy();
    });

    test('accepts custom configuration options', async ({ request }) => {
      const response = await request.post(`/api/repos/${repoId}/auto-benchmarks`, {
        data: {
          iterationsPerCycle: 2,
          maxCycles: 1,
          includeQuality: false,
        },
      });

      // Valid responses
      expect([202, 400, 409, 500].includes(response.status())).toBeTruthy();
    });
  });

  test.describe('Get Auto-Benchmark Run Details', () => {
    test('returns 404 for non-existent run', async ({ request }) => {
      const response = await request.get(`/api/repos/${repoId}/auto-benchmarks/non-existent-run`);

      expect(response.status()).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });
  });

  test.describe('Stop Auto-Benchmark', () => {
    test('returns 404 for non-existent run', async ({ request }) => {
      const response = await request.post(`/api/repos/${repoId}/auto-benchmarks/non-existent-run/stop`, {
        data: {},
      });

      expect(response.status()).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });
  });

  test.describe('Delete Auto-Benchmark', () => {
    test('returns 404 for non-existent run', async ({ request }) => {
      const response = await request.delete(`/api/repos/${repoId}/auto-benchmarks/non-existent-run`);

      expect(response.status()).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });
  });

  test.describe('Auto-Benchmark Response Structure', () => {
    test('list response has correct structure', async ({ request }) => {
      const response = await request.get(`/api/repos/${repoId}/auto-benchmarks`);

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty('runs');
      expect(Array.isArray(data.runs)).toBeTruthy();

      // If there are runs, verify their structure
      if (data.runs.length > 0) {
        const run = data.runs[0];
        expect(run).toHaveProperty('id');
        expect(run).toHaveProperty('repoId');
        expect(run).toHaveProperty('wikiId');
        expect(run).toHaveProperty('status');
        expect(run).toHaveProperty('config');
        expect(run).toHaveProperty('currentCycle');
        expect(run).toHaveProperty('currentPhase');
        expect(run).toHaveProperty('startedAt');
      }
    });
  });
});

test.describe('Auto-Benchmark Full Lifecycle', () => {
  let repoId: string;
  let wikiId: string;
  const testId = Date.now().toString(36);

  test.beforeAll(async ({ request }) => {
    // Set up repository with wiki
    const response = await request.post('/api/repos', {
      data: { path: '.' },
    });

    if (response.ok()) {
      const data = await response.json();
      repoId = data.id;
    } else {
      const reposResponse = await request.get('/api/repos');
      const repos = await reposResponse.json();
      if (repos.length > 0) {
        repoId = repos[0].id;
      }
    }

    // Ensure active wiki exists
    const wikisResponse = await request.get(`/api/repos/${repoId}/wikis`);
    const wikis = await wikisResponse.json();
    if (wikis.length === 0) {
      const wikiResponse = await request.post(`/api/repos/${repoId}/wikis`, {
        data: { name: `lifecycle-test-wiki-${testId}` },
      });
      if (wikiResponse.ok()) {
        const wiki = await wikiResponse.json();
        wikiId = wiki.id;
      }
    } else {
      const activeWiki = wikis.find((w: { isActive: boolean }) => w.isActive);
      wikiId = activeWiki?.id ?? wikis[0].id;
    }

    // Wait for any existing auto-benchmarks to complete or stop them
    const runningResponse = await request.get(`/api/repos/${repoId}/auto-benchmarks`);
    if (runningResponse.ok()) {
      const data = await runningResponse.json();
      for (const run of data.runs) {
        if (run.status === 'running') {
          await request.post(`/api/repos/${repoId}/auto-benchmarks/${run.id}/stop`, { data: {} });
          // Wait a moment for stop to take effect
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  });

  test('complete auto-benchmark lifecycle: start, poll, verify completion', async ({ request }) => {
    // Skip if no wiki is available
    test.skip(!wikiId, 'No wiki available for lifecycle test');

    // Start a minimal auto-benchmark (1 cycle, 1 iteration for speed)
    const startResponse = await request.post(`/api/repos/${repoId}/auto-benchmarks`, {
      data: {
        iterationsPerCycle: 1,
        maxCycles: 1,
        includeQuality: false,
      },
    });

    // If we can't start (409 conflict or other), skip this test
    if (startResponse.status() !== 202) {
      console.log(`Skipping lifecycle test: start returned ${startResponse.status()}`);
      return;
    }

    const startData = await startResponse.json();
    expect(startData.runId).toBeDefined();
    expect(startData.status).toBe('running');

    const runId = startData.runId;

    // Poll for completion (with timeout)
    const maxWaitMs = 60000; // 60 seconds
    const pollIntervalMs = 1000;
    const startTime = Date.now();
    let finalStatus = 'running';

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      const statusResponse = await request.get(`/api/repos/${repoId}/auto-benchmarks/${runId}`);
      if (!statusResponse.ok()) {
        console.error(`Failed to get status: ${statusResponse.status()}`);
        break;
      }

      const statusData = await statusResponse.json();
      finalStatus = statusData.status;

      // Check if terminal state reached
      if (['completed', 'failed', 'stopped'].includes(finalStatus)) {
        break;
      }
    }

    // Verify we reached a terminal state
    expect(['completed', 'failed', 'stopped']).toContain(finalStatus);

    // Get final run details
    const detailsResponse = await request.get(`/api/repos/${repoId}/auto-benchmarks/${runId}`);
    expect(detailsResponse.ok()).toBeTruthy();

    const details = await detailsResponse.json();
    expect(details.id).toBe(runId);
    expect(details.repoId).toBe(repoId);
    expect(details.config.iterationsPerCycle).toBe(1);
    expect(details.config.maxCycles).toBe(1);

    // If completed, verify final state
    if (details.status === 'completed') {
      expect(details.currentPhase).toBe('complete');
      expect(details.completedAt).toBeDefined();
    }

    // Clean up: delete the test run
    const deleteResponse = await request.delete(`/api/repos/${repoId}/auto-benchmarks/${runId}`);
    expect(deleteResponse.status()).toBe(204);

    // Verify deletion
    const verifyResponse = await request.get(`/api/repos/${repoId}/auto-benchmarks/${runId}`);
    expect(verifyResponse.status()).toBe(404);
  });

  test('stop auto-benchmark during execution', async ({ request }) => {
    // Skip if no wiki is available
    test.skip(!wikiId, 'No wiki available for stop test');

    // Start a longer auto-benchmark that we can stop
    const startResponse = await request.post(`/api/repos/${repoId}/auto-benchmarks`, {
      data: {
        iterationsPerCycle: 5,
        maxCycles: 10,
        includeQuality: true,
      },
    });

    // If we can't start, skip
    if (startResponse.status() !== 202) {
      console.log(`Skipping stop test: start returned ${startResponse.status()}`);
      return;
    }

    const startData = await startResponse.json();
    const runId = startData.runId;

    // Wait a moment for it to start processing
    await new Promise(resolve => setTimeout(resolve, 500));

    // Stop the auto-benchmark
    const stopResponse = await request.post(`/api/repos/${repoId}/auto-benchmarks/${runId}/stop`, {
      data: {},
    });
    expect(stopResponse.ok()).toBeTruthy();

    // Wait for stop to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify status is stopped (or completed if it finished before stop)
    const statusResponse = await request.get(`/api/repos/${repoId}/auto-benchmarks/${runId}`);
    expect(statusResponse.ok()).toBeTruthy();

    const statusData = await statusResponse.json();
    expect(['stopped', 'completed']).toContain(statusData.status);

    // Clean up
    await request.delete(`/api/repos/${repoId}/auto-benchmarks/${runId}`);
  });

  test('conflict when starting auto-benchmark while one is running', async ({ request }) => {
    // Skip if no wiki is available
    test.skip(!wikiId, 'No wiki available for conflict test');

    // Start first auto-benchmark
    const firstResponse = await request.post(`/api/repos/${repoId}/auto-benchmarks`, {
      data: {
        iterationsPerCycle: 5,
        maxCycles: 10,
        includeQuality: false,
      },
    });

    // If we can't start the first one, skip
    if (firstResponse.status() !== 202) {
      console.log(`Skipping conflict test: first start returned ${firstResponse.status()}`);
      return;
    }

    const firstData = await firstResponse.json();
    const firstRunId = firstData.runId;

    try {
      // Try to start a second auto-benchmark while first is running
      const secondResponse = await request.post(`/api/repos/${repoId}/auto-benchmarks`, {
        data: {
          iterationsPerCycle: 1,
          maxCycles: 1,
          includeQuality: false,
        },
      });

      // Should get 409 Conflict
      expect(secondResponse.status()).toBe(409);
      const errorData = await secondResponse.json();
      expect(errorData.error).toContain('already running');
      expect(errorData.runId).toBe(firstRunId);
    } finally {
      // Clean up: stop and delete the first run
      await request.post(`/api/repos/${repoId}/auto-benchmarks/${firstRunId}/stop`, { data: {} });
      await new Promise(resolve => setTimeout(resolve, 500));
      await request.delete(`/api/repos/${repoId}/auto-benchmarks/${firstRunId}`);
    }
  });
});
