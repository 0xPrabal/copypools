import { Test, TestingModule } from '@nestjs/testing';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';
import { NotFoundException } from '@nestjs/common';

describe('PositionsController', () => {
  let controller: PositionsController;
  let service: PositionsService;

  const mockPositionsService = {
    getPosition: jest.fn(),
    getPositionDetails: jest.fn(),
    moveRange: jest.fn(),
    closePosition: jest.fn(),
    compound: jest.fn(),
    getHealthStatus: jest.fn(),
    getAllPositions: jest.fn(),
    getPositionTransactions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PositionsController],
      providers: [
        {
          provide: PositionsService,
          useValue: mockPositionsService,
        },
      ],
    }).compile();

    controller = module.get<PositionsController>(PositionsController);
    service = module.get<PositionsService>(PositionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPosition', () => {
    it('should return a position by id', async () => {
      const mockPosition = {
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

      mockPositionsService.getPosition.mockResolvedValue(mockPosition);

      const result = await controller.getPosition('1');

      expect(result).toEqual(mockPosition);
      expect(mockPositionsService.getPosition).toHaveBeenCalledWith(1n);
    });

    it('should throw NotFoundException when position not found', async () => {
      mockPositionsService.getPosition.mockRejectedValue(
        new NotFoundException('Position not found'),
      );

      await expect(controller.getPosition('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPositionDetails', () => {
    it('should return detailed position information', async () => {
      const mockDetails = {
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
      };

      mockPositionsService.getPositionDetails.mockResolvedValue(mockDetails);

      const result = await controller.getPositionDetails('1');

      expect(result).toEqual(mockDetails);
      expect(mockPositionsService.getPositionDetails).toHaveBeenCalledWith(1n);
    });
  });

  describe('moveRange', () => {
    it('should move range with all parameters', async () => {
      const mockResult = {
        success: true,
        positionId: '1',
        newRange: {
          tickLower: -2000,
          tickUpper: 2000,
        },
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      mockPositionsService.moveRange.mockResolvedValue(mockResult);

      const result = await controller.moveRange('1', {
        tickLower: -2000,
        tickUpper: 2000,
        doSwap: true,
      });

      expect(result).toEqual(mockResult);
      expect(mockPositionsService.moveRange).toHaveBeenCalledWith(1n, -2000, 2000, true);
    });

    it('should move range with default doSwap=false', async () => {
      const mockResult = {
        success: true,
        positionId: '1',
        newRange: {
          tickLower: -2000,
          tickUpper: 2000,
        },
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      mockPositionsService.moveRange.mockResolvedValue(mockResult);

      const result = await controller.moveRange('1', {
        tickLower: -2000,
        tickUpper: 2000,
      });

      expect(result).toEqual(mockResult);
      expect(mockPositionsService.moveRange).toHaveBeenCalledWith(1n, -2000, 2000, false);
    });

    it('should throw NotFoundException for inactive position', async () => {
      mockPositionsService.moveRange.mockRejectedValue(
        new NotFoundException('Position 1 is not active'),
      );

      await expect(
        controller.moveRange('1', {
          tickLower: -2000,
          tickUpper: 2000,
          doSwap: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('closePosition', () => {
    it('should close position successfully', async () => {
      const mockResult = {
        success: true,
        positionId: '1',
        liquidity: '1000000',
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      mockPositionsService.closePosition.mockResolvedValue(mockResult);

      const result = await controller.closePosition('1', {
        liquidity: '1000000',
      });

      expect(result).toEqual(mockResult);
      expect(mockPositionsService.closePosition).toHaveBeenCalledWith(1n, 1000000n);
    });

    it('should handle large liquidity values', async () => {
      const mockResult = {
        success: true,
        positionId: '1',
        liquidity: '999999999999999999999',
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      mockPositionsService.closePosition.mockResolvedValue(mockResult);

      const result = await controller.closePosition('1', {
        liquidity: '999999999999999999999',
      });

      expect(result).toEqual(mockResult);
      expect(mockPositionsService.closePosition).toHaveBeenCalledWith(
        1n,
        999999999999999999999n,
      );
    });
  });

  describe('compound', () => {
    it('should compound position with doSwap=true', async () => {
      const mockResult = {
        success: true,
        positionId: '1',
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      mockPositionsService.compound.mockResolvedValue(mockResult);

      const result = await controller.compound('1', { doSwap: true });

      expect(result).toEqual(mockResult);
      expect(mockPositionsService.compound).toHaveBeenCalledWith(1n, true);
    });

    it('should compound position with default doSwap=false', async () => {
      const mockResult = {
        success: true,
        positionId: '1',
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      };

      mockPositionsService.compound.mockResolvedValue(mockResult);

      const result = await controller.compound('1', {});

      expect(result).toEqual(mockResult);
      expect(mockPositionsService.compound).toHaveBeenCalledWith(1n, false);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status', async () => {
      const mockHealth = {
        status: 'healthy',
        blockchain: {
          connected: true,
          blockNumber: 12345,
          gasPrice: '1000000',
        },
        database: {
          totalPositions: 10,
          activePositions: 7,
        },
        timestamp: new Date().toISOString(),
      };

      mockPositionsService.getHealthStatus.mockResolvedValue(mockHealth);

      const result = await controller.getHealthStatus();

      expect(result).toEqual(mockHealth);
      expect(result.status).toBe('healthy');
      expect(result.blockchain.connected).toBe(true);
    });

    it('should return unhealthy status', async () => {
      const mockHealth = {
        status: 'unhealthy',
        blockchain: {
          connected: false,
        },
        error: 'Connection failed',
        timestamp: new Date().toISOString(),
      };

      mockPositionsService.getHealthStatus.mockResolvedValue(mockHealth);

      const result = await controller.getHealthStatus();

      expect(result).toEqual(mockHealth);
      expect(result.status).toBe('unhealthy');
      expect(result.blockchain.connected).toBe(false);
    });
  });

  describe('getAllPositions', () => {
    it('should return all positions without owner filter', async () => {
      const mockPositions = [
        { positionId: '1', owner: '0xOwner1', active: true },
        { positionId: '2', owner: '0xOwner2', active: false },
      ];

      mockPositionsService.getAllPositions.mockResolvedValue(mockPositions);

      const result = await controller.getAllPositions();

      expect(result).toEqual(mockPositions);
      expect(mockPositionsService.getAllPositions).toHaveBeenCalledWith(undefined);
    });

    it('should return positions filtered by owner', async () => {
      const mockPositions = [{ positionId: '1', owner: '0xOwner1', active: true }];

      mockPositionsService.getAllPositions.mockResolvedValue(mockPositions);

      const result = await controller.getAllPositions('0xOwner1');

      expect(result).toEqual(mockPositions);
      expect(mockPositionsService.getAllPositions).toHaveBeenCalledWith('0xOwner1');
    });

    it('should handle case-insensitive owner search', async () => {
      const mockPositions = [{ positionId: '1', owner: '0xOwner1', active: true }];

      mockPositionsService.getAllPositions.mockResolvedValue(mockPositions);

      const result = await controller.getAllPositions('0xOWNER1');

      expect(result).toEqual(mockPositions);
      expect(mockPositionsService.getAllPositions).toHaveBeenCalledWith('0xOWNER1');
    });
  });

  describe('getPositionTransactions', () => {
    it('should return transaction history for a position', async () => {
      const mockTransactions = [
        {
          id: 1,
          positionId: '1',
          type: 'COMPOUND',
          status: 'SUCCESS',
          txHash: '0xtx1',
          blockNumber: 12345,
        },
        {
          id: 2,
          positionId: '1',
          type: 'MOVE_RANGE',
          status: 'SUCCESS',
          txHash: '0xtx2',
          blockNumber: 12346,
        },
      ];

      mockPositionsService.getPositionTransactions.mockResolvedValue(mockTransactions);

      const result = await controller.getPositionTransactions('1');

      expect(result).toEqual(mockTransactions);
      expect(mockPositionsService.getPositionTransactions).toHaveBeenCalledWith('1');
    });

    it('should return empty array for position with no transactions', async () => {
      mockPositionsService.getPositionTransactions.mockResolvedValue([]);

      const result = await controller.getPositionTransactions('999');

      expect(result).toEqual([]);
      expect(mockPositionsService.getPositionTransactions).toHaveBeenCalledWith('999');
    });
  });
});
