/**
 * Structured Error Codes for the CopyPools Backend
 *
 * Error code ranges:
 * - 1xxx: Client errors (invalid input, not found)
 * - 2xxx: Blockchain/RPC errors
 * - 3xxx: Database errors
 * - 4xxx: External API errors
 */

export const ErrorCodes = {
  // 1xxx - Client errors
  INVALID_TOKEN_ID: 1001,
  POSITION_NOT_FOUND: 1002,
  INVALID_ADDRESS: 1003,
  INVALID_CHAIN_ID: 1004,
  INVALID_PARAMETERS: 1005,
  TOKEN_IDS_TOO_LARGE: 1006,
  POSITION_CLOSED: 1007,
  UNAUTHORIZED: 1008,

  // 2xxx - Blockchain errors
  RPC_TIMEOUT: 2001,
  RPC_RATE_LIMITED: 2002,
  CONTRACT_CALL_FAILED: 2003,
  RPC_CONNECTION_FAILED: 2004,
  RPC_ALL_UNHEALTHY: 2005,
  CHAIN_NOT_SUPPORTED: 2006,
  TRANSACTION_FAILED: 2007,
  GAS_PRICE_TOO_HIGH: 2008,
  WALLET_NOT_CONFIGURED: 2009,

  // 3xxx - Database errors
  DB_CONNECTION_FAILED: 3001,
  DB_QUERY_TIMEOUT: 3002,
  DB_QUERY_FAILED: 3003,
  DB_NOT_AVAILABLE: 3004,
  DB_CONSTRAINT_VIOLATION: 3005,

  // 4xxx - External API errors
  PRICE_FETCH_FAILED: 4001,
  SUBGRAPH_UNAVAILABLE: 4002,
  ALCHEMY_API_FAILED: 4003,
  SWAP_QUOTE_FAILED: 4004,
  EXTERNAL_API_TIMEOUT: 4005,
  EXTERNAL_API_RATE_LIMITED: 4006,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Application error with structured error code
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly correlationId?: string;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON(): {
    error: string;
    code: ErrorCode;
    details?: Record<string, unknown>;
    correlationId?: string;
  } {
    return {
      error: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
      ...(this.correlationId && { correlationId: this.correlationId }),
    };
  }
}

/**
 * Get appropriate HTTP status code for an error code
 */
export function getStatusCodeForError(code: ErrorCode): number {
  // 1xxx - Client errors -> 4xx
  if (code >= 1000 && code < 2000) {
    switch (code) {
      case ErrorCodes.INVALID_TOKEN_ID:
      case ErrorCodes.INVALID_ADDRESS:
      case ErrorCodes.INVALID_CHAIN_ID:
      case ErrorCodes.INVALID_PARAMETERS:
      case ErrorCodes.TOKEN_IDS_TOO_LARGE:
        return 400; // Bad Request

      case ErrorCodes.POSITION_NOT_FOUND:
      case ErrorCodes.POSITION_CLOSED:
        return 404; // Not Found

      case ErrorCodes.UNAUTHORIZED:
        return 401; // Unauthorized

      default:
        return 400;
    }
  }

  // 2xxx - Blockchain errors -> 5xx (mostly)
  if (code >= 2000 && code < 3000) {
    switch (code) {
      case ErrorCodes.RPC_RATE_LIMITED:
      case ErrorCodes.EXTERNAL_API_RATE_LIMITED:
        return 429; // Too Many Requests

      case ErrorCodes.RPC_TIMEOUT:
        return 504; // Gateway Timeout

      case ErrorCodes.RPC_ALL_UNHEALTHY:
      case ErrorCodes.RPC_CONNECTION_FAILED:
        return 503; // Service Unavailable

      case ErrorCodes.CHAIN_NOT_SUPPORTED:
        return 400; // Bad Request

      default:
        return 502; // Bad Gateway
    }
  }

  // 3xxx - Database errors -> 5xx
  if (code >= 3000 && code < 4000) {
    switch (code) {
      case ErrorCodes.DB_QUERY_TIMEOUT:
        return 504; // Gateway Timeout

      case ErrorCodes.DB_NOT_AVAILABLE:
      case ErrorCodes.DB_CONNECTION_FAILED:
        return 503; // Service Unavailable

      default:
        return 500;
    }
  }

  // 4xxx - External API errors -> 5xx
  if (code >= 4000 && code < 5000) {
    switch (code) {
      case ErrorCodes.EXTERNAL_API_TIMEOUT:
        return 504; // Gateway Timeout

      case ErrorCodes.EXTERNAL_API_RATE_LIMITED:
        return 429; // Too Many Requests

      case ErrorCodes.SUBGRAPH_UNAVAILABLE:
        return 503; // Service Unavailable

      default:
        return 502; // Bad Gateway
    }
  }

  return 500;
}

/**
 * Create a client error (4xx)
 */
export function clientError(
  message: string,
  code: ErrorCode,
  details?: Record<string, unknown>
): AppError {
  return new AppError(message, code, getStatusCodeForError(code), details);
}

/**
 * Create a service error (5xx)
 */
export function serviceError(
  message: string,
  code: ErrorCode,
  details?: Record<string, unknown>
): AppError {
  return new AppError(message, code, getStatusCodeForError(code), details);
}

/**
 * Check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Wrap unknown errors in AppError
 */
export function wrapError(
  error: unknown,
  defaultCode: ErrorCode = ErrorCodes.CONTRACT_CALL_FAILED
): AppError {
  if (isAppError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);

  // Detect common error patterns
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return new AppError(message, ErrorCodes.RPC_TIMEOUT, 504);
  }

  if (message.includes('rate limit') || message.includes('429')) {
    return new AppError(message, ErrorCodes.RPC_RATE_LIMITED, 429);
  }

  if (message.includes('ECONNREFUSED') || message.includes('connection')) {
    return new AppError(message, ErrorCodes.RPC_CONNECTION_FAILED, 503);
  }

  return new AppError(message, defaultCode, getStatusCodeForError(defaultCode));
}
