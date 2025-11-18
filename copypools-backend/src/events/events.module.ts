import { Module } from '@nestjs/common';
import { EventMonitorService } from './event-monitor.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [BlockchainModule],
  providers: [EventMonitorService],
  exports: [EventMonitorService],
})
export class EventsModule {}
