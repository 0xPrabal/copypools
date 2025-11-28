/**
 * Error handling utilities for better user experience
 */

/**
 * Parse blockchain errors into user-friendly messages
 */
export function parseBlockchainError(error: any): string {
  const errorString = error?.message || error?.toString() || 'Unknown error'

  // User rejected transaction
  if (
    errorString.includes('user rejected') ||
    errorString.includes('User denied') ||
    errorString.includes('cancelled')
  ) {
    return 'Transaction was cancelled by user'
  }

  // Insufficient funds
  if (
    errorString.includes('insufficient funds') ||
    errorString.includes('insufficient balance')
  ) {
    return 'Insufficient funds for transaction. Please check your balance and gas fees.'
  }

  // Gas estimation failed
  if (errorString.includes('gas required exceeds')) {
    return 'Transaction would fail. Please check your amounts and approvals.'
  }

  // Slippage too high
  if (errorString.includes('slippage') || errorString.includes('K')) {
    return 'Price moved too much. Please adjust your slippage tolerance or try again.'
  }

  // Network errors
  if (
    errorString.includes('network') ||
    errorString.includes('timeout') ||
    errorString.includes('fetch failed')
  ) {
    return 'Network error. Please check your connection and try again.'
  }

  // RPC errors
  if (errorString.includes('429') || errorString.includes('rate limit')) {
    return 'Too many requests. Please wait a moment and try again.'
  }

  // Contract errors
  if (errorString.includes('execution reverted')) {
    // Try to extract revert reason
    const reasonMatch = errorString.match(/reason="([^"]+)"/)
    if (reasonMatch) {
      return `Transaction failed: ${reasonMatch[1]}`
    }
    return 'Transaction would fail. Please check your inputs.'
  }

  // Nonce too low (transaction already processed)
  if (errorString.includes('nonce too low')) {
    return 'Transaction already processed. Please refresh the page.'
  }

  // Replacement transaction underpriced
  if (errorString.includes('replacement transaction underpriced')) {
    return 'A similar transaction is pending. Please wait or increase gas price.'
  }

  // Token approval errors
  if (errorString.includes('ERC20: insufficient allowance')) {
    return 'Token approval required. Please approve tokens first.'
  }

  // Position errors
  if (errorString.includes('position') || errorString.includes('liquidity')) {
    return 'Invalid position parameters. Please adjust your amounts or price range.'
  }

  // Generic fallback with abbreviated error
  const shortError = errorString.substring(0, 100)
  return `Transaction failed: ${shortError}${errorString.length > 100 ? '...' : ''}`
}

/**
 * Log error for debugging (only in development)
 */
export function logError(context: string, error: any): void {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${context}]`, {
      message: error?.message,
      code: error?.code,
      data: error?.data,
      stack: error?.stack,
      raw: error
    })
  }
}

/**
 * Create retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Don't retry user rejections
      const errorMsg = error?.message || ''
      if (
        errorMsg.includes('user rejected') ||
        errorMsg.includes('User denied')
      ) {
        throw error
      }

      // Don't retry contract errors (they won't succeed on retry)
      if (errorMsg.includes('execution reverted')) {
        throw error
      }

      // Wait before retrying (exponential backoff)
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

/**
 * Safe number parsing with fallback
 */
export function safeParseFloat(value: string, fallback: number = 0): number {
  const parsed = parseFloat(value)
  return isNaN(parsed) ? fallback : parsed
}

/**
 * Safe bigint parsing with fallback
 */
export function safeParseBigInt(value: string, fallback: bigint = 0n): bigint {
  try {
    return BigInt(value)
  } catch {
    return fallback
  }
}

/**
 * Check if value is safe number (not NaN, Infinity, etc.)
 */
export function isSafeNumber(value: number): boolean {
  return (
    typeof value === 'number' &&
    !isNaN(value) &&
    isFinite(value) &&
    value >= 0
  )
}

/**
 * Safely divide with zero check
 */
export function safeDivide(numerator: number, denominator: number, fallback: number = 0): number {
  if (denominator === 0 || !isSafeNumber(denominator)) {
    return fallback
  }
  const result = numerator / denominator
  return isSafeNumber(result) ? result : fallback
}
