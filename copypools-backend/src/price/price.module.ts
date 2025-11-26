import { Module } from '@nestjs/common';
import { PriceService } from './price.service';

/**
 * Price Module
 *
 * Provides price oracle services for token USD valuations
 */
@Module({
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule {}
