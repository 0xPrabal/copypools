import { Injectable, Logger } from '@nestjs/common';
import JSBI from 'jsbi';

/**
 * Position token amounts calculated from liquidity
 */
export interface TokenAmounts {
  amount0: bigint;
  amount1: bigint;
  amount0Human: string;
  amount1Human: string;
}

/**
 * Pool state data from blockchain
 */
export interface PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

/**
 * Uniswap V3/V4 Tick Math Service
 *
 * Implements proper tick math calculations for converting liquidity to token amounts.
 * The math is identical between V3 and V4 - only the contract interfaces differ.
 *
 * Core Formulas:
 * - L = sqrt(x * y) where x=amount0, y=amount1
 * - sqrtPrice = sqrt(token1/token0) * 2^96
 * - Different formulas based on position relative to current tick
 */
@Injectable()
export class TickMathService {
  private readonly logger = new Logger(TickMathService.name);

  // Constants from Uniswap
  private readonly Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
  private readonly MIN_TICK = -887272;
  private readonly MAX_TICK = 887272;

  /**
   * Calculate token amounts from liquidity using Uniswap tick math
   *
   * @param liquidity - Position liquidity (L)
   * @param tickLower - Lower tick bound
   * @param tickUpper - Upper tick bound
   * @param currentTick - Current pool tick
   * @param currentSqrtPriceX96 - Current pool sqrt price
   * @param decimals0 - Token0 decimals
   * @param decimals1 - Token1 decimals
   * @returns Token amounts
   */
  calculateTokenAmounts(
    liquidity: bigint,
    tickLower: number,
    tickUpper: number,
    currentTick: number,
    currentSqrtPriceX96: bigint,
    decimals0: number,
    decimals1: number,
  ): TokenAmounts {
    this.logger.debug(`Calculating amounts: L=${liquidity}, ticks=[${tickLower}, ${tickUpper}], currentTick=${currentTick}`);

    // Convert ticks to sqrtPrice values
    const sqrtRatioA = this.getSqrtRatioAtTick(tickLower);
    const sqrtRatioB = this.getSqrtRatioAtTick(tickUpper);

    let amount0: bigint;
    let amount1: bigint;

    if (currentTick < tickLower) {
      // Position is entirely in token0
      amount0 = this.getAmount0ForLiquidity(sqrtRatioA, sqrtRatioB, liquidity);
      amount1 = 0n;
      this.logger.debug('Position below range (all token0)');
    } else if (currentTick >= tickUpper) {
      // Position is entirely in token1
      amount0 = 0n;
      amount1 = this.getAmount1ForLiquidity(sqrtRatioA, sqrtRatioB, liquidity);
      this.logger.debug('Position above range (all token1)');
    } else {
      // Position is in range - has both tokens
      amount0 = this.getAmount0ForLiquidity(currentSqrtPriceX96, sqrtRatioB, liquidity);
      amount1 = this.getAmount1ForLiquidity(sqrtRatioA, currentSqrtPriceX96, liquidity);
      this.logger.debug('Position in range (both tokens)');
    }

    // Convert to human-readable format
    const amount0Human = this.formatTokenAmount(amount0, decimals0);
    const amount1Human = this.formatTokenAmount(amount1, decimals1);

    this.logger.debug(`Calculated amounts: ${amount0Human} token0, ${amount1Human} token1`);

    return {
      amount0,
      amount1,
      amount0Human,
      amount1Human,
    };
  }

  /**
   * Calculate amount0 from liquidity
   * Formula: amount0 = L * (sqrtRatioB - sqrtRatioA) / (sqrtRatioA * sqrtRatioB)
   *
   * @private
   */
  private getAmount0ForLiquidity(
    sqrtRatioA: bigint,
    sqrtRatioB: bigint,
    liquidity: bigint,
  ): bigint {
    if (sqrtRatioA > sqrtRatioB) {
      [sqrtRatioA, sqrtRatioB] = [sqrtRatioB, sqrtRatioA];
    }

    const numerator1 = liquidity << 96n;
    const numerator2 = sqrtRatioB - sqrtRatioA;

    return (numerator1 * numerator2) / sqrtRatioB / sqrtRatioA;
  }

  /**
   * Calculate amount1 from liquidity
   * Formula: amount1 = L * (sqrtRatioB - sqrtRatioA)
   *
   * @private
   */
  private getAmount1ForLiquidity(
    sqrtRatioA: bigint,
    sqrtRatioB: bigint,
    liquidity: bigint,
  ): bigint {
    if (sqrtRatioA > sqrtRatioB) {
      [sqrtRatioA, sqrtRatioB] = [sqrtRatioB, sqrtRatioA];
    }

    return (liquidity * (sqrtRatioB - sqrtRatioA)) >> 96n;
  }

  /**
   * Convert tick to sqrtPriceX96
   * This is the core Uniswap tick math formula
   *
   * @private
   */
  private getSqrtRatioAtTick(tick: number): bigint {
    if (tick < this.MIN_TICK || tick > this.MAX_TICK) {
      throw new Error(`Tick ${tick} out of bounds [${this.MIN_TICK}, ${this.MAX_TICK}]`);
    }

    const absTick = tick < 0 ? -tick : tick;

    // Magic constants from Uniswap V3 (same for V4)
    let ratio = (absTick & 0x1) !== 0
      ? JSBI.BigInt('0xfffcb933bd6fad37aa2d162d1a594001')
      : JSBI.BigInt('0x100000000000000000000000000000000');

    if ((absTick & 0x2) !== 0) ratio = this.mulShift(ratio, '0xfff97272373d413259a46990580e213a');
    if ((absTick & 0x4) !== 0) ratio = this.mulShift(ratio, '0xfff2e50f5f656932ef12357cf3c7fdcc');
    if ((absTick & 0x8) !== 0) ratio = this.mulShift(ratio, '0xffe5caca7e10e4e61c3624eaa0941cd0');
    if ((absTick & 0x10) !== 0) ratio = this.mulShift(ratio, '0xffcb9843d60f6159c9db58835c926644');
    if ((absTick & 0x20) !== 0) ratio = this.mulShift(ratio, '0xff973b41fa98c081472e6896dfb254c0');
    if ((absTick & 0x40) !== 0) ratio = this.mulShift(ratio, '0xff2ea16466c96a3843ec78b326b52861');
    if ((absTick & 0x80) !== 0) ratio = this.mulShift(ratio, '0xfe5dee046a99a2a811c461f1969c3053');
    if ((absTick & 0x100) !== 0) ratio = this.mulShift(ratio, '0xfcbe86c7900a88aedcffc83b479aa3a4');
    if ((absTick & 0x200) !== 0) ratio = this.mulShift(ratio, '0xf987a7253ac413176f2b074cf7815e54');
    if ((absTick & 0x400) !== 0) ratio = this.mulShift(ratio, '0xf3392b0822b70005940c7a398e4b70f3');
    if ((absTick & 0x800) !== 0) ratio = this.mulShift(ratio, '0xe7159475a2c29b7443b29c7fa6e889d9');
    if ((absTick & 0x1000) !== 0) ratio = this.mulShift(ratio, '0xd097f3bdfd2022b8845ad8f792aa5825');
    if ((absTick & 0x2000) !== 0) ratio = this.mulShift(ratio, '0xa9f746462d870fdf8a65dc1f90e061e5');
    if ((absTick & 0x4000) !== 0) ratio = this.mulShift(ratio, '0x70d869a156d2a1b890bb3df62baf32f7');
    if ((absTick & 0x8000) !== 0) ratio = this.mulShift(ratio, '0x31be135f97d08fd981231505542fcfa6');
    if ((absTick & 0x10000) !== 0) ratio = this.mulShift(ratio, '0x9aa508b5b7a84e1c677de54f3e99bc9');
    if ((absTick & 0x20000) !== 0) ratio = this.mulShift(ratio, '0x5d6af8dedb81196699c329225ee604');
    if ((absTick & 0x40000) !== 0) ratio = this.mulShift(ratio, '0x2216e584f5fa1ea926041bedfe98');
    if ((absTick & 0x80000) !== 0) ratio = this.mulShift(ratio, '0x48a170391f7dc42444e8fa2');

    if (tick > 0) {
      ratio = JSBI.divide(
        JSBI.BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
        ratio,
      );
    }

    // Convert JSBI to bigint
    return BigInt(ratio.toString());
  }

  /**
   * Multiply and shift right by 128 bits
   * Helper for tick to sqrtPrice conversion
   *
   * @private
   */
  private mulShift(val: JSBI, mulBy: string): JSBI {
    return JSBI.signedRightShift(
      JSBI.multiply(val, JSBI.BigInt(mulBy)),
      JSBI.BigInt(128),
    );
  }

  /**
   * Format token amount from wei to human-readable
   *
   * @private
   */
  private formatTokenAmount(amount: bigint, decimals: number): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const remainder = amount % divisor;

    // Format with proper decimal places
    const remainderStr = remainder.toString().padStart(decimals, '0');
    const trimmedRemainder = remainderStr.replace(/0+$/, '') || '0';

    return `${whole}.${trimmedRemainder}`;
  }

  /**
   * Calculate USD value from token amounts and prices
   *
   * @param amount0 - Token0 amount (wei)
   * @param amount1 - Token1 amount (wei)
   * @param price0 - Token0 USD price
   * @param price1 - Token1 USD price
   * @param decimals0 - Token0 decimals
   * @param decimals1 - Token1 decimals
   * @returns Total USD value
   */
  calculateUSDValue(
    amount0: bigint,
    amount1: bigint,
    price0: number,
    price1: number,
    decimals0: number,
    decimals1: number,
  ): number {
    // Convert amounts to decimal
    const amount0Decimal = Number(amount0) / (10 ** decimals0);
    const amount1Decimal = Number(amount1) / (10 ** decimals1);

    // Calculate USD values
    const value0 = amount0Decimal * price0;
    const value1 = amount1Decimal * price1;

    const totalValue = value0 + value1;

    this.logger.debug(
      `USD Value: ${amount0Decimal.toFixed(6)} token0 * $${price0} + ` +
      `${amount1Decimal.toFixed(6)} token1 * $${price1} = $${totalValue.toFixed(2)}`
    );

    return totalValue;
  }
}
