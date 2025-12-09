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
import { createUser, updateUserTokens, isTokenExpired } from '../../domain/user.js';
import { GITHUB_SESSION_COOKIE } from '../middleware/github-auth.js';
import { ensureValidToken, TokenRefreshError } from '../../services/github/token-refresh.js';

/**
 * @swagger
 * /auth/github:
 *   get:
 *     summary: Initiate GitHub OAuth flow
 *     description: Redirects to GitHub to start the OAuth authentication process. Sets a state cookie for CSRF protection.
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirects to GitHub OAuth authorization page
 */

/**
 * @swagger
 * /auth/github/callback:
 *   get:
 *     summary: Handle GitHub OAuth callback
 *     description: |
 *       Handles two different flows:
 *       1. OAuth login flow: Exchanges code for tokens and creates user session
 *       2. GitHub App installation flow: Detects app installation and redirects to OAuth
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Authorization code from GitHub
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: State parameter for CSRF protection (OAuth flow)
 *       - in: query
 *         name: installation_id
 *         schema:
 *           type: string
 *         description: GitHub App installation ID (installation flow)
 *       - in: query
 *         name: setup_action
 *         schema:
 *           type: string
 *         description: Setup action type (installation flow)
 *     responses:
 *       302:
 *         description: Redirects to home page on successful authentication or to /auth/github for installation flow
 *       400:
 *         description: Invalid state or missing authorization code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid or missing state parameter
 *       500:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Authentication failed
 */

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user information
 *     description: Returns the currently authenticated user's profile and token status
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Current user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: User's internal UUID
 *                     githubId:
 *                       type: integer
 *                       description: GitHub user ID
 *                     login:
 *                       type: string
 *                       description: GitHub username
 *                     avatarUrl:
 *                       type: string
 *                       description: GitHub avatar URL
 *                     name:
 *                       type: string
 *                       nullable: true
 *                       description: User's display name
 *                     email:
 *                       type: string
 *                       nullable: true
 *                       description: User's email address
 *                 tokenExpired:
 *                   type: boolean
 *                   description: Whether the user's GitHub access token is expired or about to expire
 *       401:
 *         description: Not authenticated or user not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not authenticated
 */

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Log out current user (POST)
 *     description: Clears the session cookie and redirects to home page
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirects to home page after clearing session
 *   get:
 *     summary: Log out current user (GET)
 *     description: Clears the session cookie and redirects to home page
 *     tags: [Authentication]
 *     responses:
 *       302:
 *         description: Redirects to home page after clearing session
 */

/**
 * @swagger
 * /auth/github/installation:
 *   get:
 *     summary: Get GitHub App installation URL
 *     description: Returns the URL to install the CodeWiki GitHub App
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: GitHub App installation URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   description: URL to install the GitHub App
 */

/**
 * @swagger
 * /auth/github/repos:
 *   get:
 *     summary: Get accessible repositories
 *     description: Returns list of repositories accessible to the authenticated user via the GitHub App
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: List of accessible repositories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 repos:
 *                   type: array
 *                   description: Array of repository objects
 *                   items:
 *                     type: object
 *       401:
 *         description: Not authenticated, user not found, or session expired
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not authenticated
 *                 requiresReauth:
 *                   type: boolean
 *                   description: Present when token refresh fails, indicating user needs to re-authenticate
 *                 message:
 *                   type: string
 *                   description: Detailed error message when token refresh fails
 *       500:
 *         description: Failed to fetch repositories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to fetch repositories
 */

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
     *
     * This handles two different flows:
     * 1. OAuth login flow: has `code` and `state` parameters
     * 2. GitHub App installation flow: has `code`, `installation_id`, and `setup_action` (no state)
     *
     * For installation flow, we redirect to start OAuth to authenticate the user.
     */
    async handleCallback(req: Request, res: Response): Promise<void> {
      const { code, state, installation_id, setup_action } = req.query as {
        code?: string;
        state?: string;
        installation_id?: string;
        setup_action?: string;
      };
      const signedCookies = req.signedCookies as Record<string, string>;
      const expectedState = signedCookies[OAUTH_STATE_COOKIE];

      // Detect GitHub App installation flow (no state, but has installation_id)
      // After app installation, redirect user to OAuth flow to authenticate
      if (installation_id && setup_action && !state) {
        console.log(`GitHub App: Installation completed (installation_id: ${installation_id}, action: ${setup_action}), redirecting to OAuth`);
        // Redirect to start OAuth flow - this will authenticate the user
        res.redirect('/auth/github');
        return;
      }

      // Validate state for CSRF protection (OAuth flow)
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

      // Check if token is expired or about to expire
      const tokenExpired = isTokenExpired(user);

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
        tokenExpired,
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
        // Ensure token is valid (refresh if expired)
        const tokenResult = await ensureValidToken(user, githubAuth, userRepository);

        const repos = await githubAuth.getAccessibleRepos(tokenResult.accessToken);
        res.json({ repos });
      } catch (error) {
        if (error instanceof TokenRefreshError) {
          console.warn(`GitHub OAuth: Token refresh failed for user ${user.login}: ${error.message}`);
          res.status(401).json({
            error: 'Session expired',
            requiresReauth: true,
            message: error.message,
          });
          return;
        }
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
