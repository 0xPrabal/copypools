import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { PositionsModule } from './positions/positions.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { validate } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
    }),
    ThrottlerModule.forRoot([{
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000', 10),
      limit: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    BlockchainModule,
    PositionsModule,
    EventsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
