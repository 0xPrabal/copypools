import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, TransactionStatus } from '@prisma/client';

@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name);

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly prisma: PrismaService,
  ) {}

  async getPosition(positionId: bigint) {
    try {
      // First check database
      let dbPosition = await this.prisma.position.findUnique({
        where: { positionId: positionId.toString() },
      });

      // If not in database, fetch from blockchain and save
      if (!dbPosition) {
        const blockchainPosition = await this.blockchainService.getPosition(positionId);

        if (!blockchainPosition.active && blockchainPosition.owner === '0x0000000000000000000000000000000000000000') {
          throw new NotFoundException(`Position ${positionId} not found`);
        }

        dbPosition = await this.syncPositionFromBlockchain(positionId);
      }

      return {
        positionId: dbPosition.positionId,
        protocol: dbPosition.protocol,
        dexTokenId: dbPosition.dexTokenId,
        owner: dbPosition.owner,
        token0: dbPosition.token0,
        token1: dbPosition.token1,
        active: dbPosition.active,
        tickLower: dbPosition.tickLower,
        tickUpper: dbPosition.tickUpper,
        liquidity: dbPosition.liquidity,
      };
    } catch (error) {
      this.logger.error(`Error getting position ${positionId}:`, error);
      throw error;
    }
  }

  async getPositionDetails(positionId: bigint) {
    try {
      // Get position from LPManager
      const position = await this.blockchainService.getPosition(positionId);

      if (!position.active && position.owner === '0x0000000000000000000000000000000000000000') {
        throw new NotFoundException(`Position ${positionId} not found`);
      }

      // Get adapter position details
      const adapterPosition = await this.blockchainService.getAdapterPosition(
        position.dexTokenId,
      );

      return {
        positionId: positionId.toString(),
        protocol: position.protocol,
        owner: position.owner,
        active: position.active,
        tokens: {
          token0: position.token0,
          token1: position.token1,
        },
        liquidity: {
          total: adapterPosition.liquidity.toString(),
          tickLower: Number(adapterPosition.tickLower),
          tickUpper: Number(adapterPosition.tickUpper),
        },
        dexTokenId: position.dexTokenId.toString(),
      };
    } catch (error) {
      this.logger.error(`Error getting position details ${positionId}:`, error);
      throw error;
    }
  }

  async moveRange(
    positionId: bigint,
    newTickLower: number,
    newTickUpper: number,
    doSwap: boolean,
  ) {
    let transaction;

    try {
      // Validate position exists and is active
      const position = await this.blockchainService.getPosition(positionId);
      if (!position.active) {
        throw new NotFoundException(`Position ${positionId} is not active`);
      }

      // Create transaction record
      transaction = await this.prisma.transaction.create({
        data: {
          positionId: positionId.toString(),
          type: TransactionType.MOVE_RANGE,
          status: TransactionStatus.PENDING,
          metadata: { newTickLower, newTickUpper, doSwap },
        },
      });

      // Execute move range
      const result = await this.blockchainService.moveRange(
        positionId,
        newTickLower,
        newTickUpper,
        doSwap,
      );

      // Update transaction with success
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          txHash: result.transactionHash,
          blockNumber: result.blockNumber,
          gasUsed: result.gasUsed,
        },
      });

      // Update position in database
      await this.syncPositionFromBlockchain(positionId);

      return {
        success: true,
        positionId: positionId.toString(),
        newRange: {
          tickLower: newTickLower,
          tickUpper: newTickUpper,
        },
        ...result,
      };
    } catch (error) {
      this.logger.error(`Error moving range for position ${positionId}:`, error);

      // Update transaction with failure
      if (transaction) {
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            errorMessage: error.message,
          },
        });
      }

      throw error;
    }
  }

  async closePosition(positionId: bigint, liquidity: bigint) {
    let transaction;

    try {
      // Validate position exists and is active
      const position = await this.blockchainService.getPosition(positionId);
      if (!position.active) {
        throw new NotFoundException(`Position ${positionId} is not active`);
      }

      // Create transaction record
      transaction = await this.prisma.transaction.create({
        data: {
          positionId: positionId.toString(),
          type: TransactionType.CLOSE_POSITION,
          status: TransactionStatus.PENDING,
          metadata: { liquidity: liquidity.toString() },
        },
      });

      // Execute close position
      const result = await this.blockchainService.closePosition(
        positionId,
        liquidity,
      );

      // Update transaction with success
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          txHash: result.transactionHash,
          blockNumber: result.blockNumber,
          gasUsed: result.gasUsed,
        },
      });

      // Update position in database
      await this.prisma.position.update({
        where: { positionId: positionId.toString() },
        data: { active: false },
      });

      return {
        success: true,
        positionId: positionId.toString(),
        liquidity: liquidity.toString(),
        ...result,
      };
    } catch (error) {
      this.logger.error(`Error closing position ${positionId}:`, error);

      // Update transaction with failure
      if (transaction) {
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            errorMessage: error.message,
          },
        });
      }

      throw error;
    }
  }

  async compound(positionId: bigint, doSwap: boolean) {
    let transaction;

    try {
      // Validate position exists and is active
      const position = await this.blockchainService.getPosition(positionId);
      if (!position.active) {
        throw new NotFoundException(`Position ${positionId} is not active`);
      }

      // Create transaction record
      transaction = await this.prisma.transaction.create({
        data: {
          positionId: positionId.toString(),
          type: TransactionType.COMPOUND,
          status: TransactionStatus.PENDING,
          metadata: { doSwap },
        },
      });

      // Execute compound
      const result = await this.blockchainService.compound(
        positionId,
        doSwap,
      );

      // Update transaction with success
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          txHash: result.transactionHash,
          blockNumber: result.blockNumber,
          gasUsed: result.gasUsed,
        },
      });

      // Update position in database
      await this.prisma.position.update({
        where: { positionId: positionId.toString() },
        data: {
          lastCompoundTxHash: result.transactionHash,
          lastCompoundAt: new Date(),
          compoundCount: { increment: 1 },
        },
      });

      return {
        success: true,
        positionId: positionId.toString(),
        ...result,
      };
    } catch (error) {
      this.logger.error(`Error compounding position ${positionId}:`, error);

      // Update transaction with failure
      if (transaction) {
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            errorMessage: error.message,
          },
        });
      }

      throw error;
    }
  }

  async getHealthStatus() {
    try {
      const blockNumber = await this.blockchainService.getCurrentBlock();
      const gasPrice = await this.blockchainService.getGasPrice();
      const positionCount = await this.prisma.position.count();
      const activePositionCount = await this.prisma.position.count({
        where: { active: true },
      });

      // Check Ponder indexer status
      const ponderStatus = await this.checkPonderStatus();
      
      // Check database connection pool
      const dbPoolStatus = await this.checkDatabasePool();

      // Verify contract addresses
      const contractsStatus = await this.checkContractsStatus();

      return {
        status: 'healthy',
        blockchain: {
          connected: true,
          blockNumber,
          gasPrice: gasPrice.toString(),
          contracts: contractsStatus,
        },
        database: {
          totalPositions: positionCount,
          activePositions: activePositionCount,
          pool: dbPoolStatus,
        },
        ponder: ponderStatus,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        blockchain: {
          connected: false,
        },
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async createOrSyncPosition(positionId: bigint) {
    try {
      this.logger.log(`Creating/syncing position ${positionId}`);
      
      // Sync position from blockchain
      const syncedPosition = await this.syncPositionFromBlockchain(positionId);
      
      return {
        ...syncedPosition,
        message: 'Position synced successfully',
      };
    } catch (error) {
      this.logger.error(`Error creating/syncing position ${positionId}:`, error);
      throw error;
    }
  }

  private async checkPonderStatus() {
    try {
      // Check if Ponder tables exist and have recent data
      const recentPosition = await this.prisma.ponderPosition.findFirst({
        orderBy: { updatedAt: 'desc' },
      });

      const lastIndexedBlock = recentPosition 
        ? Number(recentPosition.createdBlockNumber)
        : null;

      const ponderEventCount = await this.prisma.ponderRangeMoveEvent.count();

      return {
        active: true,
        lastIndexedBlock,
        totalEvents: ponderEventCount,
        lastUpdate: recentPosition 
          ? new Date(Number(recentPosition.updatedAt) * 1000).toISOString()
          : null,
      };
    } catch (error) {
      this.logger.warn('Ponder status check failed:', error);
      return {
        active: false,
        error: error.message,
      };
    }
  }

  private async checkDatabasePool() {
    try {
      // Simple query to check connection
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        connected: true,
        status: 'healthy',
      };
    } catch (error) {
      return {
        connected: false,
        status: 'unhealthy',
        error: error.message,
      };
    }
  }

  private async checkContractsStatus() {
    try {
      const lpManager = this.blockchainService.getLPManagerContract();
      const adapter = this.blockchainService.getAdapterContract();
      
      // Try to read from contracts to verify they're accessible
      const lpManagerAddress = await lpManager.getAddress();
      const adapterAddress = await adapter.getAddress();

      return {
        lpManager: {
          address: lpManagerAddress,
          accessible: true,
        },
        adapter: {
          address: adapterAddress,
          accessible: true,
        },
      };
    } catch (error) {
      return {
        lpManager: { accessible: false, error: error.message },
        adapter: { accessible: false, error: error.message },
      };
    }
  }

  // Helper Methods

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
      tickLower: Number(adapterPosition.tickLower),
      tickUpper: Number(adapterPosition.tickUpper),
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

  async getAllPositions(owner?: string) {
    return await this.prisma.position.findMany({
      where: {
        active: true,
        ...(owner && {
          owner: {
            equals: owner,
            mode: 'insensitive' as const,
          },
        }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPositionTransactions(positionId: string) {
    return await this.prisma.transaction.findMany({
      where: { positionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ========================================
  // Ponder Data Query Methods
  // Query historical indexed data from Ponder
  // ========================================

  /**
   * Get position history from Ponder indexed data
   * Returns all range move events for a position
   */
  async getPositionHistory(positionId: string) {
    const rangeMoves = await this.prisma.ponderRangeMoveEvent.findMany({
      where: {
        OR: [
          { oldPositionId: positionId },
          { newPositionId: positionId },
        ],
      },
      orderBy: { timestamp: 'desc' },
    });

    return rangeMoves.map(event => ({
      oldPositionId: event.oldPositionId,
      newPositionId: event.newPositionId,
      newTickLower: event.newTickLower,
      newTickUpper: event.newTickUpper,
      txHash: event.txHash,
      blockNumber: Number(event.blockNumber),
      timestamp: new Date(Number(event.timestamp) * 1000),
    }));
  }

  /**
   * Get compound events for a position from Ponder
   */
  async getPositionCompoundEvents(positionId: string) {
    const compounds = await this.prisma.ponderCompoundEvent.findMany({
      where: { positionId },
      orderBy: { timestamp: 'desc' },
    });

    return compounds.map(event => ({
      positionId: event.positionId,
      addedLiquidity: event.addedLiquidity,
      txHash: event.txHash,
      blockNumber: Number(event.blockNumber),
      timestamp: new Date(Number(event.timestamp) * 1000),
    }));
  }

  /**
   * Get close event for a position from Ponder
   */
  async getPositionCloseEvent(positionId: string) {
    const closeEvent = await this.prisma.ponderCloseEvent.findFirst({
      where: { positionId },
    });

    if (!closeEvent) {
      return null;
    }

    return {
      positionId: closeEvent.positionId,
      amount0: closeEvent.amount0,
      amount1: closeEvent.amount1,
      txHash: closeEvent.txHash,
      blockNumber: Number(closeEvent.blockNumber),
      timestamp: new Date(Number(closeEvent.timestamp) * 1000),
    };
  }

  /**
   * Get all indexed positions for an owner from Ponder
   */
  async getIndexedPositionsByOwner(owner: string) {
    return await this.prisma.ponderPosition.findMany({
      where: { owner: { equals: owner, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get complete position timeline with all events
   * Combines range moves, compounds, and close events
   */
  async getPositionTimeline(positionId: string) {
    const [rangeMoves, compounds, closeEvent] = await Promise.all([
      this.getPositionHistory(positionId),
      this.getPositionCompoundEvents(positionId),
      this.getPositionCloseEvent(positionId),
    ]);

    // Combine all events and sort by timestamp
    const timeline = [
      ...rangeMoves.map(e => ({ ...e, type: 'RANGE_MOVE' })),
      ...compounds.map(e => ({ ...e, type: 'COMPOUND' })),
      ...(closeEvent ? [{ ...closeEvent, type: 'CLOSE' }] : []),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return timeline;
  }
}
