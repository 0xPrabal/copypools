import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PriceService } from '../price/price.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { TickMathService } from '../tick-math/tick-math.service';

/**
 * Position value with USD calculation
 */
export interface PositionValue {
  positionId: string;
  owner: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  tickLower: number;
  tickUpper: number;
  liquidityRaw: string;
  estimatedValueUSD: number;
  active: boolean;
}

/**
 * Complete TVL data response
 */
export interface TVLData {
  totalTVL: number;
  positionCount: number;
  activePositions: number;
  positions: PositionValue[];
  pricesUsed: Record<string, number>;
  lastUpdated: string;
}

/**
 * Pool statistics summary
 */
export interface PoolStats {
  tvl: string;
  positionCount: number;
  activePositions: number;
  totalLiquidity: string;
  averagePositionValue: string;
}

/**
 * Analytics service for calculating TVL and pool statistics
 *
 * Features:
 * - Real-time TVL calculation from Ponder-indexed positions
 * - Token price integration via PriceService
 * - Per-position value calculations
 * - Pool statistics aggregation
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceService: PriceService,
    private readonly blockchainService: BlockchainService,
    private readonly tickMathService: TickMathService,
  ) {}

  /**
   * Calculate total TVL from all active positions
   * @returns Complete TVL data with position breakdown
   */
  async calculateTVL(): Promise<TVLData> {
    this.logger.log('📊 Calculating TVL from Ponder-indexed positions...');

    // Fetch all active positions from Ponder database
    const positions = await this.prisma.b6__ponder_position.findMany({
      where: { active: true },
      orderBy: { updated_at: 'desc' },
    });

    if (positions.length === 0) {
      this.logger.warn('No active positions found');
      return {
        totalTVL: 0,
        positionCount: 0,
        activePositions: 0,
        positions: [],
        pricesUsed: {},
        lastUpdated: new Date().toISOString(),
      };
    }

    this.logger.log(`Found ${positions.length} active positions`);

    // Extract unique tokens
    const tokens = new Set<string>();
    positions.forEach((p) => {
      tokens.add(p.token0);
      tokens.add(p.token1);
    });

    this.logger.log(`Fetching prices for ${tokens.size} unique tokens...`);

    // Batch fetch all token prices
    const prices = await this.priceService.getTokenPrices(Array.from(tokens));

    // Calculate value for each position
    let totalTVL = 0;
    const positionValues: PositionValue[] = [];

    for (const position of positions) {
      try {
        const value = await this.calculatePositionValue(position, prices);
        totalTVL += value.estimatedValueUSD;
        positionValues.push(value);
      } catch (error) {
        this.logger.error(`Failed to calculate value for position ${position.id}:`, error.message);
      }
    }

    this.logger.log(`💰 Total TVL: $${totalTVL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

    return {
      totalTVL,
      positionCount: positions.length,
      activePositions: positions.length,
      positions: positionValues,
      pricesUsed: prices,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get aggregated pool statistics
   * @returns Pool stats summary
   */
  async getPoolStats(): Promise<PoolStats> {
    const tvlData = await this.calculateTVL();

    const totalLiquidity = tvlData.positions
      .reduce((sum, p) => sum + BigInt(p.liquidityRaw || 0), 0n);

    const averageValue = tvlData.positionCount > 0
      ? tvlData.totalTVL / tvlData.positionCount
      : 0;

    return {
      tvl: `$${tvlData.totalTVL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      positionCount: tvlData.positionCount,
      activePositions: tvlData.activePositions,
      totalLiquidity: totalLiquidity.toString(),
      averagePositionValue: `$${averageValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    };
  }

  /**
   * Calculate USD value for a single position using proper Uniswap V4 tick math
   * @param position - Position data from Ponder
   * @param prices - Token prices record
   * @returns Position value data
   * @private
   */
  private async calculatePositionValue(
    position: any,
    prices: Record<string, number>,
  ): Promise<PositionValue> {
    // Get token metadata
    const token0Metadata = this.priceService.getTokenMetadata(position.token0);
    const token1Metadata = this.priceService.getTokenMetadata(position.token1);

    if (!token0Metadata || !token1Metadata) {
      throw new Error(`Missing metadata for tokens: ${position.token0} or ${position.token1}`);
    }

    // Get prices
    const price0 = prices[position.token0.toLowerCase()] || 0;
    const price1 = prices[position.token1.toLowerCase()] || 0;

    let estimatedValue = 0;

    try {
      // Fetch current pool state from blockchain
      const poolInfo = await this.blockchainService.getPoolInfo(
        position.token0,
        position.token1,
        3000, // Standard 0.3% fee tier
      );

      // Parse liquidity value
      const liquidity = BigInt(position.liquidity || 0);

      if (liquidity > 0n) {
        // Use proper Uniswap V4 tick math to calculate token amounts
        const { amount0, amount1 } = this.tickMathService.calculateTokenAmounts(
          liquidity,
          position.tick_lower || 0,
          position.tick_upper || 0,
          poolInfo.tick,
          poolInfo.sqrtPriceX96,
          token0Metadata.decimals,
          token1Metadata.decimals,
        );

        // Calculate USD value
        estimatedValue = this.tickMathService.calculateUSDValue(
          amount0,
          amount1,
          price0,
          price1,
          token0Metadata.decimals,
          token1Metadata.decimals,
        );

        this.logger.debug(
          `Position ${position.id}: ${estimatedValue.toFixed(2)} USD ` +
          `(L=${liquidity}, tick=${poolInfo.tick}, range=[${position.tick_lower}, ${position.tick_upper}])`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to calculate exact value for position ${position.id}: ${error.message}. ` +
        `Using fallback calculation.`
      );

      // Fallback: Simple approximation if blockchain call fails
      const liquidityValue = Number(position.liquidity || 0) / 1e18;
      estimatedValue = liquidityValue * ((price0 + price1) / 2) * 0.01; // Conservative estimate
    }

    return {
      positionId: position.id,
      owner: position.owner,
      token0: position.token0,
      token1: position.token1,
      token0Symbol: token0Metadata.symbol,
      token1Symbol: token1Metadata.symbol,
      tickLower: position.tick_lower || 0,
      tickUpper: position.tick_upper || 0,
      liquidityRaw: position.liquidity || '0',
      estimatedValueUSD: estimatedValue,
      active: position.active,
    };
  }

  /**
   * Get detailed analytics for a specific position
   * @param positionId - Position ID
   * @returns Position analytics
   */
  async getPositionAnalytics(positionId: string) {
    this.logger.log(`Fetching analytics for position ${positionId}`);

    const position = await this.prisma.b6__ponder_position.findUnique({
      where: { id: positionId },
    });

    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Get token prices
    const prices = await this.priceService.getTokenPrices([
      position.token0,
      position.token1,
    ]);

    // Calculate position value
    const value = await this.calculatePositionValue(position, prices);

    // Get position events (compounds, moves, etc.)
    const [compounds, moves] = await Promise.all([
      this.prisma.b6__ponder_compound_event.findMany({
        where: { position_id: positionId },
        orderBy: { timestamp: 'desc' },
        take: 10,
      }),
      this.prisma.b6__ponder_range_move_event.findMany({
        where: {
          OR: [
            { old_position_id: positionId },
            { new_position_id: positionId },
          ],
        },
        orderBy: { timestamp: 'desc' },
        take: 10,
      }),
    ]);

    return {
      position: value,
      events: {
        compounds: compounds.length,
        rangeMoves: moves.length,
      },
      recentCompounds: compounds.map(c => ({
        txHash: c.tx_hash,
        addedLiquidity: c.added_liquidity,
        timestamp: new Date(Number(c.timestamp) * 1000).toISOString(),
      })),
      recentMoves: moves.map(m => ({
        txHash: m.tx_hash,
        oldPositionId: m.old_position_id,
        newPositionId: m.new_position_id,
        newTickLower: m.new_tick_lower,
        newTickUpper: m.new_tick_upper,
        timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
      })),
    };
  }
}
