import { Module } from '@nestjs/common';
import { TickMathService } from './tick-math.service';

@Module({
  providers: [TickMathService],
  exports: [TickMathService],
})
export class TickMathModule {}
