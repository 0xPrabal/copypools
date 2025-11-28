/**
 * Uniswap V3/V4 Math Utilities
 * Handles tick/price conversions and liquidity calculations
 */

// Constants
const Q96 = 2n ** 96n
const MIN_TICK = -887272
const MAX_TICK = 887272

// Tick spacing by fee tier
export const TICK_SPACINGS: { [key: string]: number } = {
  '500': 10,     // 0.05% fee
  '3000': 60,    // 0.3% fee
  '10000': 200,  // 1% fee
}

/**
 * Convert tick to price
 * price = 1.0001 ^ tick
 */
export function tickToPrice(tick: number, decimals0: number = 18, decimals1: number = 6): number {
  const price = Math.pow(1.0001, tick)
  // Adjust for decimals (token0/token1)
  const decimalAdjustment = Math.pow(10, decimals1 - decimals0)
  return price * decimalAdjustment
}

/**
 * Convert price to tick
 * tick = log(price) / log(1.0001)
 */
export function priceToTick(price: number, decimals0: number = 18, decimals1: number = 6): number {
  // Adjust for decimals
  const decimalAdjustment = Math.pow(10, decimals1 - decimals0)
  const adjustedPrice = price / decimalAdjustment

  const tick = Math.log(adjustedPrice) / Math.log(1.0001)
  return Math.round(tick)
}

/**
 * Round tick to nearest valid tick based on tick spacing
 */
export function roundToTickSpacing(tick: number, tickSpacing: number): number {
  const rounded = Math.round(tick / tickSpacing) * tickSpacing
  return Math.max(MIN_TICK, Math.min(MAX_TICK, rounded))
}

/**
 * Get tick spacing for fee tier
 */
export function getTickSpacing(feeTier: string): number {
  return TICK_SPACINGS[feeTier] || 60
}

/**
 * Check if position is in range (current price is between tickLower and tickUpper)
 */
export function isInRange(currentTick: number, tickLower: number, tickUpper: number): boolean {
  return currentTick >= tickLower && currentTick <= tickUpper
}

/**
 * Calculate token amounts needed based on liquidity and price range
 *
 * If range is below current price: only token1 needed
 * If range is above current price: only token0 needed
 * If range includes current price: both tokens needed in proportion
 */
export function calculateTokenAmountsForLiquidity(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  sqrtPriceLowerX96: bigint,
  sqrtPriceUpperX96: bigint
): { amount0: bigint; amount1: bigint } {
  let amount0 = 0n
  let amount1 = 0n

  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    // Current price below range: only token0 needed
    amount0 = getAmount0ForLiquidity(sqrtPriceLowerX96, sqrtPriceUpperX96, liquidity)
  } else if (sqrtPriceX96 < sqrtPriceUpperX96) {
    // Current price in range: both tokens needed
    amount0 = getAmount0ForLiquidity(sqrtPriceX96, sqrtPriceUpperX96, liquidity)
    amount1 = getAmount1ForLiquidity(sqrtPriceLowerX96, sqrtPriceX96, liquidity)
  } else {
    // Current price above range: only token1 needed
    amount1 = getAmount1ForLiquidity(sqrtPriceLowerX96, sqrtPriceUpperX96, liquidity)
  }

  return { amount0, amount1 }
}

/**
 * Calculate amount0 required for given liquidity
 */
function getAmount0ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    ;[sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]
  }

  return (liquidity * Q96 * (sqrtRatioBX96 - sqrtRatioAX96)) / sqrtRatioBX96 / sqrtRatioAX96
}

/**
 * Calculate amount1 required for given liquidity
 */
function getAmount1ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    ;[sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]
  }

  return (liquidity * (sqrtRatioBX96 - sqrtRatioAX96)) / Q96
}

/**
 * Convert tick to sqrtPriceX96
 */
export function tickToSqrtPriceX96(tick: number): bigint {
  const absTick = Math.abs(tick)

  let ratio = absTick & 0x1 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n

  if (absTick & 0x2) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n
  if (absTick & 0x4) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n
  if (absTick & 0x8) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n
  if (absTick & 0x10) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n
  if (absTick & 0x20) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n
  if (absTick & 0x40) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n
  if (absTick & 0x80) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n
  if (absTick & 0x100) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n
  if (absTick & 0x200) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n
  if (absTick & 0x400) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n
  if (absTick & 0x800) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n
  if (absTick & 0x1000) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n
  if (absTick & 0x2000) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n
  if (absTick & 0x4000) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n
  if (absTick & 0x8000) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n
  if (absTick & 0x10000) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n
  if (absTick & 0x20000) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n
  if (absTick & 0x40000) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n
  if (absTick & 0x80000) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n

  if (tick > 0) ratio = (1n << 256n) / ratio

  // Round up if remainder exists
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

/**
 * Format price for display (e.g., "1 WETH = 2,000 USDC")
 */
export function formatPrice(price: number, decimals: number = 2): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', { maximumFractionDigits: decimals })
  } else if (price >= 1) {
    return price.toFixed(decimals)
  } else if (price >= 0.0001) {
    return price.toFixed(4)
  } else {
    return price.toExponential(2)
  }
}

/**
 * Calculate liquidity for given amounts and price range
 * This is a simplified version - actual calculation depends on whether position is in range
 */
export function getLiquidityForAmounts(
  sqrtPriceX96: bigint,
  sqrtPriceLowerX96: bigint,
  sqrtPriceUpperX96: bigint,
  amount0: bigint,
  amount1: bigint
): bigint {
  let liquidity: bigint

  if (sqrtPriceX96 <= sqrtPriceLowerX96) {
    liquidity = getLiquidityForAmount0(sqrtPriceLowerX96, sqrtPriceUpperX96, amount0)
  } else if (sqrtPriceX96 < sqrtPriceUpperX96) {
    const liquidity0 = getLiquidityForAmount0(sqrtPriceX96, sqrtPriceUpperX96, amount0)
    const liquidity1 = getLiquidityForAmount1(sqrtPriceLowerX96, sqrtPriceX96, amount1)
    liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1
  } else {
    liquidity = getLiquidityForAmount1(sqrtPriceLowerX96, sqrtPriceUpperX96, amount1)
  }

  return liquidity
}

function getLiquidityForAmount0(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    ;[sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]
  }

  const intermediate = (sqrtRatioAX96 * sqrtRatioBX96) / Q96
  return (amount0 * intermediate) / (sqrtRatioBX96 - sqrtRatioAX96)
}

function getLiquidityForAmount1(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount1: bigint
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    ;[sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]
  }

  return (amount1 * Q96) / (sqrtRatioBX96 - sqrtRatioAX96)
}
