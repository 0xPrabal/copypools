/**
 * Slippage calculation utilities for Uniswap V4 with SlippageCheck integration
 *
 * IMPORTANT: SlippageCheck Integration Changes
 * - For ADDING liquidity (mint/increase): use amount0Max/amount1Max (maximum to spend)
 * - For REMOVING liquidity (decrease): use amount0Min/amount1Min (minimum to receive)
 */

/**
 * Calculate maximum amount to spend when adding liquidity
 * Uses a slippage buffer to account for price movements
 *
 * @param desiredAmount - The desired amount to deposit
 * @param slippageBps - Slippage tolerance in basis points (e.g., 50 = 0.5%)
 * @returns Maximum amount willing to spend
 */
export function calculateMaxAmountForAdding(
  desiredAmount: bigint,
  slippageBps: number = 50 // Default 0.5%
): bigint {
  const bps = BigInt(slippageBps);
  return (desiredAmount * (10000n + bps)) / 10000n;
}

/**
 * Calculate minimum amount to receive when removing liquidity
 * Uses a slippage tolerance to protect against price movements
 *
 * @param expectedAmount - The expected amount to receive
 * @param slippageBps - Slippage tolerance in basis points (e.g., 50 = 0.5%)
 * @returns Minimum amount willing to accept
 */
export function calculateMinAmountForRemoving(
  expectedAmount: bigint,
  slippageBps: number = 50 // Default 0.5%
): bigint {
  const bps = BigInt(slippageBps);
  return (expectedAmount * (10000n - bps)) / 10000n;
}

/**
 * Common slippage presets in basis points
 */
export const SLIPPAGE_PRESETS = {
  /** 0.1% - Very low slippage, may fail in volatile conditions */
  VERY_LOW: 10,
  /** 0.5% - Recommended for stable pairs */
  LOW: 50,
  /** 1% - Recommended for most pairs */
  MEDIUM: 100,
  /** 3% - For volatile or low liquidity pairs */
  HIGH: 300,
  /** 5% - Very high tolerance, use with caution */
  VERY_HIGH: 500,
} as const;

/**
 * Validate slippage percentage
 */
export function isValidSlippage(slippageBps: number): boolean {
  return slippageBps >= 0 && slippageBps <= 10000; // 0% to 100%
}

/**
 * Format slippage for display
 */
export function formatSlippage(slippageBps: number): string {
  return `${(slippageBps / 100).toFixed(2)}%`;
}
