/**
 * CodeWiki Web Server.
 *
 * Provides a web interface for managing repositories and browsing wikis.
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRepositories, type RepositoryConnection } from '../repositories/index.js';
import { createGitService } from '../services/git/git-service.js';
import { createMockLLMForCodeAnalysis } from '../services/llm/mock-llm-service.js';
import { createOpenRouterLLM } from '../services/llm/openrouter-llm-service.js';
import type { LLMService } from '../services/llm/llm-service.js';
import { createApiRoutes } from './routes/index.js';
import { createAuthRoutes } from './routes/auth.js';
import { createGitHubAuthRouter } from './routes/github-auth.js';
import { passwordProtection } from './middleware/password-protection.js';
import { createJwtService } from '../services/auth/jwt-service.js';
import { createGitHubAuthService } from '../services/github/github-auth-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env['PORT'] || 3000;

// Session secret for signing cookies and JWTs
const SESSION_SECRET = process.env['SESSION_SECRET'] || randomBytes(32).toString('hex');

// GitHub App configuration
const GITHUB_CLIENT_ID = process.env['GITHUB_APP_CLIENT_ID'];
const GITHUB_CLIENT_SECRET = process.env['GITHUB_APP_CLIENT_SECRET'];
const GITHUB_APP_NAME = process.env['GITHUB_APP_NAME'];

/**
 * Check if GitHub OAuth is configured.
 */
function isGitHubAuthEnabled(): boolean {
  return Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET && GITHUB_APP_NAME);
}

// Repository connection (initialized in startServer)
let repoConnection: RepositoryConnection | null = null;

function createLLM(): LLMService {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (apiKey) {
    const model = process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-sonnet-4.5';
    return createOpenRouterLLM({ apiKey, model });
  }
  return createMockLLMForCodeAnalysis();
}

// Start server
export async function startServer(port = PORT) {
  // Initialize services
  repoConnection = await createRepositories();
  const repos = repoConnection.repositories;
  const git = createGitService();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(SESSION_SECRET));

  // Password-based authentication routes (must be before password protection)
  app.use(createAuthRoutes());

  // GitHub OAuth authentication routes (if configured)
  if (isGitHubAuthEnabled()) {
    const baseUrl = process.env['BASE_URL'] || `http://localhost:${port}`;
    const jwtService = createJwtService(SESSION_SECRET);
    const githubAuth = createGitHubAuthService({
      clientId: GITHUB_CLIENT_ID!,
      clientSecret: GITHUB_CLIENT_SECRET!,
      appName: GITHUB_APP_NAME!,
      redirectUri: `${baseUrl}/auth/github/callback`,
    });

    app.use(createGitHubAuthRouter({
      jwtService,
      githubAuth,
      userRepository: repos.users,
      sessionSecret: SESSION_SECRET,
    }));

    console.log('GitHub OAuth authentication enabled');
  }

  // Password protection middleware
  app.use(passwordProtection);

  // Static files (after password protection)
  app.use(express.static(join(__dirname, 'public')));

  // API Routes
  app.use(createApiRoutes({ repos, git, createLLM }));

  // Serve index.html for all non-API routes (SPA support)
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
  });

  const server = app.listen(port, () => {
    console.log(`CodeWiki web server running at http://localhost:${port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    server.close();
    if (repoConnection) {
      await repoConnection.close();
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return server;
}

// Export for testing
export { app };

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
