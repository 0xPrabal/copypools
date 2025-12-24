import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { Hex, encodeAbiParameters, parseAbiParameters } from 'viem';

const swapLogger = logger.child({ service: 'swap' });

// WETH address on Sepolia
const WETH_SEPOLIA = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';

interface SwapQuote {
  router: string;
  data: Hex;
  expectedOutput: bigint;
  priceImpact: number;
}

/**
 * Calculate swap parameters needed for rebalancing
 * When position goes out of range, it converts to a single token.
 * To rebalance to a new range that spans current tick, we need both tokens.
 */
export interface RebalanceSwapParams {
  needsSwap: boolean;
  fromToken: string;
  toToken: string;
  swapAmount: bigint;
  reason: string;
}

/**
 * Calculate the swap needed for rebalancing a position
 * @param currentTick - Current pool tick
 * @param newTickLower - New position lower tick
 * @param newTickUpper - New position upper tick
 * @param token0 - Token0 address (use 0x0 for native ETH)
 * @param token1 - Token1 address
 * @param amount0 - Available amount of token0
 * @param amount1 - Available amount of token1
 */
export function calculateRebalanceSwap(
  currentTick: number,
  newTickLower: number,
  newTickUpper: number,
  token0: string,
  token1: string,
  amount0: bigint,
  amount1: bigint
): RebalanceSwapParams {
  // Check if new range spans current tick (requires both tokens)
  const rangeSpansCurrentTick = currentTick >= newTickLower && currentTick < newTickUpper;

  if (!rangeSpansCurrentTick) {
    // New range is entirely on one side - no swap needed
    if (currentTick < newTickLower) {
      // Current tick below range - only token0 needed
      if (amount0 > 0n) {
        return { needsSwap: false, fromToken: '', toToken: '', swapAmount: 0n, reason: 'Only token0 needed, have token0' };
      }
      // Need to swap token1 to token0
      return {
        needsSwap: true,
        fromToken: token1,
        toToken: token0,
        swapAmount: amount1 / 2n, // Swap half to get token0
        reason: 'Need token0, have only token1',
      };
    } else {
      // Current tick above range - only token1 needed
      if (amount1 > 0n) {
        return { needsSwap: false, fromToken: '', toToken: '', swapAmount: 0n, reason: 'Only token1 needed, have token1' };
      }
      // Need to swap token0 to token1
      return {
        needsSwap: true,
        fromToken: token0,
        toToken: token1,
        swapAmount: amount0 / 2n, // Swap half to get token1
        reason: 'Need token1, have only token0',
      };
    }
  }

  // Range spans current tick - need both tokens
  // Calculate optimal ratio based on where current tick is within range
  const rangeWidth = newTickUpper - newTickLower;
  const tickPosition = currentTick - newTickLower;
  const ratio1 = tickPosition / rangeWidth; // Approximate ratio of token1 needed (0 to 1)

  // If we only have one token, we need to swap some to get the other
  if (amount0 > 0n && amount1 === 0n) {
    // Have only token0, need to swap some to token1
    // Swap approximately ratio1 portion to get token1
    const swapRatio = Math.max(0.3, Math.min(0.7, ratio1)); // Clamp between 30-70%
    const swapAmount = BigInt(Math.floor(Number(amount0) * swapRatio));
    return {
      needsSwap: true,
      fromToken: token0,
      toToken: token1,
      swapAmount,
      reason: `Range spans tick, have only token0, swapping ${(swapRatio * 100).toFixed(0)}% to token1`,
    };
  }

  if (amount1 > 0n && amount0 === 0n) {
    // Have only token1, need to swap some to token0
    const ratio0 = 1 - ratio1;
    const swapRatio = Math.max(0.3, Math.min(0.7, ratio0)); // Clamp between 30-70%
    const swapAmount = BigInt(Math.floor(Number(amount1) * swapRatio));
    return {
      needsSwap: true,
      fromToken: token1,
      toToken: token0,
      swapAmount,
      reason: `Range spans tick, have only token1, swapping ${(swapRatio * 100).toFixed(0)}% to token0`,
    };
  }

  // Have both tokens - check if ratio is approximately correct
  // For simplicity, if we have both tokens, assume no swap needed
  return { needsSwap: false, fromToken: '', toToken: '', swapAmount: 0n, reason: 'Have both tokens' };
}

/**
 * Get optimal swap data using 0x API or similar aggregator
 */
export async function getSwapData(
  poolId: string,
  fromToken: string,
  toToken: string,
  amount0: bigint,
  amount1: bigint
): Promise<Hex> {
  try {
    // If no swap needed, return empty data
    if ((amount0 === 0n && amount1 === 0n) || fromToken === toToken) {
      return '0x';
    }

    // Use 0x API for swap quote
    if (config.ZEROX_API_KEY) {
      const quote = await get0xQuote(fromToken, toToken, amount0 > 0n ? amount0 : amount1);
      if (quote) {
        // Encode router and data for our contracts
        return encodeAbiParameters(
          parseAbiParameters('address router, bytes data'),
          [quote.router as `0x${string}`, quote.data]
        );
      }
    }

    // Fallback: return empty data (contract will use internal pool swap)
    return '0x';
  } catch (error) {
    swapLogger.error({ error, fromToken, toToken }, 'Failed to get swap data');
    return '0x';
  }
}

/**
 * Get swap data specifically for rebalancing a position
 * This handles the case where position has only one token but needs both
 */
export async function getRebalanceSwapData(
  currentTick: number,
  newTickLower: number,
  newTickUpper: number,
  token0: string,
  token1: string,
  amount0: bigint,
  amount1: bigint
): Promise<Hex> {
  try {
    const swapParams = calculateRebalanceSwap(
      currentTick,
      newTickLower,
      newTickUpper,
      token0,
      token1,
      amount0,
      amount1
    );

    swapLogger.info({ swapParams }, 'Calculated rebalance swap parameters');

    if (!swapParams.needsSwap) {
      return '0x';
    }

    // Convert native ETH (0x0) to WETH for swap APIs
    const sellToken = swapParams.fromToken === '0x0000000000000000000000000000000000000000'
      ? WETH_SEPOLIA
      : swapParams.fromToken;
    const buyToken = swapParams.toToken === '0x0000000000000000000000000000000000000000'
      ? WETH_SEPOLIA
      : swapParams.toToken;

    // Use 0x API for swap quote
    if (config.ZEROX_API_KEY) {
      const quote = await get0xQuote(sellToken, buyToken, swapParams.swapAmount);
      if (quote) {
        swapLogger.info({
          router: quote.router,
          expectedOutput: quote.expectedOutput.toString(),
          priceImpact: quote.priceImpact,
        }, 'Got 0x swap quote for rebalance');

        // Encode router and data for our contracts
        return encodeAbiParameters(
          parseAbiParameters('address router, bytes data'),
          [quote.router as `0x${string}`, quote.data]
        );
      }
    }

    swapLogger.warn('No swap API available, returning empty swap data');
    return '0x';
  } catch (error) {
    swapLogger.error({ error }, 'Failed to get rebalance swap data');
    return '0x';
  }
}

async function get0xQuote(
  sellToken: string,
  buyToken: string,
  sellAmount: bigint
): Promise<SwapQuote | null> {
  try {
    // 0x API v2 requires permit2 endpoint and version header
    const response = await axios.get('https://api.0x.org/swap/permit2/price', {
      headers: {
        '0x-api-key': config.ZEROX_API_KEY,
        '0x-version': 'v2',
      },
      params: {
        sellToken,
        buyToken,
        sellAmount: sellAmount.toString(),
        chainId: config.CHAIN_ID,
      },
    });

    const data = response.data;

    return {
      router: data.allowanceTarget || '0x000000000022D473030F116dDEE9F6B43aC78BA3', // Permit2 default
      data: '0x', // Price endpoint doesn't return tx data
      expectedOutput: BigInt(data.buyAmount),
      priceImpact: parseFloat(data.estimatedPriceImpact || '0'),
    };
  } catch (error) {
    swapLogger.error({ error }, '0x API v2 quote failed');
    return null;
  }
}

/**
 * Calculate optimal token ratio for a given range
 */
export function calculateOptimalRatio(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number
): { ratio0: number; ratio1: number } {
  // Simplified calculation
  // In production, use full liquidity math
  const Q96 = 2n ** 96n;
  const price = Number((sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / Q96 / Q96) / 1e18;

  const sqrtRatioA = Math.sqrt(1.0001 ** tickLower);
  const sqrtRatioB = Math.sqrt(1.0001 ** tickUpper);
  const sqrtPrice = Math.sqrt(price);

  if (sqrtPrice <= sqrtRatioA) {
    return { ratio0: 100, ratio1: 0 };
  } else if (sqrtPrice >= sqrtRatioB) {
    return { ratio0: 0, ratio1: 100 };
  }

  // Calculate amounts for unit liquidity
  const amount0 = (1 / sqrtPrice - 1 / sqrtRatioB) * 1e18;
  const amount1 = (sqrtPrice - sqrtRatioA) * 1e18;

  const total = amount0 * price + amount1;
  const ratio0 = Math.round((amount0 * price / total) * 100);
  const ratio1 = 100 - ratio0;

  return { ratio0, ratio1 };
}

/**
 * Estimate swap output amount
 */
export async function estimateSwapOutput(
  fromToken: string,
  toToken: string,
  amount: bigint
): Promise<bigint> {
  try {
    if (config.ZEROX_API_KEY) {
      const quote = await get0xQuote(fromToken, toToken, amount);
      return quote?.expectedOutput ?? 0n;
    }
    return 0n;
  } catch {
    return 0n;
  }
}
