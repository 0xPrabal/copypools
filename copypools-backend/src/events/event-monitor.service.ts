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
    this.logger.log('Initializing event listeners...');
    await this.setupEventListeners();
    this.logger.log('Event listeners initialized');
  }

  private async setupEventListeners() {
    // Listen to PositionOpened events
    await this.blockchainService.listenToPositionCreated(async (event) => {
      try {
        this.logger.log(`Position opened: ${event.positionId}`);

        // Save event to database
        await this.prisma.blockchainEvent.create({
          data: {
            eventType: EventType.POSITION_OPENED,
            positionId: event.positionId,
            txHash: event.transactionHash,
            blockNumber: event.blockNumber,
            logIndex: 0,
            eventData: {
              owner: event.owner,
              protocol: event.protocol,
            },
            processed: false,
          },
        });

        // Sync position to database
        await this.syncPositionFromBlockchain(BigInt(event.positionId));

        // Mark event as processed
        await this.prisma.blockchainEvent.updateMany({
          where: {
            txHash: event.transactionHash,
            eventType: EventType.POSITION_OPENED,
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
        await this.prisma.blockchainEvent.create({
          data: {
            eventType: EventType.RANGE_MOVED,
            positionId: event.newPositionId,
            txHash: event.transactionHash,
            blockNumber: event.blockNumber,
            logIndex: 0,
            eventData: {
              oldPositionId: event.oldPositionId,
              newPositionId: event.newPositionId,
              newTickLower: event.newTickLower,
              newTickUpper: event.newTickUpper,
            },
            processed: false,
          },
        });

        // Deactivate old position
        await this.prisma.position.updateMany({
          where: { positionId: event.oldPositionId },
          data: { active: false },
        });

        // Sync new position
        await this.syncPositionFromBlockchain(BigInt(event.newPositionId));

        // Mark event as processed
        await this.prisma.blockchainEvent.updateMany({
          where: {
            txHash: event.transactionHash,
            eventType: EventType.RANGE_MOVED,
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
        await this.prisma.blockchainEvent.create({
          data: {
            eventType: EventType.POSITION_CLOSED,
            positionId: event.positionId,
            txHash: event.transactionHash,
            blockNumber: event.blockNumber,
            logIndex: 0,
            eventData: {
              amount0: event.amount0,
              amount1: event.amount1,
            },
            processed: false,
          },
        });

        // Deactivate position
        await this.prisma.position.updateMany({
          where: { positionId: event.positionId },
          data: { active: false },
        });

        // Mark event as processed
        await this.prisma.blockchainEvent.updateMany({
          where: {
            txHash: event.transactionHash,
            eventType: EventType.POSITION_CLOSED,
          },
          data: { processed: true },
        });
      } catch (error) {
        this.logger.error(`Error processing PositionClosed event:`, error);
      }
    });
  }

  private async syncPositionFromBlockchain(positionId: bigint) {
    const blockchainPosition = await this.blockchainService.getPosition(positionId);
    const adapterPosition = await this.blockchainService.getAdapterPosition(
      blockchainPosition.dexTokenId,
    );

    const positionData = {
      protocol: blockchainPosition.protocol,
      dexTokenId: blockchainPosition.dexTokenId.toString(),
      owner: blockchainPosition.owner,
      token0: blockchainPosition.token0,
      token1: blockchainPosition.token1,
      active: blockchainPosition.active,
      tickLower: adapterPosition.tickLower,
      tickUpper: adapterPosition.tickUpper,
      liquidity: adapterPosition.liquidity.toString(),
    };

    return await this.prisma.position.upsert({
      where: { positionId: positionId.toString() },
      create: {
        positionId: positionId.toString(),
        ...positionData,
      },
      update: positionData,
    });
  }

  async getEvents(positionId?: string, eventType?: EventType) {
    return await this.prisma.blockchainEvent.findMany({
      where: {
        ...(positionId && { positionId }),
        ...(eventType && { eventType }),
      },
      orderBy: [{ blockNumber: 'desc' }, { logIndex: 'desc' }],
    });
  }

  async getUnprocessedEvents() {
    return await this.prisma.blockchainEvent.findMany({
      where: { processed: false },
      orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }],
    });
  }
}
