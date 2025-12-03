/**
 * Authentication routes for password protection.
 *
 * Provides login and logout functionality when SITE_PASSWORD is set.
 */

import { Router, Request, Response } from 'express';
import {
  isPasswordProtectionEnabled,
  verifyPassword,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_VALUE,
} from '../middleware/password-protection.js';

/**
 * Create authentication routes.
 */
export function createAuthRoutes(): Router {
  const router = Router();

  /**
   * GET /login - Display login form
   */
  router.get('/login', (req: Request, res: Response) => {
    // If password protection is not enabled, redirect to home
    if (!isPasswordProtectionEnabled()) {
      res.redirect('/');
      return;
    }

    const returnUrl = (req.query.returnUrl as string) || '/';
    const error = req.query.error as string;

    res.send(getLoginPageHtml(returnUrl, error));
  });

  /**
   * POST /login - Process login form
   */
  router.post('/login', (req: Request, res: Response) => {
    const { password, returnUrl = '/' } = req.body;

    // Verify password
    if (!verifyPassword(password)) {
      const errorUrl = `/login?error=invalid${returnUrl !== '/' ? `&returnUrl=${encodeURIComponent(returnUrl)}` : ''}`;
      res.redirect(errorUrl);
      return;
    }

    // Set authentication cookie (signed, httpOnly)
    res.cookie(AUTH_COOKIE_NAME, AUTH_COOKIE_VALUE, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      // Set secure only in production (when not localhost)
      secure: process.env['NODE_ENV'] === 'production',
      // Session cookie (expires when browser closes) - can be changed to a specific duration
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.redirect(returnUrl);
  });

  /**
   * POST /logout - Clear authentication
   */
  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie(AUTH_COOKIE_NAME);
    res.redirect('/login');
  });

  /**
   * GET /logout - Also support GET for easy linking
   */
  router.get('/logout', (_req: Request, res: Response) => {
    res.clearCookie(AUTH_COOKIE_NAME);
    res.redirect('/login');
  });

  return router;
}

/**
 * Generate the login page HTML.
 */
function getLoginPageHtml(returnUrl: string, error?: string): string {
  const errorHtml = error
    ? `<div class="error-message">Invalid password. Please try again.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - CodeWiki</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-elevated: #161b22;
      --bg-card: #1c2128;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --accent-growth: #10b981;
      --accent-growth-hover: #34d399;
      --accent-wisdom: #8b5cf6;
      --border: #30363d;
      --error: #f85149;
      --space-xs: 0.5rem;
      --space-sm: 1rem;
      --space-md: 1.5rem;
      --space-lg: 2.5rem;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .login-container {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: var(--space-lg);
      width: 100%;
      max-width: 400px;
      margin: var(--space-sm);
    }

    .login-header {
      text-align: center;
      margin-bottom: var(--space-lg);
    }

    .login-header h1 {
      font-size: 2rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent-growth), var(--accent-wisdom));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: var(--space-xs);
    }

    .login-header p {
      color: var(--text-secondary);
      font-size: 0.95rem;
    }

    .error-message {
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid var(--error);
      color: var(--error);
      padding: var(--space-sm);
      border-radius: 8px;
      margin-bottom: var(--space-md);
      text-align: center;
      font-size: 0.9rem;
    }

    .form-group {
      margin-bottom: var(--space-md);
    }

    .form-group label {
      display: block;
      margin-bottom: var(--space-xs);
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .form-group input {
      width: 100%;
      padding: 12px 16px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 1rem;
      transition: border-color 0.2s;
    }

    .form-group input:focus {
      outline: none;
      border-color: var(--accent-growth);
    }

    .submit-btn {
      width: 100%;
      padding: 12px 24px;
      background: linear-gradient(135deg, var(--accent-growth), var(--accent-wisdom));
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
    }

    .submit-btn:hover {
      opacity: 0.9;
    }

    .submit-btn:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <h1>CodeWiki</h1>
      <p>Enter password to continue</p>
    </div>
    ${errorHtml}
    <form method="POST" action="/login">
      <input type="hidden" name="returnUrl" value="${escapeHtml(returnUrl)}">
      <div class="form-group">
        <label for="password">Password</label>
        <input
          type="password"
          id="password"
          name="password"
          placeholder="Enter site password"
          autofocus
          required
        >
      </div>
      <button type="submit" class="submit-btn">Sign In</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] ?? char);
}
