/**
 * GitHub authentication routes.
 *
 * Handles OAuth flow, session management, and user info retrieval.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { timingSafeEqual } from 'crypto';
import type { JwtService } from '../../services/auth/jwt-service.js';
import type { GitHubAuthService } from '../../services/github/github-auth-service.js';
import type { UserRepository } from '../../repositories/interfaces/user-repository.js';
import { createUser, updateUserTokens } from '../../domain/user.js';
import { GITHUB_SESSION_COOKIE } from '../middleware/github-auth.js';

/** Cookie name for OAuth state */
const OAUTH_STATE_COOKIE = 'github_oauth_state';

/**
 * Configuration for GitHub auth routes.
 */
export interface GitHubAuthRoutesConfig {
  jwtService: JwtService;
  githubAuth: GitHubAuthService;
  userRepository: UserRepository;
  sessionSecret: string;
}

/**
 * GitHub auth route handlers (for testing).
 */
export interface GitHubAuthRouteHandlers {
  initiateAuth: (req: Request, res: Response) => Promise<void>;
  handleCallback: (req: Request, res: Response) => Promise<void>;
  getCurrentUser: (req: Request, res: Response) => Promise<void>;
  logout: (req: Request, res: Response) => Promise<void>;
  getInstallationUrl: (req: Request, res: Response) => Promise<void>;
  getAccessibleRepos: (req: Request, res: Response) => Promise<void>;
}

/**
 * Create GitHub auth route handlers.
 */
export function createGitHubAuthRoutes(config: GitHubAuthRoutesConfig): GitHubAuthRouteHandlers {
  const { jwtService, githubAuth, userRepository } = config;

  /**
   * Get session from request cookies.
   */
  function getSessionFromRequest(req: Request) {
    const signedCookies = req.signedCookies as Record<string, string>;
    const token = signedCookies[GITHUB_SESSION_COOKIE];
    if (!token) return null;
    return jwtService.verifySessionToken(token);
  }

  /**
   * Timing-safe string comparison.
   */
  function safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  return {
    /**
     * GET /auth/github - Initiate OAuth flow
     */
    async initiateAuth(req: Request, res: Response): Promise<void> {
      const state = githubAuth.generateState();

      // Store state in signed cookie for CSRF protection
      res.cookie(OAUTH_STATE_COOKIE, state, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        maxAge: 10 * 60 * 1000, // 10 minutes
      });

      const authUrl = githubAuth.getAuthorizationUrl(state);
      res.redirect(authUrl);
    },

    /**
     * GET /auth/github/callback - Handle OAuth callback
     */
    async handleCallback(req: Request, res: Response): Promise<void> {
      const { code, state } = req.query as { code?: string; state?: string };
      const signedCookies = req.signedCookies as Record<string, string>;
      const expectedState = signedCookies[OAUTH_STATE_COOKIE];

      // Validate state for CSRF protection
      if (!state || !expectedState || !safeCompare(state, expectedState)) {
        console.warn('GitHub OAuth: State validation failed', {
          hasState: !!state,
          hasExpectedState: !!expectedState,
          stateMatch: state && expectedState ? 'mismatch' : 'missing',
        });
        res.status(400).json({ error: 'Invalid or missing state parameter' });
        return;
      }

      // Validate code
      if (!code) {
        console.warn('GitHub OAuth: Callback received without authorization code');
        res.status(400).json({ error: 'Missing authorization code' });
        return;
      }

      try {
        // Exchange code for tokens
        const tokens = await githubAuth.exchangeCodeForTokens(code);

        // Get user profile
        const profile = await githubAuth.getUserProfile(tokens.accessToken);

        // Find or create user
        let user = await userRepository.findByGitHubId(profile.id);

        if (user) {
          // Update existing user's tokens
          user = updateUserTokens(user, {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            tokenExpiresAt: tokens.expiresAt,
          });
          await userRepository.save(user);
        } else {
          // Create new user - only include optional fields if they have values
          const createParams: Parameters<typeof createUser>[0] = {
            id: uuid(),
            githubId: profile.id,
            login: profile.login,
            avatarUrl: profile.avatarUrl,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            tokenExpiresAt: tokens.expiresAt,
          };
          if (profile.name !== undefined) {
            createParams.name = profile.name;
          }
          if (profile.email !== undefined) {
            createParams.email = profile.email;
          }
          user = createUser(createParams);
          await userRepository.save(user);
        }

        // Create session token
        const sessionToken = jwtService.createSessionToken({
          userId: user.id,
          githubLogin: user.login,
        });

        // Clear state cookie
        res.clearCookie(OAUTH_STATE_COOKIE);

        // Set session cookie
        res.cookie(GITHUB_SESSION_COOKIE, sessionToken, {
          signed: true,
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env['NODE_ENV'] === 'production',
          maxAge: 24 * 60 * 60 * 1000, // 24 hours
        });

        console.log(`GitHub OAuth: Login successful for user ${user.login} (ID: ${user.id})`);

        // Redirect to app
        res.redirect('/');
      } catch (error) {
        console.error('GitHub OAuth: Callback failed -', error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Authentication failed' });
      }
    },

    /**
     * GET /auth/me - Get current user info
     */
    async getCurrentUser(req: Request, res: Response): Promise<void> {
      const session = getSessionFromRequest(req);

      if (!session) {
        // Don't log this - it's expected for unauthenticated users checking their status
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const user = await userRepository.findById(session.userId);

      if (!user) {
        console.warn(`GitHub OAuth: Session valid but user not found (userId: ${session.userId}, login: ${session.githubLogin})`);
        res.status(401).json({ error: 'User not found' });
        return;
      }

      // Return user info (excluding sensitive tokens)
      res.json({
        user: {
          id: user.id,
          githubId: user.githubId,
          login: user.login,
          avatarUrl: user.avatarUrl,
          name: user.name,
          email: user.email,
        },
      });
    },

    /**
     * POST /auth/logout - Clear session
     */
    async logout(req: Request, res: Response): Promise<void> {
      const session = getSessionFromRequest(req);
      if (session) {
        console.log(`GitHub OAuth: User ${session.githubLogin} logged out`);
      }
      res.clearCookie(GITHUB_SESSION_COOKIE);
      res.redirect('/');
    },

    /**
     * GET /auth/github/installation - Get installation URL
     */
    async getInstallationUrl(_req: Request, res: Response): Promise<void> {
      const url = githubAuth.getInstallationUrl();
      res.json({ url });
    },

    /**
     * GET /auth/github/repos - Get accessible repositories
     */
    async getAccessibleRepos(req: Request, res: Response): Promise<void> {
      const session = getSessionFromRequest(req);

      if (!session) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const user = await userRepository.findById(session.userId);

      if (!user) {
        console.warn(`GitHub OAuth: Session valid but user not found for repos request (userId: ${session.userId})`);
        res.status(401).json({ error: 'User not found' });
        return;
      }

      try {
        const repos = await githubAuth.getAccessibleRepos(user.accessToken);
        res.json({ repos });
      } catch (error) {
        console.error(`GitHub OAuth: Failed to fetch repos for user ${user.login}:`, error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Failed to fetch repositories' });
      }
    },
  };
}

/**
 * Create Express router for GitHub auth.
 */
export function createGitHubAuthRouter(config: GitHubAuthRoutesConfig): Router {
  const router = Router();
  const handlers = createGitHubAuthRoutes(config);

  router.get('/auth/github', (req, res) => handlers.initiateAuth(req, res));
  router.get('/auth/github/callback', (req, res) => handlers.handleCallback(req, res));
  router.get('/auth/me', (req, res) => handlers.getCurrentUser(req, res));
  router.post('/auth/logout', (req, res) => handlers.logout(req, res));
  router.get('/auth/logout', (req, res) => handlers.logout(req, res));
  router.get('/auth/github/installation', (req, res) => handlers.getInstallationUrl(req, res));
  router.get('/auth/github/repos', (req, res) => handlers.getAccessibleRepos(req, res));

  return router;
}
