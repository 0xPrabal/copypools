import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '../../utils/logger.js';

const middlewareLogger = logger.child({ module: 'middleware' });

// Rate limiting - 100 requests per minute per IP
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    middlewareLogger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded');
    res.status(429).json({ error: 'Too many requests, please try again later' });
  },
});

// Stricter rate limit for write operations
export const writeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 writes per minute
  message: { error: 'Too many write requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validate Ethereum address format
export function validateAddress(req: Request, res: Response, next: NextFunction): void {
  const address = req.params.address || req.body?.address;

  if (address && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: 'Invalid Ethereum address format' });
    return;
  }

  next();
}

// Validate chain ID
export function validateChainId(req: Request, res: Response, next: NextFunction): void {
  const rawChainId = req.params.chainId || req.body?.chainId;

  // If no chainId provided, skip validation (optional field)
  if (rawChainId === undefined || rawChainId === null) {
    next();
    return;
  }

  const chainId = typeof rawChainId === 'number' ? rawChainId : parseInt(rawChainId, 10);

  // Reject NaN (invalid/unparseable chain ID)
  if (isNaN(chainId)) {
    res.status(400).json({ error: 'Invalid chain ID format' });
    return;
  }

  // Supported chains: Base Mainnet (8453)
  const supportedChains = [8453];

  if (!supportedChains.includes(chainId)) {
    res.status(400).json({ error: 'Unsupported chain ID', supportedChains });
    return;
  }

  next();
}

// Validate token IDs array
export function validateTokenIds(req: Request, res: Response, next: NextFunction): void {
  const tokenIds = req.body?.tokenIds || req.body?.newTokenIds || req.body?.tokenIdsToRemove;

  if (tokenIds) {
    if (!Array.isArray(tokenIds)) {
      res.status(400).json({ error: 'tokenIds must be an array' });
      return;
    }

    if (tokenIds.length > 1000) {
      res.status(400).json({ error: 'tokenIds array too large (max 1000)' });
      return;
    }

    // Validate each token ID is a valid number string
    for (const id of tokenIds) {
      if (typeof id !== 'string' || !/^\d+$/.test(id)) {
        res.status(400).json({ error: 'Invalid token ID format - must be numeric string' });
        return;
      }
    }
  }

  next();
}

// Request timeout middleware
export function requestTimeout(timeoutMs: number = 30000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setTimeout(timeoutMs, () => {
      middlewareLogger.error({ path: req.path, method: req.method }, 'Request timeout');
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timeout' });
      }
    });
    next();
  };
}

// Security headers
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // Disabled in favor of CSP
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}
