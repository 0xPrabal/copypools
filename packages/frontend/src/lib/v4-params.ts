/**
 * Parameter builders for Uniswap V4 contract interactions
 * Updated for SlippageCheck integration
 */

import { calculateMaxAmountForAdding, calculateMinAmountForRemoving } from './slippage';

/**
 * Pool Key structure for Uniswap V4
 */
export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/**
 * Parameters for swapAndMint function
 * ✅ UPDATED: Uses amount0Max/amount1Max (SlippageCheck integration)
 */
export interface SwapAndMintParams {
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Max: bigint; // ✅ NEW - Maximum token0 to spend
  amount1Max: bigint; // ✅ NEW - Maximum token1 to spend
  recipient: `0x${string}`;
  deadline: bigint;
  swapSourceCurrency: `0x${string}`;
  swapSourceAmount: bigint;
  swapData: `0x${string}`;
  maxSwapSlippage: bigint;
}

/**
 * Parameters for swapAndIncreaseLiquidity function
 * ✅ UPDATED: Uses amount0Max/amount1Max (SlippageCheck integration)
 */
export interface SwapAndIncreaseParams {
  tokenId: bigint;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Max: bigint; // ✅ NEW - Maximum token0 to spend
  amount1Max: bigint; // ✅ NEW - Maximum token1 to spend
  deadline: bigint;
  swapSourceCurrency: `0x${string}`;
  swapSourceAmount: bigint;
  swapData: `0x${string}`;
  maxSwapSlippage: bigint;
}

/**
 * Parameters for decreaseAndSwap function
 * ✅ UNCHANGED: Still uses amount0Min/amount1Min (correct for removing liquidity)
 */
export interface DecreaseAndSwapParams {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint; // ✅ Unchanged - Minimum token0 to receive
  amount1Min: bigint; // ✅ Unchanged - Minimum token1 to receive
  deadline: bigint;
  swapTargetCurrency: `0x${string}`;
  swapData: `0x${string}`;
  maxSwapSlippage: bigint;
}

/**
 * Parameters for moveRange function
 * ✅ UPDATED: Uses amount0Max/amount1Max for new position (SlippageCheck integration)
 */
export interface MoveRangeParams {
  tokenId: bigint;
  newTickLower: number;
  newTickUpper: number;
  amount0Max: bigint; // ✅ NEW - Maximum token0 for new position
  amount1Max: bigint; // ✅ NEW - Maximum token1 for new position
  deadline: bigint;
  swapData: `0x${string}`;
  maxSwapSlippage: bigint;
}

/**
 * Build parameters for minting a new position
 * ✅ UPDATED for SlippageCheck
 */
export function buildSwapAndMintParams(params: {
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  slippageBps?: number; // Default 50 (0.5%)
  recipient: `0x${string}`;
  deadline: bigint;
  swapSourceCurrency?: `0x${string}`;
  swapSourceAmount?: bigint;
  swapData?: `0x${string}`;
  maxSwapSlippage?: bigint;
}): SwapAndMintParams {
  const slippage = params.slippageBps || 50;

  return {
    poolKey: params.poolKey,
    tickLower: params.tickLower,
    tickUpper: params.tickUpper,
    amount0Desired: params.amount0Desired,
    amount1Desired: params.amount1Desired,
    // ✅ Calculate max amounts with slippage buffer
    amount0Max: calculateMaxAmountForAdding(params.amount0Desired, slippage),
    amount1Max: calculateMaxAmountForAdding(params.amount1Desired, slippage),
    recipient: params.recipient,
    deadline: params.deadline,
    swapSourceCurrency: params.swapSourceCurrency || '0x0000000000000000000000000000000000000000',
    swapSourceAmount: params.swapSourceAmount || 0n,
    swapData: params.swapData || '0x',
    maxSwapSlippage: params.maxSwapSlippage || BigInt(slippage),
  };
}

/**
 * Build parameters for increasing liquidity
 * ✅ UPDATED for SlippageCheck
 */
export function buildSwapAndIncreaseParams(params: {
  tokenId: bigint;
  amount0Desired: bigint;
  amount1Desired: bigint;
  slippageBps?: number;
  deadline: bigint;
  swapSourceCurrency?: `0x${string}`;
  swapSourceAmount?: bigint;
  swapData?: `0x${string}`;
  maxSwapSlippage?: bigint;
}): SwapAndIncreaseParams {
  const slippage = params.slippageBps || 50;

  return {
    tokenId: params.tokenId,
    amount0Desired: params.amount0Desired,
    amount1Desired: params.amount1Desired,
    // ✅ Calculate max amounts with slippage buffer
    amount0Max: calculateMaxAmountForAdding(params.amount0Desired, slippage),
    amount1Max: calculateMaxAmountForAdding(params.amount1Desired, slippage),
    deadline: params.deadline,
    swapSourceCurrency: params.swapSourceCurrency || '0x0000000000000000000000000000000000000000',
    swapSourceAmount: params.swapSourceAmount || 0n,
    swapData: params.swapData || '0x',
    maxSwapSlippage: params.maxSwapSlippage || BigInt(slippage),
  };
}

/**
 * Build parameters for decreasing liquidity
 * ✅ Uses min amounts (unchanged)
 */
export function buildDecreaseAndSwapParams(params: {
  tokenId: bigint;
  liquidity: bigint;
  amount0Expected: bigint;
  amount1Expected: bigint;
  slippageBps?: number;
  deadline: bigint;
  swapTargetCurrency?: `0x${string}`;
  swapData?: `0x${string}`;
  maxSwapSlippage?: bigint;
}): DecreaseAndSwapParams {
  const slippage = params.slippageBps || 50;

  return {
    tokenId: params.tokenId,
    liquidity: params.liquidity,
    // ✅ Calculate min amounts with slippage tolerance
    amount0Min: calculateMinAmountForRemoving(params.amount0Expected, slippage),
    amount1Min: calculateMinAmountForRemoving(params.amount1Expected, slippage),
    deadline: params.deadline,
    swapTargetCurrency: params.swapTargetCurrency || '0x0000000000000000000000000000000000000000',
    swapData: params.swapData || '0x',
    maxSwapSlippage: params.maxSwapSlippage || BigInt(slippage),
  };
}

/**
 * Build parameters for moving a position to a new range
 * ✅ UPDATED for SlippageCheck
 */
export function buildMoveRangeParams(params: {
  tokenId: bigint;
  newTickLower: number;
  newTickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  slippageBps?: number;
  deadline: bigint;
  swapData?: `0x${string}`;
  maxSwapSlippage?: bigint;
}): MoveRangeParams {
  const slippage = params.slippageBps || 50;

  return {
    tokenId: params.tokenId,
    newTickLower: params.newTickLower,
    newTickUpper: params.newTickUpper,
    // ✅ Calculate max amounts for new position
    amount0Max: calculateMaxAmountForAdding(params.amount0Desired, slippage),
    amount1Max: calculateMaxAmountForAdding(params.amount1Desired, slippage),
    deadline: params.deadline,
    swapData: params.swapData || '0x',
    maxSwapSlippage: params.maxSwapSlippage || BigInt(slippage),
  };
}
