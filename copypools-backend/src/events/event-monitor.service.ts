import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventType } from '@prisma/client';

@Injectable()
export class EventMonitorService implements OnModuleInit {
  private readonly logger = new Logger(EventMonitorService.name);

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // Initialize in background to not block app startup
    this.logger.log('Initializing event listeners...');
    // Delay event listener setup to ensure blockchain service is ready
    setTimeout(() => {
      this.setupEventListeners().catch((error) => {
        this.logger.error('Failed to setup event listeners:', error);
      });
    }, 2000);
    this.logger.log('Event listeners initialization scheduled');
  }

  private async setupEventListeners() {
    try {
      // Check if blockchain service is ready
      const lpManager = this.blockchainService.getLPManagerContract();
      if (!lpManager) {
        this.logger.warn('Blockchain service not ready, retrying in 5s...');
        setTimeout(() => this.setupEventListeners(), 5000);
        return;
      }

      this.logger.log('Setting up event listeners...');
    } catch (error) {
      this.logger.warn('Blockchain not ready yet, retrying in 5s...');
      setTimeout(() => this.setupEventListeners(), 5000);
      return;
    }

    // Listen to PositionOpened events
    await this.blockchainService.listenToPositionCreated(async (event) => {
      try {
        this.logger.log(`Position opened: ${event.positionId}`);

        // Save event to database
        await this.prisma.blockchain_events.create({
          data: {
            id: crypto.randomUUID(),
            event_type: EventType.POSITION_OPENED,
            position_id: event.positionId,
            tx_hash: event.transactionHash,
            block_number: event.blockNumber,
            log_index: 0,
            event_data: {
              owner: event.owner,
              protocol: event.protocol,
            },
            processed: false,
          },
        });

        // Sync position to database
        await this.syncPositionFromBlockchain(BigInt(event.positionId));

        // Mark event as processed
        await this.prisma.blockchain_events.updateMany({
          where: {
            tx_hash: event.transactionHash,
            event_type: EventType.POSITION_OPENED,
          },
          data: { processed: true },
        });
      } catch (error) {
        this.logger.error(`Error processing PositionOpened event:`, error);
      }
    });

    // Listen to RangeMoved events
    await this.blockchainService.listenToRangeMoved(async (event) => {
      try {
        this.logger.log(
          `Range moved: ${event.oldPositionId} -> ${event.newPositionId}`,
        );

        // Save event to database
        await this.prisma.blockchain_events.create({
          data: {
            id: crypto.randomUUID(),
            event_type: EventType.RANGE_MOVED,
            position_id: event.newPositionId,
            tx_hash: event.transactionHash,
            block_number: event.blockNumber,
            log_index: 0,
            event_data: {
              oldPositionId: event.oldPositionId,
              newPositionId: event.newPositionId,
              newTickLower: event.newTickLower,
              newTickUpper: event.newTickUpper,
            },
            processed: false,
          },
        });

        // Deactivate old position
        await this.prisma.positions.updateMany({
          where: { position_id: event.oldPositionId },
          data: { active: false },
        });

        // Sync new position
        await this.syncPositionFromBlockchain(BigInt(event.newPositionId));

        // Mark event as processed
        await this.prisma.blockchain_events.updateMany({
          where: {
            tx_hash: event.transactionHash,
            event_type: EventType.RANGE_MOVED,
          },
          data: { processed: true },
        });
      } catch (error) {
        this.logger.error(`Error processing RangeMoved event:`, error);
      }
    });

    // Listen to PositionClosed events
    await this.blockchainService.listenToPositionClosed(async (event) => {
      try {
        this.logger.log(`Position closed: ${event.positionId}`);

        // Save event to database
        await this.prisma.blockchain_events.create({
          data: {
            id: crypto.randomUUID(),
            event_type: EventType.POSITION_CLOSED,
            position_id: event.positionId,
            tx_hash: event.transactionHash,
            block_number: event.blockNumber,
            log_index: 0,
            event_data: {
              amount0: event.amount0,
              amount1: event.amount1,
            },
            processed: false,
          },
        });

        // Deactivate position
        await this.prisma.positions.updateMany({
          where: { position_id: event.positionId },
          data: { active: false },
        });

        // Mark event as processed
        await this.prisma.blockchain_events.updateMany({
          where: {
            tx_hash: event.transactionHash,
            event_type: EventType.POSITION_CLOSED,
          },
          data: { processed: true },
        });
      } catch (error) {
        this.logger.error(`Error processing PositionClosed event:`, error);
      }
    });
  }

  private async syncPositionFromBlockchain(position_id: bigint) {
    const blockchainPosition = await this.blockchainService.getPosition(position_id);
    const adapterPosition = await this.blockchainService.getAdapterPosition(
      blockchainPosition.dexTokenId,
    );

    const positionData = {
      protocol: blockchainPosition.protocol,
      dex_token_id: blockchainPosition.dexTokenId.toString(),
      owner: blockchainPosition.owner,
      token0: blockchainPosition.token0,
      token1: blockchainPosition.token1,
      active: blockchainPosition.active,
      tick_lower: adapterPosition.tickLower,
      tick_upper: adapterPosition.tickUpper,
      liquidity: adapterPosition.liquidity.toString(),
    };

    return await this.prisma.positions.upsert({
      where: { position_id: position_id.toString() },
      create: {
        id: crypto.randomUUID(),
        position_id: position_id.toString(),
        updated_at: new Date(),
        ...positionData,
      },
      update: {
        ...positionData,
        updated_at: new Date(),
      },
    });
  }

  async getEvents(positionId?: string, eventType?: EventType) {
    return await this.prisma.blockchain_events.findMany({
      where: {
        ...(positionId && { position_id: positionId }),
        ...(eventType && { event_type: eventType }),
      },
      orderBy: [{ block_number: 'desc' }, { log_index: 'desc' }],
    });
  }

  async getUnprocessedEvents() {
    return await this.prisma.blockchain_events.findMany({
      where: { processed: false },
      orderBy: [{ block_number: 'asc' }, { log_index: 'asc' }],
    });
  }
}
