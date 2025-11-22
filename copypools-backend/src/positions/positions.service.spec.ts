import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PositionsService } from './positions.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, TransactionStatus } from '@prisma/client';

describe('PositionsService', () => {
  let service: PositionsService;
  let blockchainService: BlockchainService;
  let prismaService: PrismaService;

  const mockBlockchainService = {
    getPosition: jest.fn(),
    getAdapterPosition: jest.fn(),
    moveRange: jest.fn(),
    closePosition: jest.fn(),
    compound: jest.fn(),
    getCurrentBlock: jest.fn(),
    getGasPrice: jest.fn(),
  };

  const mockPrismaService = {
    position: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    ponderRangeMoveEvent: {
      findMany: jest.fn(),
    },
    ponderCompoundEvent: {
      findMany: jest.fn(),
    },
    ponderCloseEvent: {
      findFirst: jest.fn(),
    },
    ponderPosition: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionsService,
        {
          provide: BlockchainService,
          useValue: mockBlockchainService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PositionsService>(PositionsService);
    blockchainService = module.get<BlockchainService>(BlockchainService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPosition', () => {
    it('should return position from database if exists', async () => {
      const mockDbPosition = {
        positionId: '1',
        protocol: 'uniswapv4',
        dexTokenId: '123',
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: true,
        tickLower: -1000,
        tickUpper: 1000,
        liquidity: '1000000',
      };

      mockPrismaService.position.findUnique.mockResolvedValue(mockDbPosition);

      const result = await service.getPosition(1n);

      expect(result).toEqual(mockDbPosition);
      expect(mockPrismaService.position.findUnique).toHaveBeenCalledWith({
        where: { positionId: '1' },
      });
    });

    it('should fetch from blockchain and save if not in database', async () => {
      mockPrismaService.position.findUnique.mockResolvedValue(null);

      const mockBlockchainPosition = {
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: true,
      };

      const mockAdapterPosition = {
        key: 'key123',
        owner: '0xOwner',
        tickLower: -1000n,
        tickUpper: 1000n,
        liquidity: 1000000n,
      };

      const mockSavedPosition = {
        positionId: '1',
        protocol: 'uniswapv4',
        dexTokenId: '123',
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: true,
        tickLower: -1000,
        tickUpper: 1000,
        liquidity: '1000000',
      };

      mockBlockchainService.getPosition.mockResolvedValue(mockBlockchainPosition);
      mockBlockchainService.getAdapterPosition.mockResolvedValue(mockAdapterPosition);
      mockPrismaService.position.upsert.mockResolvedValue(mockSavedPosition);

      const result = await service.getPosition(1n);

      expect(result).toEqual(mockSavedPosition);
      expect(mockBlockchainService.getPosition).toHaveBeenCalledWith(1n);
      expect(mockBlockchainService.getAdapterPosition).toHaveBeenCalledWith(123n);
    });

    it('should throw NotFoundException for inactive position with zero address', async () => {
      mockPrismaService.position.findUnique.mockResolvedValue(null);

      mockBlockchainService.getPosition.mockResolvedValue({
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0x0000000000000000000000000000000000000000',
        token0: '0xToken0',
        token1: '0xToken1',
        active: false,
      });

      await expect(service.getPosition(1n)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPositionDetails', () => {
    it('should return detailed position information', async () => {
      const mockPosition = {
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: true,
      };

      const mockAdapterPosition = {
        key: 'key123',
        owner: '0xOwner',
        tickLower: -1000n,
        tickUpper: 1000n,
        liquidity: 1000000n,
      };

      mockBlockchainService.getPosition.mockResolvedValue(mockPosition);
      mockBlockchainService.getAdapterPosition.mockResolvedValue(mockAdapterPosition);

      const result = await service.getPositionDetails(1n);

      expect(result).toEqual({
        positionId: '1',
        protocol: 'uniswapv4',
        owner: '0xOwner',
        active: true,
        tokens: {
          token0: '0xToken0',
          token1: '0xToken1',
        },
        liquidity: {
          total: '1000000',
          tickLower: -1000,
          tickUpper: 1000,
        },
        dexTokenId: '123',
      });
    });

    it('should throw NotFoundException for inactive position', async () => {
      mockBlockchainService.getPosition.mockResolvedValue({
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0x0000000000000000000000000000000000000000',
        token0: '0xToken0',
        token1: '0xToken1',
        active: false,
      });

      await expect(service.getPositionDetails(1n)).rejects.toThrow(NotFoundException);
    });
  });

  describe('moveRange', () => {
    it('should move range successfully', async () => {
      const mockPosition = {
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: true,
      };

      const mockTransaction = {
        id: 1,
        positionId: '1',
        type: TransactionType.MOVE_RANGE,
        status: TransactionStatus.PENDING,
      };

      const mockResult = {
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      const mockAdapterPosition = {
        key: 'key123',
        owner: '0xOwner',
        tickLower: -2000n,
        tickUpper: 2000n,
        liquidity: 1000000n,
      };

      mockBlockchainService.getPosition.mockResolvedValue(mockPosition);
      mockPrismaService.transaction.create.mockResolvedValue(mockTransaction);
      mockBlockchainService.moveRange.mockResolvedValue(mockResult);
      mockPrismaService.transaction.update.mockResolvedValue({});
      mockBlockchainService.getAdapterPosition.mockResolvedValue(mockAdapterPosition);
      mockPrismaService.position.upsert.mockResolvedValue({});

      const result = await service.moveRange(1n, -2000, 2000, false);

      expect(result).toEqual({
        success: true,
        positionId: '1',
        newRange: {
          tickLower: -2000,
          tickUpper: 2000,
        },
        ...mockResult,
      });
      expect(mockBlockchainService.moveRange).toHaveBeenCalledWith(1n, -2000, 2000, false);
    });

    it('should throw NotFoundException for inactive position', async () => {
      mockBlockchainService.getPosition.mockResolvedValue({
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: false,
      });

      await expect(service.moveRange(1n, -2000, 2000, false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update transaction status to FAILED on error', async () => {
      const mockTransaction = { id: 1 };

      mockBlockchainService.getPosition.mockResolvedValue({ active: true });
      mockPrismaService.transaction.create.mockResolvedValue(mockTransaction);
      mockBlockchainService.moveRange.mockRejectedValue(new Error('Blockchain error'));

      await expect(service.moveRange(1n, -2000, 2000, false)).rejects.toThrow(
        'Blockchain error',
      );
      expect(mockPrismaService.transaction.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          status: TransactionStatus.FAILED,
          errorMessage: 'Blockchain error',
        },
      });
    });
  });

  describe('closePosition', () => {
    it('should close position successfully', async () => {
      const mockPosition = {
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: true,
      };

      const mockTransaction = {
        id: 1,
        positionId: '1',
        type: TransactionType.CLOSE_POSITION,
        status: TransactionStatus.PENDING,
      };

      const mockResult = {
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      mockBlockchainService.getPosition.mockResolvedValue(mockPosition);
      mockPrismaService.transaction.create.mockResolvedValue(mockTransaction);
      mockBlockchainService.closePosition.mockResolvedValue(mockResult);
      mockPrismaService.transaction.update.mockResolvedValue({});
      mockPrismaService.position.update.mockResolvedValue({});

      const result = await service.closePosition(1n, 1000000n);

      expect(result).toEqual({
        success: true,
        positionId: '1',
        liquidity: '1000000',
        ...mockResult,
      });
      expect(mockBlockchainService.closePosition).toHaveBeenCalledWith(1n, 1000000n);
      expect(mockPrismaService.position.update).toHaveBeenCalledWith({
        where: { positionId: '1' },
        data: { active: false },
      });
    });

    it('should throw NotFoundException for inactive position', async () => {
      mockBlockchainService.getPosition.mockResolvedValue({ active: false });

      await expect(service.closePosition(1n, 1000000n)).rejects.toThrow(NotFoundException);
    });
  });

  describe('compound', () => {
    it('should compound position successfully', async () => {
      const mockPosition = {
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: true,
      };

      const mockTransaction = {
        id: 1,
        positionId: '1',
        type: TransactionType.COMPOUND,
        status: TransactionStatus.PENDING,
      };

      const mockResult = {
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      mockBlockchainService.getPosition.mockResolvedValue(mockPosition);
      mockPrismaService.transaction.create.mockResolvedValue(mockTransaction);
      mockBlockchainService.compound.mockResolvedValue(mockResult);
      mockPrismaService.transaction.update.mockResolvedValue({});
      mockPrismaService.position.update.mockResolvedValue({});

      const result = await service.compound(1n, false);

      expect(result).toEqual({
        success: true,
        positionId: '1',
        ...mockResult,
      });
      expect(mockBlockchainService.compound).toHaveBeenCalledWith(1n, false);
      expect(mockPrismaService.position.update).toHaveBeenCalledWith({
        where: { positionId: '1' },
        data: {
          lastCompoundTxHash: '0xtxhash',
          lastCompoundAt: expect.any(Date),
          compoundCount: { increment: 1 },
        },
      });
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status', async () => {
      mockBlockchainService.getCurrentBlock.mockResolvedValue(12345);
      mockBlockchainService.getGasPrice.mockResolvedValue(1000000n);
      mockPrismaService.position.count.mockResolvedValueOnce(10);
      mockPrismaService.position.count.mockResolvedValueOnce(7);

      const result = await service.getHealthStatus();

      expect(result.status).toBe('healthy');
      expect(result.blockchain.connected).toBe(true);
      expect(result.blockchain.blockNumber).toBe(12345);
      expect(result.blockchain.gasPrice).toBe('1000000');
      expect(result.database.totalPositions).toBe(10);
      expect(result.database.activePositions).toBe(7);
    });

    it('should return unhealthy status on error', async () => {
      mockBlockchainService.getCurrentBlock.mockRejectedValue(
        new Error('Connection failed'),
      );

      const result = await service.getHealthStatus();

      expect(result.status).toBe('unhealthy');
      expect(result.blockchain.connected).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('getAllPositions', () => {
    it('should return all positions', async () => {
      const mockPositions = [
        { positionId: '1', owner: '0xOwner1', active: true },
        { positionId: '2', owner: '0xOwner2', active: false },
      ];

      mockPrismaService.position.findMany.mockResolvedValue(mockPositions);

      const result = await service.getAllPositions();

      expect(result).toEqual(mockPositions);
      expect(mockPrismaService.position.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter positions by owner', async () => {
      const mockPositions = [{ positionId: '1', owner: '0xOwner1', active: true }];

      mockPrismaService.position.findMany.mockResolvedValue(mockPositions);

      const result = await service.getAllPositions('0xOwner1');

      expect(result).toEqual(mockPositions);
      expect(mockPrismaService.position.findMany).toHaveBeenCalledWith({
        where: { owner: { equals: '0xOwner1', mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getPositionTransactions', () => {
    it('should return transactions for a position', async () => {
      const mockTransactions = [
        { id: 1, positionId: '1', type: TransactionType.COMPOUND },
        { id: 2, positionId: '1', type: TransactionType.MOVE_RANGE },
      ];

      mockPrismaService.transaction.findMany.mockResolvedValue(mockTransactions);

      const result = await service.getPositionTransactions('1');

      expect(result).toEqual(mockTransactions);
      expect(mockPrismaService.transaction.findMany).toHaveBeenCalledWith({
        where: { positionId: '1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('Ponder Data Query Methods', () => {
    it('should get position history', async () => {
      const mockRangeMoves = [
        {
          oldPositionId: '1',
          newPositionId: '2',
          newTickLower: -2000,
          newTickUpper: 2000,
          txHash: '0xtx1',
          blockNumber: 12345n,
          timestamp: 1234567890n,
        },
      ];

      mockPrismaService.ponderRangeMoveEvent.findMany.mockResolvedValue(mockRangeMoves);

      const result = await service.getPositionHistory('1');

      expect(result).toHaveLength(1);
      expect(result[0].oldPositionId).toBe('1');
      expect(result[0].timestamp).toBeInstanceOf(Date);
    });

    it('should get position compound events', async () => {
      const mockCompounds = [
        {
          positionId: '1',
          addedLiquidity: '1000000',
          txHash: '0xtx1',
          blockNumber: 12345n,
          timestamp: 1234567890n,
        },
      ];

      mockPrismaService.ponderCompoundEvent.findMany.mockResolvedValue(mockCompounds);

      const result = await service.getPositionCompoundEvents('1');

      expect(result).toHaveLength(1);
      expect(result[0].positionId).toBe('1');
    });

    it('should get position close event', async () => {
      const mockCloseEvent = {
        positionId: '1',
        amount0: '1000',
        amount1: '2000',
        txHash: '0xtx1',
        blockNumber: 12345n,
        timestamp: 1234567890n,
      };

      mockPrismaService.ponderCloseEvent.findFirst.mockResolvedValue(mockCloseEvent);

      const result = await service.getPositionCloseEvent('1');

      expect(result).toBeDefined();
      expect(result.positionId).toBe('1');
    });

    it('should return null if no close event found', async () => {
      mockPrismaService.ponderCloseEvent.findFirst.mockResolvedValue(null);

      const result = await service.getPositionCloseEvent('1');

      expect(result).toBeNull();
    });

    it('should get indexed positions by owner', async () => {
      const mockPositions = [
        { positionId: '1', owner: '0xOwner1' },
        { positionId: '2', owner: '0xOwner1' },
      ];

      mockPrismaService.ponderPosition.findMany.mockResolvedValue(mockPositions);

      const result = await service.getIndexedPositionsByOwner('0xOwner1');

      expect(result).toEqual(mockPositions);
    });

    it('should get complete position timeline', async () => {
      mockPrismaService.ponderRangeMoveEvent.findMany.mockResolvedValue([
        {
          oldPositionId: '1',
          newPositionId: '2',
          newTickLower: -2000,
          newTickUpper: 2000,
          txHash: '0xtx1',
          blockNumber: 12345n,
          timestamp: 1234567890n,
        },
      ]);

      mockPrismaService.ponderCompoundEvent.findMany.mockResolvedValue([
        {
          positionId: '1',
          addedLiquidity: '1000000',
          txHash: '0xtx2',
          blockNumber: 12346n,
          timestamp: 1234567891n,
        },
      ]);

      mockPrismaService.ponderCloseEvent.findFirst.mockResolvedValue({
        positionId: '1',
        amount0: '1000',
        amount1: '2000',
        txHash: '0xtx3',
        blockNumber: 12347n,
        timestamp: 1234567892n,
      });

      const result = await service.getPositionTimeline('1');

      expect(result).toHaveLength(3);
      expect(result.some(e => e.type === 'RANGE_MOVE')).toBe(true);
      expect(result.some(e => e.type === 'COMPOUND')).toBe(true);
      expect(result.some(e => e.type === 'CLOSE')).toBe(true);
    });
  });
});
