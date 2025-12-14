import { test, expect } from '@playwright/test';

/**
 * E2E tests for Self-Improvement Chat functionality.
 *
 * These tests verify:
 * 1. Chat API endpoints work correctly
 * 2. Chat UI elements exist in the DOM
 * 3. Core JavaScript functions are present
 */

test.describe('Self-Improvement Chat API', () => {
  let repoId: string;
  let wikiId: string;
  const testId = Date.now().toString(36);

  test.beforeAll(async ({ request }) => {
    // Set up repository
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

    // Ensure there's a wiki
    const wikisResponse = await request.get(`/api/repos/${repoId}/wikis`);
    const wikis = await wikisResponse.json();
    if (wikis.length > 0) {
      wikiId = wikis[0].id;
    } else {
      const wikiResponse = await request.post(`/api/repos/${repoId}/wikis`, {
        data: { name: `chat-test-wiki-${testId}` },
      });
      if (wikiResponse.ok()) {
        const wiki = await wikiResponse.json();
        wikiId = wiki.id;
      }
    }
  });

  test('list self-improvement analyses', async ({ request }) => {
    const response = await request.get(`/api/repos/${repoId}/self-improvements`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.analyses).toBeDefined();
    expect(Array.isArray(data.analyses)).toBeTruthy();
  });

  test('returns 404 for non-existent self-improvement run', async ({ request }) => {
    const response = await request.get(`/api/repos/${repoId}/self-improvements/non-existent-run`);

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not found');
  });

  test('cannot create chat session for non-existent run', async ({ request }) => {
    const response = await request.post(`/api/repos/${repoId}/self-improvements/non-existent-run/chat`, {
      data: {},
    });

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not found');
  });

  test('cannot send message to non-existent chat session', async ({ request }) => {
    const response = await request.post(
      `/api/repos/${repoId}/self-improvements/any-run/chat/non-existent-session/messages`,
      {
        data: { message: 'Hello' },
      }
    );

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not found');
  });

  test('message endpoint requires message field', async ({ request }) => {
    const response = await request.post(
      `/api/repos/${repoId}/self-improvements/any-run/chat/any-session/messages`,
      {
        data: {},
      }
    );

    // Should be 400 for missing message or 404 for session not found
    expect([400, 404].includes(response.status())).toBeTruthy();
  });

  test('cannot close non-existent chat session', async ({ request }) => {
    const response = await request.post(
      `/api/repos/${repoId}/self-improvements/any-run/chat/non-existent-session/close`,
      {
        data: {},
      }
    );

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toContain('not found');
  });

  test('start self-improvement requires at least 2 benchmark runs', async ({ request }) => {
    const response = await request.post(`/api/repos/${repoId}/self-improvements`, {
      data: { benchmarkRunIds: ['single-id'] },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('At least 2');
  });

  test('start self-improvement requires benchmark IDs array', async ({ request }) => {
    const response = await request.post(`/api/repos/${repoId}/self-improvements`, {
      data: {},
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('At least 2');
  });
});

test.describe('Self-Improvement Chat UI', () => {
  let repoId: string;

  test.beforeAll(async ({ request }) => {
    // Get a repo ID to navigate to benchmark page
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();
    if (repos.length > 0) {
      repoId = repos[0].id;
    }
  });

  test('chat section HTML structure exists', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    // Chat section should exist in the DOM
    await expect(page.locator('#chat-section')).toBeAttached();
    await expect(page.locator('#chat-messages')).toBeAttached();
    await expect(page.locator('#chat-input')).toBeAttached();
    await expect(page.locator('#send-chat-btn')).toBeAttached();
    await expect(page.locator('#chat-status')).toBeAttached();
    await expect(page.locator('#chat-cost')).toBeAttached();
  });

  test('chat input starts disabled', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    // Check via evaluate since element is in hidden container
    const inputDisabled = await page.evaluate(() => {
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;
      return input?.disabled;
    });
    expect(inputDisabled).toBeTruthy();

    const btnDisabled = await page.evaluate(() => {
      const btn = document.getElementById('send-chat-btn') as HTMLButtonElement;
      return btn?.disabled;
    });
    expect(btnDisabled).toBeTruthy();
  });

  test('chat section is inside self-improvement report', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const chatSection = page.locator('#self-improvement-report #chat-section');
    await expect(chatSection).toBeAttached();
  });

  test('self-improvement report is hidden by default', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const report = page.locator('#self-improvement-report');
    await expect(report).toHaveClass(/hidden/);
  });

  test('chat welcome message is present', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const welcomeMessage = page.locator('.chat-welcome');
    await expect(welcomeMessage).toBeAttached();
  });

  test('chat elements have expected CSS classes', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const hasChatSection = await page.evaluate(() => {
      const el = document.getElementById('chat-section');
      return el?.classList.contains('chat-section');
    });
    expect(hasChatSection).toBeTruthy();

    const hasChatMessages = await page.evaluate(() => {
      const el = document.getElementById('chat-messages');
      return el?.classList.contains('chat-messages');
    });
    expect(hasChatMessages).toBeTruthy();
  });

  test('chat input area contains textarea and button', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const hasTextarea = await page.evaluate(() => {
      const inputArea = document.querySelector('.chat-input-area');
      return inputArea?.querySelector('textarea#chat-input') !== null;
    });
    expect(hasTextarea).toBeTruthy();

    const hasButton = await page.evaluate(() => {
      const inputArea = document.querySelector('.chat-input-area');
      return inputArea?.querySelector('button#send-chat-btn') !== null;
    });
    expect(hasButton).toBeTruthy();
  });
});

test.describe('Chat JavaScript Functions', () => {
  let repoId: string;

  test.beforeAll(async ({ request }) => {
    // Get a repo ID to navigate to benchmark page
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();
    if (repos.length > 0) {
      repoId = repos[0].id;
    }
  });

  test('initChatSession function exists', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const fnExists = await page.evaluate(() =>
      typeof (window as unknown as { initChatSession?: () => void }).initChatSession === 'function'
    );
    expect(fnExists).toBeTruthy();
  });

  test('sendChatMessage function exists', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const fnExists = await page.evaluate(() =>
      typeof (window as unknown as { sendChatMessage?: () => void }).sendChatMessage === 'function'
    );
    expect(fnExists).toBeTruthy();
  });

  test('appendChatMessage function exists', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const fnExists = await page.evaluate(() =>
      typeof (window as unknown as { appendChatMessage?: () => void }).appendChatMessage === 'function'
    );
    expect(fnExists).toBeTruthy();
  });

  test('closeChatSession function exists', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const fnExists = await page.evaluate(() =>
      typeof (window as unknown as { closeChatSession?: () => void }).closeChatSession === 'function'
    );
    expect(fnExists).toBeTruthy();
  });

  test('showTypingIndicator function exists', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const fnExists = await page.evaluate(() =>
      typeof (window as unknown as { showTypingIndicator?: () => void }).showTypingIndicator === 'function'
    );
    expect(fnExists).toBeTruthy();
  });

  test('hideTypingIndicator function exists', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const fnExists = await page.evaluate(() =>
      typeof (window as unknown as { hideTypingIndicator?: () => void }).hideTypingIndicator === 'function'
    );
    expect(fnExists).toBeTruthy();
  });

  test('truncateText function works correctly', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const result = await page.evaluate(() => {
      const truncate = (window as unknown as { truncateText: (text: string, max: number) => string }).truncateText;
      if (!truncate) return null;
      return {
        short: truncate('Hello', 10),
        exact: truncate('1234567890', 10),
        long: truncate('12345678901234567890', 10),
      };
    });

    expect(result).toBeTruthy();
    expect(result!.short).toBe('Hello');
    expect(result!.exact).toBe('1234567890');
    expect(result!.long).toBe('1234567890... (truncated)');
  });

  test('Enter key triggers send behavior', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const sendAttempted = await page.evaluate(() => {
      (window as unknown as { _sendAttempted: boolean })._sendAttempted = false;
      const originalSend = (window as unknown as { sendChatMessage: () => void }).sendChatMessage;
      (window as unknown as { sendChatMessage: () => void }).sendChatMessage = function() {
        (window as unknown as { _sendAttempted: boolean })._sendAttempted = true;
      };

      (window as unknown as { currentChatSessionId: string }).currentChatSessionId = 'test';
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;
      if (!input) return false;

      input.disabled = false;
      input.value = 'Test message';

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(event);

      const attempted = (window as unknown as { _sendAttempted: boolean })._sendAttempted;
      (window as unknown as { sendChatMessage: () => void }).sendChatMessage = originalSend;
      return attempted;
    });

    expect(sendAttempted).toBeTruthy();
  });

  test('Shift+Enter does not trigger send', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const sendAttempted = await page.evaluate(() => {
      (window as unknown as { _sendAttempted: boolean })._sendAttempted = false;
      (window as unknown as { sendChatMessage: () => void }).sendChatMessage = function() {
        (window as unknown as { _sendAttempted: boolean })._sendAttempted = true;
      };

      (window as unknown as { currentChatSessionId: string }).currentChatSessionId = 'test';
      const input = document.getElementById('chat-input') as HTMLTextAreaElement;
      if (!input) return true;

      input.disabled = false;
      input.value = 'Test';

      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });
      input.dispatchEvent(event);

      return (window as unknown as { _sendAttempted: boolean })._sendAttempted;
    });

    expect(sendAttempted).toBeFalsy();
  });
});

test.describe('Chat Cost Display', () => {
  let repoId: string;

  test.beforeAll(async ({ request }) => {
    // Get a repo ID to navigate to benchmark page
    const reposResponse = await request.get('/api/repos');
    const repos = await reposResponse.json();
    if (repos.length > 0) {
      repoId = repos[0].id;
    }
  });

  test('cost display element exists and is initially empty', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const costText = await page.evaluate(() => {
      const cost = document.getElementById('chat-cost');
      return cost?.textContent;
    });
    expect(costText).toBe('');
  });

  test('updateChatCost function exists', async ({ page }) => {
    test.skip(!repoId, 'Test requires a repository');
    await page.goto(`/benchmark/${repoId}`);

    const fnExists = await page.evaluate(() =>
      typeof (window as unknown as { updateChatCost?: () => void }).updateChatCost === 'function'
    );
    expect(fnExists).toBeTruthy();
  });
});
