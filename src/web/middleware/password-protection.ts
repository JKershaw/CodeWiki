/**
 * Password protection middleware.
 *
 * Provides simple site-wide password protection controlled by
 * the SITE_PASSWORD environment variable.
 *
 * When SITE_PASSWORD is set:
 * - Users must authenticate via /login to access the site
 * - Authentication is stored in a signed cookie
 *
 * When SITE_PASSWORD is not set:
 * - All routes are publicly accessible (no authentication required)
 */

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

/** Cookie name for authentication */
export const AUTH_COOKIE_NAME = 'codewiki_auth';

/** Value stored in the cookie when authenticated */
export const AUTH_COOKIE_VALUE = 'authenticated';

/** Routes that don't require authentication */
const PUBLIC_ROUTES = ['/login', '/logout'];

/**
 * Check if password protection is enabled.
 */
export function isPasswordProtectionEnabled(): boolean {
  return Boolean(process.env['SITE_PASSWORD']);
}

/**
 * Get the site password from environment.
 */
export function getSitePassword(): string | undefined {
  return process.env['SITE_PASSWORD'];
}

/**
 * Check if a password matches the site password using timing-safe comparison.
 */
export function verifyPassword(password: string): boolean {
  const sitePassword = getSitePassword();
  if (!sitePassword) {
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  const passwordBuffer = Buffer.from(password);
  const sitePasswordBuffer = Buffer.from(sitePassword);

  // Lengths must match for timingSafeEqual
  if (passwordBuffer.length !== sitePasswordBuffer.length) {
    return false;
  }

  return timingSafeEqual(passwordBuffer, sitePasswordBuffer);
}

/**
 * Check if a request is authenticated via cookie.
 */
export function isAuthenticated(req: Request): boolean {
  const signedCookies = req.signedCookies as Record<string, string>;
  return signedCookies[AUTH_COOKIE_NAME] === AUTH_COOKIE_VALUE;
}

/**
 * Check if a route is public (doesn't require authentication).
 */
function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route + '/'));
}

/**
 * Check if the request is for an API endpoint.
 */
function isApiRequest(path: string): boolean {
  return path.startsWith('/api/');
}

/**
 * Password protection middleware.
 *
 * If SITE_PASSWORD is set, requires authentication for all routes
 * except /login and /logout.
 */
export function passwordProtection(req: Request, res: Response, next: NextFunction): void {
  // If password protection is not enabled, allow all requests
  if (!isPasswordProtectionEnabled()) {
    next();
    return;
  }

  // Allow public routes
  if (isPublicRoute(req.path)) {
    next();
    return;
  }

  // Check if authenticated
  if (isAuthenticated(req)) {
    next();
    return;
  }

  // Not authenticated - block access
  if (isApiRequest(req.path)) {
    // API requests get 401 Unauthorized
    res.status(401).json({ error: 'Authentication required' });
  } else {
    // Browser requests get redirected to login
    res.redirect('/login');
  }
}
