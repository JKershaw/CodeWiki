/**
 * CodeWiki Web Server.
 *
 * Provides a web interface for managing repositories and browsing wikis.
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRepositories } from '../repositories/index.js';
import { createGitService } from '../services/git/git-service.js';
import { createMockLLMForCodeAnalysis } from '../services/llm/mock-llm-service.js';
import { createOpenRouterLLM } from '../services/llm/openrouter-llm-service.js';
import type { LLMService } from '../services/llm/llm-service.js';
import { createApiRoutes } from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env['PORT'] || 3000;

// Initialize services
const repos = createRepositories({ type: 'file' });
const git = createGitService();

function createLLM(): LLMService {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (apiKey) {
    const model = process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-sonnet-4.5';
    return createOpenRouterLLM({ apiKey, model });
  }
  return createMockLLMForCodeAnalysis();
}

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// API Routes
app.use(createApiRoutes({ repos, git, createLLM }));

// Serve index.html for all non-API routes (SPA support)
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Start server
export function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`CodeWiki web server running at http://localhost:${port}`);
  });
}

// Export for testing
export { app };

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startServer();
}
