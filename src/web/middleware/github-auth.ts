/**
 * GitHub authentication middleware.
 *
 * Provides Express middleware for authenticating requests using JWT tokens
 * stored in signed cookies.
 */

import { Request, Response, NextFunction } from 'express';
import type { JwtService, SessionPayload } from '../../services/auth/jwt-service.js';

/** Default cookie name for GitHub session token */
export const GITHUB_SESSION_COOKIE = 'github_session';

/**
 * Extended request with user information.
 */
export interface AuthenticatedRequest extends Request {
  /** The authenticated user's session data */
  user?: SessionPayload;
}

/**
 * Options for configuring the auth middleware.
 */
export interface GitHubAuthMiddlewareOptions {
  /** Cookie name for the session token (default: 'github_session') */
  cookieName?: string;
}

/**
 * GitHub auth middleware functions.
 */
export interface GitHubAuthMiddleware {
  /**
   * Optional authentication middleware.
   * Attaches user info to request if valid token exists, but doesn't block.
   */
  optionalAuth: (req: Request, res: Response, next: NextFunction) => Promise<void>;

  /**
   * Required authentication middleware.
   * Returns 401 if no valid token is present.
   */
  requireAuth: (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

/**
 * Create GitHub auth middleware.
 *
 * @param jwtService - JWT service for token verification
 * @param options - Middleware configuration options
 * @returns Middleware functions
 */
export function createGitHubAuthMiddleware(
  jwtService: JwtService,
  options: GitHubAuthMiddlewareOptions = {}
): GitHubAuthMiddleware {
  const cookieName = options.cookieName ?? GITHUB_SESSION_COOKIE;

  /**
   * Extract and verify the session token from request cookies.
   */
  function getSessionFromRequest(req: Request): SessionPayload | null {
    const signedCookies = req.signedCookies as Record<string, string>;
    const token = signedCookies[cookieName];

    if (!token) {
      return null;
    }

    return jwtService.verifySessionToken(token);
  }

  return {
    async optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
      const session = getSessionFromRequest(req);

      if (session) {
        (req as AuthenticatedRequest).user = session;
      }

      next();
    },

    async requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
      const session = getSessionFromRequest(req);

      if (!session) {
        // Log protected endpoint access attempts without valid session
        console.log(`GitHub Auth: Unauthorized access attempt to ${req.method} ${req.path}`);
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      (req as AuthenticatedRequest).user = session;
      next();
    },
  };
}
