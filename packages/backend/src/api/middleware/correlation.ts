/**
 * Request Correlation ID Middleware
 *
 * Generates a unique correlation ID for each request that can be used
 * to trace requests through the system and in logs.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';

// Extend Express Request type to include correlationId
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      startTime: number;
    }
  }
}

const correlationLogger = logger.child({ module: 'correlation' });

/**
 * Middleware that adds a correlation ID to each request.
 * If the client provides X-Request-ID header, it will be used.
 * Otherwise, a new UUID is generated.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Use client-provided ID or generate a new one
  const correlationId =
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-correlation-id'] as string) ||
    randomUUID();

  // Attach to request object
  req.correlationId = correlationId;
  req.startTime = Date.now();

  // Add to response headers
  res.setHeader('X-Request-ID', correlationId);

  // Log incoming request with correlation ID
  correlationLogger.info(
    {
      correlationId,
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
    },
    'Request started'
  );

  // Log response on finish
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const logData = {
      correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
    };

    // Log at appropriate level based on status code
    if (res.statusCode >= 500) {
      correlationLogger.error(logData, 'Request completed with server error');
    } else if (res.statusCode >= 400) {
      correlationLogger.warn(logData, 'Request completed with client error');
    } else if (duration > 5000) {
      correlationLogger.warn(logData, 'Request completed (slow)');
    } else {
      correlationLogger.debug(logData, 'Request completed');
    }
  });

  next();
}

/**
 * Get correlation ID from request or generate a new one
 * Useful for background tasks that aren't tied to a request
 */
export function getOrCreateCorrelationId(req?: Request): string {
  if (req?.correlationId) {
    return req.correlationId;
  }
  return randomUUID();
}

/**
 * Create a child logger with correlation ID context
 */
export function createCorrelatedLogger(correlationId: string) {
  return logger.child({ correlationId });
}
