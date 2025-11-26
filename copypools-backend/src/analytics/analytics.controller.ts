import { Controller, Get, Logger, Param, HttpException, HttpStatus } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { PriceService } from '../price/price.service';

/**
 * Analytics Controller
 *
 * Provides REST API endpoints for:
 * - TVL (Total Value Locked) calculations
 * - Pool statistics
 * - Token prices
 * - Position analytics
 *
 * All endpoints return JSON with proper error handling
 */
@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly priceService: PriceService,
  ) {}

  /**
   * GET /analytics/tvl
   *
   * Calculate total value locked across all active positions
   *
   * @returns Complete TVL breakdown with per-position values
   *
   * @example
   * {
   *   "totalTVL": 1234567.89,
   *   "positionCount": 2,
   *   "activePositions": 2,
   *   "positions": [...],
   *   "pricesUsed": { "0x...": 3500.00 },
   *   "lastUpdated": "2025-01-26T..."
   * }
   */
  @Get('tvl')
  async getTVL() {
    this.logger.log('GET /analytics/tvl');

    try {
      const tvlData = await this.analyticsService.calculateTVL();
      return tvlData;
    } catch (error) {
      this.logger.error('Failed to calculate TVL:', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to calculate TVL',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /analytics/pool/stats
   *
   * Get aggregated pool statistics
   *
   * @returns Pool stats summary
   *
   * @example
   * {
   *   "tvl": "$1,234,567.89",
   *   "positionCount": 2,
   *   "activePositions": 2,
   *   "totalLiquidity": "164969879894909101",
   *   "averagePositionValue": "$617,283.95"
   * }
   */
  @Get('pool/stats')
  async getPoolStats() {
    this.logger.log('GET /analytics/pool/stats');

    try {
      const stats = await this.analyticsService.getPoolStats();
      return stats;
    } catch (error) {
      this.logger.error('Failed to get pool stats:', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to get pool statistics',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /analytics/prices
   *
   * Get current prices for all supported tokens
   *
   * @returns Token prices with metadata
   *
   * @example
   * {
   *   "tokens": [
   *     {
   *       "address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
   *       "symbol": "WETH",
   *       "name": "Wrapped Ether",
   *       "price": 3500.00
   *     }
   *   ],
   *   "lastUpdated": "2025-01-26T..."
   * }
   */
  @Get('prices')
  async getPrices() {
    this.logger.log('GET /analytics/prices');

    try {
      const tokens = this.priceService.getSupportedTokens();
      const testnetAddresses = this.priceService.getTestnetAddresses();
      const prices = await this.priceService.getTokenPrices(testnetAddresses);

      return {
        tokens: tokens.map(t => ({
          address: t.mainnetAddress,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          // Get price using testnet address key
          price: prices[testnetAddresses.find(addr =>
            this.priceService.getTokenMetadata(addr)?.symbol === t.symbol
          )?.toLowerCase() || ''] || 0,
        })),
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to fetch prices:', error);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to fetch token prices',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /analytics/positions/:id
   *
   * Get detailed analytics for a specific position
   *
   * @param id - Position ID
   * @returns Position analytics with event history
   *
   * @example
   * {
   *   "position": {
   *     "positionId": "26",
   *     "estimatedValueUSD": 289121.45,
   *     ...
   *   },
   *   "events": {
   *     "compounds": 3,
   *     "rangeMoves": 1
   *   },
   *   "recentCompounds": [...],
   *   "recentMoves": [...]
   * }
   */
  @Get('positions/:id')
  async getPositionAnalytics(@Param('id') id: string) {
    this.logger.log(`GET /analytics/positions/${id}`);

    try {
      const analytics = await this.analyticsService.getPositionAnalytics(id);
      return analytics;
    } catch (error) {
      this.logger.error(`Failed to get analytics for position ${id}:`, error);

      if (error.message.includes('not found')) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Position ${id} not found`,
          },
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to get position analytics',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /analytics/health
   *
   * Health check endpoint for monitoring
   *
   * @returns Service health status
   */
  @Get('health')
  async health() {
    return {
      status: 'ok',
      service: 'analytics',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
