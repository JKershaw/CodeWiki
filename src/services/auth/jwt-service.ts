/**
 * JWT session management service.
 *
 * Handles creation, verification, and refresh of JWT tokens for user sessions.
 */

import jwt, { type SignOptions } from 'jsonwebtoken';

/**
 * Payload stored in the JWT session token.
 */
export interface SessionPayload {
  /** User ID in our system */
  userId: string;
  /** GitHub username */
  githubLogin: string;
  /** Token issued at (Unix timestamp) */
  iat?: number;
  /** Token expiration (Unix timestamp) */
  exp?: number;
}

/**
 * Options for JWT service configuration.
 */
export interface JwtServiceOptions {
  /** Token expiration time (default: '24h') */
  expiresIn?: string;
}

/**
 * JWT service interface.
 */
export interface JwtService {
  /**
   * Create a new session token for a user.
   */
  createSessionToken(payload: Pick<SessionPayload, 'userId' | 'githubLogin'>): string;

  /**
   * Verify a session token and return the payload.
   * Returns null if the token is invalid or expired.
   */
  verifySessionToken(token: string): SessionPayload | null;

  /**
   * Refresh a session token, returning a new token with extended expiration.
   * Returns null if the original token is invalid or expired.
   */
  refreshSessionToken(token: string): string | null;

  /**
   * Decode a token without verifying the signature.
   * Useful for extracting payload from potentially expired tokens.
   * Returns null if the token is malformed.
   */
  decodeToken(token: string): SessionPayload | null;
}

/**
 * Create a JWT service instance.
 *
 * @param secret - Secret key for signing tokens
 * @param options - Configuration options
 * @returns JwtService instance
 */
/**
 * Parse expiry string to seconds.
 * Supports formats like '24h', '1d', '30m', '1w' or just a number (seconds).
 */
function parseExpiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhdw])$/);
  if (!match) {
    // Assume it's already a number of seconds
    return parseInt(expiry, 10) || 86400; // Default to 24h
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 60 * 60;
    case 'd': return value * 60 * 60 * 24;
    case 'w': return value * 60 * 60 * 24 * 7;
    default: return 86400; // Default to 24h
  }
}

export function createJwtService(secret: string, options: JwtServiceOptions = {}): JwtService {
  const expiresInSeconds = parseExpiryToSeconds(options.expiresIn ?? '24h');
  const signOptions: SignOptions = {
    expiresIn: expiresInSeconds,
  };

  return {
    createSessionToken(payload: Pick<SessionPayload, 'userId' | 'githubLogin'>): string {
      return jwt.sign(
        {
          userId: payload.userId,
          githubLogin: payload.githubLogin,
        },
        secret,
        signOptions
      );
    },

    verifySessionToken(token: string): SessionPayload | null {
      if (!token) {
        return null;
      }

      try {
        const decoded = jwt.verify(token, secret) as SessionPayload;
        return decoded;
      } catch (error) {
        // Log specific JWT verification failures for debugging
        if (error instanceof jwt.TokenExpiredError) {
          console.log(`JWT: Token expired at ${error.expiredAt.toISOString()}`);
        } else if (error instanceof jwt.JsonWebTokenError) {
          console.warn(`JWT: Invalid token - ${error.message}`);
        } else if (error instanceof jwt.NotBeforeError) {
          console.warn(`JWT: Token not yet valid (nbf: ${error.date.toISOString()})`);
        } else {
          console.error('JWT: Unexpected verification error:', error);
        }
        return null;
      }
    },

    refreshSessionToken(token: string): string | null {
      const payload = this.verifySessionToken(token);
      if (!payload) {
        return null;
      }

      return this.createSessionToken({
        userId: payload.userId,
        githubLogin: payload.githubLogin,
      });
    },

    decodeToken(token: string): SessionPayload | null {
      try {
        const decoded = jwt.decode(token) as SessionPayload | null;
        return decoded;
      } catch {
        return null;
      }
    },
  };
}
