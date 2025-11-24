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

  async getPosition(position_id: bigint) {
    try {
      // Query from Ponder indexed data (automatically synced from blockchain)
      const dbPosition = await this.prisma["ee__ponder_position"].findUnique({
        where: { id: position_id.toString() },
      });

      if (!dbPosition) {
        // Position not indexed yet or doesn't exist
        // Fallback to blockchain query for real-time data
        const blockchainPosition = await this.blockchainService.getPosition(position_id);

        if (!blockchainPosition.active && blockchainPosition.owner === '0x0000000000000000000000000000000000000000') {
          throw new NotFoundException(`Position ${position_id} not found`);
        }

        // Return blockchain data directly (Ponder will index it eventually)
        const adapterPosition = await this.blockchainService.getAdapterPosition(
          blockchainPosition.dexTokenId,
        );

        return {
          position_id: position_id.toString(),
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
      }

      return {
        position_id: dbPosition.id,
        protocol: dbPosition.protocol,
        dexTokenId: dbPosition.dex_token_id,
        owner: dbPosition.owner,
        token0: dbPosition.token0,
        token1: dbPosition.token1,
        active: dbPosition.active,
        tickLower: dbPosition.tick_lower,
        tickUpper: dbPosition.tick_upper,
        liquidity: dbPosition.liquidity,
      };
    } catch (error) {
      this.logger.error(`Error getting position ${position_id}:`, error);
      throw error;
    }
  }

  async getPositionDetails(position_id: bigint) {
    try {
      // Get position from LPManager
      const position = await this.blockchainService.getPosition(position_id);

      if (!position.active && position.owner === '0x0000000000000000000000000000000000000000') {
        throw new NotFoundException(`Position ${position_id} not found`);
      }

      // Get adapter position details
      const adapterPosition = await this.blockchainService.getAdapterPosition(
        position.dexTokenId,
      );

      return {
        position_id: position_id.toString(),
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
      this.logger.error(`Error getting position details ${position_id}:`, error);
      throw error;
    }
  }

  async moveRange(
    position_id: bigint,
    newTickLower: number,
    newTickUpper: number,
    doSwap: boolean,
  ) {
    let transaction;

    try {
      // Validate position exists and is active
      const position = await this.blockchainService.getPosition(position_id);
      if (!position.active) {
        throw new NotFoundException(`Position ${position_id} is not active`);
      }

      // Create transaction record
      transaction = await this.prisma.transactions.create({
        data: {
          id: crypto.randomUUID(),
          position_id: position_id.toString(),
          type: TransactionType.MOVE_RANGE,
          status: TransactionStatus.PENDING,
          metadata: { newTickLower, newTickUpper, doSwap },
        },
      });

      // Execute move range
      const result = await this.blockchainService.moveRange(
        position_id,
        newTickLower,
        newTickUpper,
        doSwap,
      );

      // Update transaction with success
      await this.prisma.transactions.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          tx_hash: result.transactionHash,
          block_number: result.blockNumber,
          gas_used: result.gasUsed,
        },
      });

      // Position will be automatically updated by Ponder indexer
      // No need to manually sync - Ponder watches for RangeMoved events

      return {
        success: true,
        position_id: position_id.toString(),
        newRange: {
          tickLower: newTickLower,
          tickUpper: newTickUpper,
        },
        ...result,
      };
    } catch (error) {
      this.logger.error(`Error moving range for position ${position_id}:`, error);

      // Update transaction with failure
      if (transaction) {
        await this.prisma.transactions.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            error_message: error.message,
          },
        });
      }

      throw error;
    }
  }

  async closePosition(position_id: bigint, liquidity: bigint) {
    let transaction;

    try {
      // Validate position exists and is active
      const position = await this.blockchainService.getPosition(position_id);
      if (!position.active) {
        throw new NotFoundException(`Position ${position_id} is not active`);
      }

      // Create transaction record
      transaction = await this.prisma.transactions.create({
        data: {
          id: crypto.randomUUID(),
          position_id: position_id.toString(),
          type: TransactionType.CLOSE_POSITION,
          status: TransactionStatus.PENDING,
          metadata: { liquidity: liquidity.toString() },
        },
      });

      // Execute close position
      const result = await this.blockchainService.closePosition(
        position_id,
        liquidity,
      );

      // Update transaction with success
      await this.prisma.transactions.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          tx_hash: result.transactionHash,
          block_number: result.blockNumber,
          gas_used: result.gasUsed,
        },
      });

      // Position will be automatically updated by Ponder indexer
      // Ponder watches for PositionClosed events and updates active status

      return {
        success: true,
        position_id: position_id.toString(),
        liquidity: liquidity.toString(),
        ...result,
      };
    } catch (error) {
      this.logger.error(`Error closing position ${position_id}:`, error);

      // Update transaction with failure
      if (transaction) {
        await this.prisma.transactions.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            error_message: error.message,
          },
        });
      }

      throw error;
    }
  }

  async compound(position_id: bigint, doSwap: boolean) {
    let transaction;

    try {
      // Validate position exists and is active
      const position = await this.blockchainService.getPosition(position_id);
      if (!position.active) {
        throw new NotFoundException(`Position ${position_id} is not active`);
      }

      // Create transaction record
      transaction = await this.prisma.transactions.create({
        data: {
          id: crypto.randomUUID(),
          position_id: position_id.toString(),
          type: TransactionType.COMPOUND,
          status: TransactionStatus.PENDING,
          metadata: { doSwap },
        },
      });

      // Execute compound
      const result = await this.blockchainService.compound(
        position_id,
        doSwap,
      );

      // Update transaction with success
      await this.prisma.transactions.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          tx_hash: result.transactionHash,
          block_number: result.blockNumber,
          gas_used: result.gasUsed,
        },
      });

      // Position will be automatically updated by Ponder indexer
      // Ponder watches for Compounded events and stores them in ponder_compound_event table

      return {
        success: true,
        position_id: position_id.toString(),
        ...result,
      };
    } catch (error) {
      this.logger.error(`Error compounding position ${position_id}:`, error);

      // Update transaction with failure
      if (transaction) {
        await this.prisma.transactions.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            error_message: error.message,
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
      // Query Ponder indexed positions
      const positionCount = await this.prisma["ee__ponder_position"].count();
      const activePositionCount = await this.prisma["ee__ponder_position"].count({
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

  /**
   * @deprecated This method is deprecated. Ponder indexer automatically syncs positions.
   * Use getPosition() instead - it will query from Ponder's indexed data.
   * This method is kept for backward compatibility only.
   */
  async createOrSyncPosition(position_id: bigint) {
    try {
      this.logger.warn(`[DEPRECATED] Manual sync called for position ${position_id}. Use Ponder indexer instead.`);

      // Fallback: check if position is already indexed by Ponder
      const ponderPosition = await this.prisma["ee__ponder_position"].findUnique({
        where: { id: position_id.toString() },
      });

      if (ponderPosition) {
        return {
          ...ponderPosition,
          message: 'Position already indexed by Ponder',
        };
      }

      // If not indexed yet, sync from blockchain as fallback
      const syncedPosition = await this.syncPositionFromBlockchain(position_id);

      return {
        ...syncedPosition,
        message: 'Position synced successfully (will be indexed by Ponder soon)',
      };
    } catch (error) {
      this.logger.error(`Error creating/syncing position ${position_id}:`, error);
      throw error;
    }
  }

  private async checkPonderStatus() {
    try {
      // Check if Ponder tables exist and have recent data
      const recentPosition = await this.prisma["ee__ponder_position"].findFirst({
        orderBy: { updated_at: 'desc' },
      });

      const lastIndexedBlock = recentPosition
        ? Number(recentPosition.created_block_number)
        : null;

      const ponderEventCount = await this.prisma["ponder_range_move_event"].count();

      return {
        active: true,
        lastIndexedBlock,
        totalEvents: ponderEventCount,
        lastUpdate: recentPosition
          ? new Date(Number(recentPosition.updated_at) * 1000).toISOString()
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

  /**
   * @deprecated This method is deprecated. Ponder indexer automatically syncs positions.
   * This method is kept for backward compatibility and fallback scenarios only.
   */
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
      tick_lower: Number(adapterPosition.tickLower),
      tick_upper: Number(adapterPosition.tickUpper),
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

  async getAllPositions(owner?: string) {
    try {
      // Try to query from Ponder indexed data
      // Note: Ponder tables will be created once the indexer processes blockchain events
      const ownerFilter = owner ? `AND LOWER(owner) = LOWER('${owner}')` : '';
      const positions: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT * FROM "3502__ponder_position"
         WHERE active = true
         ${ownerFilter}
         ORDER BY updated_at DESC`
      );

      // Convert PonderPosition format to expected Position format
      return positions.map(pos => ({
        position_id: pos.id,
        protocol: pos.protocol,
        dexTokenId: pos.dex_token_id,
        owner: pos.owner,
        token0: pos.token0,
        token1: pos.token1,
        active: pos.active,
        tickLower: pos.tick_lower,
        tickUpper: pos.tick_upper,
        liquidity: pos.liquidity,
        createdAt: new Date(Number(pos.created_at) * 1000),
        updatedAt: new Date(Number(pos.updated_at) * 1000),
      }));
    } catch (error) {
      // Ponder tables don't exist yet or no positions indexed
      this.logger.warn(`Ponder tables not available yet: ${error.message}`);
      this.logger.log('Positions will appear once Ponder indexer processes blockchain events');

      // Return empty array - positions will be indexed when created on-chain
      return [];
    }
  }

  async getPositionTransactions(position_id: string) {
    return await this.prisma.transactions.findMany({
      where: { position_id },
      orderBy: { created_at: 'desc' },
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
  async getPositionHistory(position_id: string) {
    const rangeMoves = await this.prisma["ponder_range_move_event"].findMany({
      where: {
        OR: [
          { old_position_id: position_id },
          { new_position_id: position_id },
        ],
      },
      orderBy: { timestamp: 'desc' },
    });

    return rangeMoves.map(event => ({
      oldPositionId: event.old_position_id,
      newPositionId: event.new_position_id,
      newTickLower: event.new_tick_lower,
      newTickUpper: event.new_tick_upper,
      tx_hash: event.tx_hash,
      block_number: Number(event.block_number),
      timestamp: new Date(Number(event.timestamp) * 1000),
    }));
  }

  /**
   * Get compound events for a position from Ponder
   */
  async getPositionCompoundEvents(position_id: string) {
    const compounds = await this.prisma["ponder_compound_event"].findMany({
      where: { position_id },
      orderBy: { timestamp: 'desc' },
    });

    return compounds.map(event => ({
      position_id: event.position_id,
      addedLiquidity: event.added_liquidity,
      tx_hash: event.tx_hash,
      block_number: Number(event.block_number),
      timestamp: new Date(Number(event.timestamp) * 1000),
    }));
  }

  /**
   * Get close event for a position from Ponder
   */
  async getPositionCloseEvent(position_id: string) {
    const closeEvent = await this.prisma["ponder_close_event"].findFirst({
      where: { position_id },
    });

    if (!closeEvent) {
      return null;
    }

    return {
      position_id: closeEvent.position_id,
      amount0: closeEvent.amount0,
      amount1: closeEvent.amount1,
      tx_hash: closeEvent.tx_hash,
      block_number: Number(closeEvent.block_number),
      timestamp: new Date(Number(closeEvent.timestamp) * 1000),
    };
  }

  /**
   * Get all indexed positions for an owner from Ponder
   */
  async getIndexedPositionsByOwner(owner: string) {
    return await this.prisma["ee__ponder_position"].findMany({
      where: { owner: { equals: owner, mode: 'insensitive' } },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Get complete position timeline with all events
   * Combines range moves, compounds, and close events
   */
  async getPositionTimeline(position_id: string) {
    const [rangeMoves, compounds, closeEvent] = await Promise.all([
      this.getPositionHistory(position_id),
      this.getPositionCompoundEvents(position_id),
      this.getPositionCloseEvent(position_id),
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
