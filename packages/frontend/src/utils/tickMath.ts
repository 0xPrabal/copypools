/**
 * Uniswap V4 Tick Math Utilities
 * Based on official TickMath library
 */

// Constants from Uniswap V4 TickMath.sol
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

/**
 * Calculate the maximum usable tick for a given tick spacing
 * From TickMath.maxUsableTick()
 */
export function maxUsableTick(tickSpacing: number): number {
  return Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
}

/**
 * Calculate the minimum usable tick for a given tick spacing
 * From TickMath.minUsableTick()
 */
export function minUsableTick(tickSpacing: number): number {
  return Math.floor(MIN_TICK / tickSpacing) * tickSpacing;
}

/**
 * Get tick spacing for a fee tier
 */
export function getTickSpacing(fee: number): number {
  switch (fee) {
    case 500:   return 10;   // 0.05%
    case 3000:  return 60;   // 0.30%
    case 10000: return 200;  // 1.00%
    default:    return 60;
  }
}

/**
 * Calculate a reasonable tick range for a liquidity position
 * around the current pool price
 *
 * @param currentTick - The current tick from pool.slot0
 * @param tickSpacing - The tick spacing for the fee tier
 * @param rangeMultiplier - How many tick spacings to include (default 1000)
 * @returns [tickLower, tickUpper] aligned to tickSpacing
 */
export function calculateTickRange(
  currentTick: number,
  tickSpacing: number,
  rangeMultiplier: number = 1000
): [number, number] {
  // Calculate the range width
  const rangeWidth = tickSpacing * rangeMultiplier;

  // Center the range around current tick
  let tickLower = currentTick - Math.floor(rangeWidth / 2);
  let tickUpper = currentTick + Math.floor(rangeWidth / 2);

  // Align to tick spacing (round down for lower, round up for upper)
  tickLower = Math.floor(tickLower / tickSpacing) * tickSpacing;
  tickUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing;

  // Ensure within usable bounds
  const minUsable = minUsableTick(tickSpacing);
  const maxUsable = maxUsableTick(tickSpacing);

  tickLower = Math.max(tickLower, minUsable);
  tickUpper = Math.min(tickUpper, maxUsable);

  return [tickLower, tickUpper];
}

/**
 * Calculate a full-range position for a fee tier
 * Uses the maximum usable tick range
 */
export function getFullRangeTicks(tickSpacing: number): [number, number] {
  return [minUsableTick(tickSpacing), maxUsableTick(tickSpacing)];
}

/**
 * Approximate tick from sqrtPriceX96
 * Based on: tick = log(sqrtPriceX96 / 2^96)^2 / log(1.0001)
 */
export function getTickFromSqrtPrice(sqrtPriceX96: bigint): number {
  const Q96 = 2n ** 96n;
  const ratio = Number(sqrtPriceX96) / Number(Q96);
  const price = ratio * ratio;
  const tick = Math.floor(Math.log(price) / Math.log(1.0001));
  return tick;
}

/**
 * Get a concentrated range around current price (for stable pairs)
 * Uses a narrower range (100 tick spacings)
 */
export function getConcentratedRange(
  currentTick: number,
  tickSpacing: number
): [number, number] {
  return calculateTickRange(currentTick, tickSpacing, 100);
}

/**
 * Get a wide range (for volatile pairs)
 * Uses a wider range (2000 tick spacings)
 */
export function getWideRange(
  currentTick: number,
  tickSpacing: number
): [number, number] {
  return calculateTickRange(currentTick, tickSpacing, 2000);
}

/**
 * Convert tick to price
 * price = 1.0001^tick
 * Note: This returns price of token1 in terms of token0
 */
export function tickToPrice(tick: number, token0Decimals: number = 18, token1Decimals: number = 18): number {
  // Raw price from tick formula
  const rawPrice = Math.pow(1.0001, tick);
  // Adjust for decimal difference between tokens
  const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
  return rawPrice * decimalAdjustment;
}

/**
 * Convert price to tick
 * tick = log(price) / log(1.0001)
 */
export function priceToTick(price: number, token0Decimals: number = 18, token1Decimals: number = 18): number {
  // Adjust for decimal difference
  const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
  const adjustedPrice = price / decimalAdjustment;
  return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
}

/**
 * Calculate tick range as percentage from current price
 * Returns percentage difference: (tickPrice - currentPrice) / currentPrice * 100
 * For extreme ranges, caps at reasonable display values
 */
export function tickToPercentage(tick: number, currentTick: number, token0Decimals: number = 18, token1Decimals: number = 18): number {
  const currentPrice = tickToPrice(currentTick, token0Decimals, token1Decimals);
  const tickPrice = tickToPrice(tick, token0Decimals, token1Decimals);

  // Handle edge cases for extreme tick ranges
  if (!isFinite(tickPrice) || !isFinite(currentPrice) || currentPrice === 0) {
    return tick > currentTick ? Infinity : -100;
  }

  const percentage = ((tickPrice - currentPrice) / currentPrice) * 100;

  // Cap at reasonable display values for very wide ranges
  if (percentage > 1000000) return Infinity;
  if (percentage < -100) return -100; // Can't go below -100% for lower bound

  return percentage;
}

/**
 * Format tick as a price string with appropriate precision
 * Handles extreme values gracefully
 */
export function formatTickPrice(tick: number, token0Decimals: number = 18, token1Decimals: number = 18): string {
  const price = tickToPrice(tick, token0Decimals, token1Decimals);

  // Handle extreme values
  if (!isFinite(price)) {
    return price > 0 ? '∞' : '0';
  }
  if (price >= 1e15) return '∞';
  if (price <= 1e-15) return '≈0';

  if (price >= 1000000) return `${(price / 1000000).toFixed(2)}M`;
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  if (price >= 0.0000001) return price.toFixed(10);
  return price.toExponential(4);
}

/**
 * Format percentage with sign
 * Handles extreme values gracefully
 */
export function formatPercentage(percent: number): string {
  if (!isFinite(percent)) {
    return percent > 0 ? '∞' : '-∞';
  }
  if (percent > 10000) {
    return `+${(percent / 1000).toFixed(0)}K%`;
  }
  if (percent < -99.99) {
    return '-100%';
  }
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

/**
 * Check if a position is a full range position
 * Full range positions have tick bounds at or near the min/max usable ticks
 */
export function isFullRangePosition(tickLower: number, tickUpper: number, tickSpacing: number = 60): boolean {
  const minUsable = minUsableTick(tickSpacing);
  const maxUsable = maxUsableTick(tickSpacing);

  // Allow some tolerance for rounding differences
  const tolerance = tickSpacing * 10;

  return (
    tickLower <= minUsable + tolerance &&
    tickUpper >= maxUsable - tolerance
  );
}

/**
 * Format tick range for display
 * Returns user-friendly labels for special ranges like "Full Range"
 */
export function formatTickRangeLabel(
  tick: number,
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  token0Decimals: number = 18,
  token1Decimals: number = 6,
  tickSpacing: number = 60,
  isUpperBound: boolean = false
): { percentage: string; price: string; isFullRange: boolean } {
  const fullRange = isFullRangePosition(tickLower, tickUpper, tickSpacing);

  if (fullRange) {
    return {
      percentage: isUpperBound ? 'Full Range' : 'Full Range',
      price: isUpperBound ? '0 → ∞' : '0 → ∞',
      isFullRange: true
    };
  }

  const percent = tickToPercentage(tick, currentTick, token0Decimals, token1Decimals);
  const price = formatTickPrice(tick, token0Decimals, token1Decimals);

  return {
    percentage: formatPercentage(percent),
    price,
    isFullRange: false
  };
}

/**
 * Calculate sqrtPriceX96 from tick
 * sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
 */
export function getSqrtPriceAtTick(tick: number): bigint {
  const Q96 = 2n ** 96n;
  const sqrtPrice = Math.sqrt(Math.pow(1.0001, tick));
  // Convert to bigint with Q96 precision
  return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

/**
 * Calculate token amounts for a liquidity position
 * Based on Uniswap V3/V4 LiquidityAmounts library
 *
 * @param liquidity - The liquidity amount
 * @param sqrtPriceX96 - Current pool sqrtPriceX96
 * @param tickLower - Lower tick of the position
 * @param tickUpper - Upper tick of the position
 * @param token0Decimals - Decimals for token0
 * @param token1Decimals - Decimals for token1
 * @returns [amount0, amount1] as bigints in token units
 */
export function getAmountsForLiquidity(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  token0Decimals: number = 18,
  token1Decimals: number = 6
): { amount0: bigint; amount1: bigint } {
  const Q96 = 2n ** 96n;

  // Get sqrtPrice at tick boundaries
  const sqrtPriceAX96 = getSqrtPriceAtTick(tickLower);
  const sqrtPriceBX96 = getSqrtPriceAtTick(tickUpper);

  // Get current tick from sqrtPrice
  const currentTick = getTickFromSqrtPrice(sqrtPriceX96);

  let amount0 = 0n;
  let amount1 = 0n;

  if (currentTick < tickLower) {
    // Position is entirely in token0
    // amount0 = L * (sqrtPriceB - sqrtPriceA) / (sqrtPriceA * sqrtPriceB)
    // Rearranged for precision: amount0 = L * Q96 * (sqrtPriceB - sqrtPriceA) / (sqrtPriceA * sqrtPriceB)
    const numerator = liquidity * Q96 * (sqrtPriceBX96 - sqrtPriceAX96);
    const denominator = sqrtPriceAX96 * sqrtPriceBX96;
    amount0 = denominator > 0n ? numerator / denominator : 0n;
    amount1 = 0n;
  } else if (currentTick >= tickUpper) {
    // Position is entirely in token1
    // amount1 = L * (sqrtPriceB - sqrtPriceA) / Q96
    amount0 = 0n;
    amount1 = liquidity * (sqrtPriceBX96 - sqrtPriceAX96) / Q96;
  } else {
    // Position is in range - has both tokens
    // amount0 = L * (sqrtPriceB - sqrtPrice) / (sqrtPrice * sqrtPriceB)
    // amount1 = L * (sqrtPrice - sqrtPriceA) / Q96
    const numerator0 = liquidity * Q96 * (sqrtPriceBX96 - sqrtPriceX96);
    const denominator0 = sqrtPriceX96 * sqrtPriceBX96;
    amount0 = denominator0 > 0n ? numerator0 / denominator0 : 0n;
    amount1 = liquidity * (sqrtPriceX96 - sqrtPriceAX96) / Q96;
  }

  return { amount0, amount1 };
}

/**
 * Calculate the price of token0 in terms of token1 from sqrtPriceX96
 * For ETH/USDC pool: returns ETH price in USDC
 */
export function getPriceFromSqrtPriceX96(
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number
): number {
  const Q96 = 2n ** 96n;
  // price = (sqrtPriceX96 / 2^96)^2 * 10^(token0Decimals - token1Decimals)
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  const price = sqrtPrice * sqrtPrice;
  // Adjust for decimal difference
  const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
  return price * decimalAdjustment;
}

/**
 * Calculate USD value of a liquidity position
 *
 * @param liquidity - The liquidity amount
 * @param sqrtPriceX96 - Current pool sqrtPriceX96
 * @param tickLower - Lower tick of the position
 * @param tickUpper - Upper tick of the position
 * @param token0Decimals - Decimals for token0
 * @param token1Decimals - Decimals for token1
 * @param token0PriceUsd - Price of token0 in USD (e.g., ETH = 3500). If 0, will be derived from pool price assuming token1 is stablecoin
 * @param token1PriceUsd - Price of token1 in USD (e.g., USDC = 1)
 * @returns Position value in USD
 */
export function getPositionValueUsd(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  token0Decimals: number,
  token1Decimals: number,
  token0PriceUsd: number,
  token1PriceUsd: number
): { amount0: number; amount1: number; valueUsd: number; token0PriceUsed: number } {
  const { amount0, amount1 } = getAmountsForLiquidity(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper,
    token0Decimals,
    token1Decimals
  );

  // Convert to human-readable amounts
  const amount0Human = Number(amount0) / Math.pow(10, token0Decimals);
  const amount1Human = Number(amount1) / Math.pow(10, token1Decimals);

  // If token0PriceUsd is 0 (or very small), derive from pool price
  // This assumes token1 is a stablecoin (USDC) worth $1
  let effectiveToken0Price = token0PriceUsd;
  if (token0PriceUsd <= 0 && sqrtPriceX96 > 0n) {
    // For ETH/USDC pool: price = ETH price in USDC
    effectiveToken0Price = getPriceFromSqrtPriceX96(sqrtPriceX96, token0Decimals, token1Decimals);
  }

  // Calculate USD value
  const value0Usd = amount0Human * effectiveToken0Price;
  const value1Usd = amount1Human * token1PriceUsd;
  const valueUsd = value0Usd + value1Usd;

  return {
    amount0: amount0Human,
    amount1: amount1Human,
    valueUsd,
    token0PriceUsed: effectiveToken0Price
  };
}
