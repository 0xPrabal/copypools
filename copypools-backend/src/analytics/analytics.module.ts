import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { PriceModule } from '../price/price.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { TickMathModule } from '../tick-math/tick-math.module';

/**
 * Analytics Module
 *
 * Provides TVL calculation and pool analytics endpoints with proper Uniswap V4 tick math
 */
@Module({
  imports: [PriceModule, PrismaModule, BlockchainModule, TickMathModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
