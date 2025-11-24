import { Test, TestingModule } from '@nestjs/testing';
import { EventMonitorService } from './event-monitor.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventType } from '@prisma/client';

describe('EventMonitorService', () => {
  let service: EventMonitorService;
  let blockchainService: BlockchainService;
  let prismaService: PrismaService;

  let positionCreatedCallback: (event: any) => Promise<void>;
  let rangeMovedCallback: (event: any) => Promise<void>;
  let positionClosedCallback: (event: any) => Promise<void>;

  const mockBlockchainService = {
    listenToPositionCreated: jest.fn((callback) => {
      positionCreatedCallback = callback;
      return Promise.resolve();
    }),
    listenToRangeMoved: jest.fn((callback) => {
      rangeMovedCallback = callback;
      return Promise.resolve();
    }),
    listenToPositionClosed: jest.fn((callback) => {
      positionClosedCallback = callback;
      return Promise.resolve();
    }),
    getPosition: jest.fn(),
    getAdapterPosition: jest.fn(),
  };

  const mockPrismaService = {
    blockchainEvent: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    position: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventMonitorService,
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

    service = module.get<EventMonitorService>(EventMonitorService);
    blockchainService = module.get<BlockchainService>(BlockchainService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Initialize event listeners
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should setup all event listeners', async () => {
      expect(mockBlockchainService.listenToPositionCreated).toHaveBeenCalled();
      expect(mockBlockchainService.listenToRangeMoved).toHaveBeenCalled();
      expect(mockBlockchainService.listenToPositionClosed).toHaveBeenCalled();
    });
  });

  describe('PositionOpened Event Handler', () => {
    it('should process position opened event', async () => {
      const mockEvent = {
        positionId: '1',
        owner: '0xOwner',
        protocol: 'uniswapv4',
        transactionHash: '0xtxhash',
        blockNumber: 12345,
      };

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

      mockPrismaService.blockchainEvent.create.mockResolvedValue({});
      mockBlockchainService.getPosition.mockResolvedValue(mockPosition);
      mockBlockchainService.getAdapterPosition.mockResolvedValue(mockAdapterPosition);
      mockPrismaService.position.upsert.mockResolvedValue({});
      mockPrismaService.blockchainEvent.updateMany.mockResolvedValue({});

      await positionCreatedCallback(mockEvent);

      expect(mockPrismaService.blockchainEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: EventType.POSITION_OPENED,
          positionId: '1',
          txHash: '0xtxhash',
          blockNumber: 12345,
          logIndex: 0,
          eventData: {
            owner: '0xOwner',
            protocol: 'uniswapv4',
          },
          processed: false,
        },
      });

      expect(mockBlockchainService.getPosition).toHaveBeenCalledWith(1n);
      expect(mockPrismaService.position.upsert).toHaveBeenCalled();
      expect(mockPrismaService.blockchainEvent.updateMany).toHaveBeenCalledWith({
        where: {
          txHash: '0xtxhash',
          eventType: EventType.POSITION_OPENED,
        },
        data: { processed: true },
      });
    });

    it('should handle errors in position opened event processing', async () => {
      const mockEvent = {
        positionId: '1',
        owner: '0xOwner',
        protocol: 'uniswapv4',
        transactionHash: '0xtxhash',
        blockNumber: 12345,
      };

      mockPrismaService.blockchainEvent.create.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw - errors are caught and logged
      await expect(positionCreatedCallback(mockEvent)).resolves.not.toThrow();
    });
  });

  describe('RangeMoved Event Handler', () => {
    it('should process range moved event', async () => {
      const mockEvent = {
        oldPositionId: '1',
        newPositionId: '2',
        newTickLower: -2000,
        newTickUpper: 2000,
        transactionHash: '0xtxhash',
        blockNumber: 12345,
      };

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
        tickLower: -2000n,
        tickUpper: 2000n,
        liquidity: 1000000n,
      };

      mockPrismaService.blockchainEvent.create.mockResolvedValue({});
      mockPrismaService.position.updateMany.mockResolvedValue({});
      mockBlockchainService.getPosition.mockResolvedValue(mockPosition);
      mockBlockchainService.getAdapterPosition.mockResolvedValue(mockAdapterPosition);
      mockPrismaService.position.upsert.mockResolvedValue({});
      mockPrismaService.blockchainEvent.updateMany.mockResolvedValue({});

      await rangeMovedCallback(mockEvent);

      expect(mockPrismaService.blockchainEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: EventType.RANGE_MOVED,
          positionId: '2',
          txHash: '0xtxhash',
          blockNumber: 12345,
          logIndex: 0,
          eventData: {
            oldPositionId: '1',
            newPositionId: '2',
            newTickLower: -2000,
            newTickUpper: 2000,
          },
          processed: false,
        },
      });

      // Should deactivate old position
      expect(mockPrismaService.position.updateMany).toHaveBeenCalledWith({
        where: { positionId: '1' },
        data: { active: false },
      });

      // Should sync new position
      expect(mockBlockchainService.getPosition).toHaveBeenCalledWith(2n);
      expect(mockPrismaService.position.upsert).toHaveBeenCalled();
    });

    it('should handle errors in range moved event processing', async () => {
      const mockEvent = {
        oldPositionId: '1',
        newPositionId: '2',
        newTickLower: -2000,
        newTickUpper: 2000,
        transactionHash: '0xtxhash',
        blockNumber: 12345,
      };

      mockPrismaService.blockchainEvent.create.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(rangeMovedCallback(mockEvent)).resolves.not.toThrow();
    });
  });

  describe('PositionClosed Event Handler', () => {
    it('should process position closed event', async () => {
      const mockEvent = {
        positionId: '1',
        amount0: '1000',
        amount1: '2000',
        transactionHash: '0xtxhash',
        blockNumber: 12345,
      };

      mockPrismaService.blockchainEvent.create.mockResolvedValue({});
      mockPrismaService.position.updateMany.mockResolvedValue({});
      mockPrismaService.blockchainEvent.updateMany.mockResolvedValue({});

      await positionClosedCallback(mockEvent);

      expect(mockPrismaService.blockchainEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: EventType.POSITION_CLOSED,
          positionId: '1',
          txHash: '0xtxhash',
          blockNumber: 12345,
          logIndex: 0,
          eventData: {
            amount0: '1000',
            amount1: '2000',
          },
          processed: false,
        },
      });

      expect(mockPrismaService.position.updateMany).toHaveBeenCalledWith({
        where: { positionId: '1' },
        data: { active: false },
      });

      expect(mockPrismaService.blockchainEvent.updateMany).toHaveBeenCalledWith({
        where: {
          txHash: '0xtxhash',
          eventType: EventType.POSITION_CLOSED,
        },
        data: { processed: true },
      });
    });

    it('should handle errors in position closed event processing', async () => {
      const mockEvent = {
        positionId: '1',
        amount0: '1000',
        amount1: '2000',
        transactionHash: '0xtxhash',
        blockNumber: 12345,
      };

      mockPrismaService.blockchainEvent.create.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(positionClosedCallback(mockEvent)).resolves.not.toThrow();
    });
  });

  describe('getEvents', () => {
    it('should get all events without filters', async () => {
      const mockEvents = [
        { id: 1, eventType: EventType.POSITION_OPENED, positionId: '1' },
        { id: 2, eventType: EventType.RANGE_MOVED, positionId: '2' },
      ];

      mockPrismaService.blockchainEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.getEvents();

      expect(result).toEqual(mockEvents);
      expect(mockPrismaService.blockchainEvent.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ blockNumber: 'desc' }, { logIndex: 'desc' }],
      });
    });

    it('should get events filtered by positionId', async () => {
      const mockEvents = [
        { id: 1, eventType: EventType.POSITION_OPENED, positionId: '1' },
      ];

      mockPrismaService.blockchainEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.getEvents('1');

      expect(result).toEqual(mockEvents);
      expect(mockPrismaService.blockchainEvent.findMany).toHaveBeenCalledWith({
        where: { positionId: '1' },
        orderBy: [{ blockNumber: 'desc' }, { logIndex: 'desc' }],
      });
    });

    it('should get events filtered by eventType', async () => {
      const mockEvents = [
        { id: 1, eventType: EventType.COMPOUND, positionId: '1' },
      ];

      mockPrismaService.blockchainEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.getEvents(undefined, EventType.COMPOUND);

      expect(result).toEqual(mockEvents);
      expect(mockPrismaService.blockchainEvent.findMany).toHaveBeenCalledWith({
        where: { eventType: EventType.COMPOUND },
        orderBy: [{ blockNumber: 'desc' }, { logIndex: 'desc' }],
      });
    });

    it('should get events filtered by both positionId and eventType', async () => {
      const mockEvents = [
        { id: 1, eventType: EventType.COMPOUND, positionId: '1' },
      ];

      mockPrismaService.blockchainEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.getEvents('1', EventType.COMPOUND);

      expect(result).toEqual(mockEvents);
      expect(mockPrismaService.blockchainEvent.findMany).toHaveBeenCalledWith({
        where: { positionId: '1', eventType: EventType.COMPOUND },
        orderBy: [{ blockNumber: 'desc' }, { logIndex: 'desc' }],
      });
    });
  });

  describe('getUnprocessedEvents', () => {
    it('should get all unprocessed events', async () => {
      const mockEvents = [
        { id: 1, eventType: EventType.POSITION_OPENED, processed: false },
        { id: 2, eventType: EventType.RANGE_MOVED, processed: false },
      ];

      mockPrismaService.blockchainEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.getUnprocessedEvents();

      expect(result).toEqual(mockEvents);
      expect(mockPrismaService.blockchainEvent.findMany).toHaveBeenCalledWith({
        where: { processed: false },
        orderBy: [{ blockNumber: 'asc' }, { logIndex: 'asc' }],
      });
    });

    it('should return empty array when no unprocessed events', async () => {
      mockPrismaService.blockchainEvent.findMany.mockResolvedValue([]);

      const result = await service.getUnprocessedEvents();

      expect(result).toEqual([]);
    });
  });
});
