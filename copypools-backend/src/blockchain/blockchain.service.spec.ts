import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from './blockchain.service';
import { ethers } from 'ethers';

describe('BlockchainService', () => {
  let service: BlockchainService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        RPC_URL: 'https://ethereum-sepolia-rpc.publicnode.com',
        OPERATOR_PRIVATE_KEY: '0x1234567890123456789012345678901234567890123456789012345678901234',
        LP_MANAGER_ADDRESS: '0x1234567890123456789012345678901234567890',
        ADAPTER_ADDRESS: '0x0987654321098765432109876543210987654321',
      };
      return config[key];
    }),
  };

  const mockProvider = {
    getBlockNumber: jest.fn().mockResolvedValue(12345),
    getFeeData: jest.fn().mockResolvedValue({ gasPrice: 1000000n }),
  };

  const mockWallet = {
    address: '0xabcdef1234567890abcdef1234567890abcdef12',
  };

  const mockContract = {
    positions: jest.fn(),
    moveRange: jest.fn(),
    closePosition: jest.fn(),
    compound: jest.fn(),
    on: jest.fn(),
  };

  beforeEach(async () => {
    // Mock ethers
    jest.spyOn(ethers, 'JsonRpcProvider').mockImplementation(() => mockProvider as any);
    jest.spyOn(ethers, 'Wallet').mockImplementation(() => mockWallet as any);
    jest.spyOn(ethers, 'Contract').mockImplementation(() => mockContract as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
    configService = module.get<ConfigService>(ConfigService);

    // Manually call onModuleInit since we're in test context
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize provider and contracts', async () => {
      expect(configService.get).toHaveBeenCalledWith('RPC_URL');
      expect(configService.get).toHaveBeenCalledWith('OPERATOR_PRIVATE_KEY');
      expect(configService.get).toHaveBeenCalledWith('LP_MANAGER_ADDRESS');
      expect(configService.get).toHaveBeenCalledWith('ADAPTER_ADDRESS');
    });

    it('should throw error if contract addresses not configured', async () => {
      const mockConfigMissingAddresses = {
        get: jest.fn((key: string) => {
          if (key === 'RPC_URL') return 'https://test.com';
          if (key === 'OPERATOR_PRIVATE_KEY') return '0x123';
          return null;
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          BlockchainService,
          {
            provide: ConfigService,
            useValue: mockConfigMissingAddresses,
          },
        ],
      }).compile();

      const testService = module.get<BlockchainService>(BlockchainService);

      await expect(testService.onModuleInit()).rejects.toThrow(
        'Contract addresses not configured in environment',
      );
    });
  });

  describe('getPosition', () => {
    it('should get position from contract', async () => {
      const mockPosition = [
        'uniswapv4', // protocol
        123n, // dexTokenId
        '0xOwner', // owner
        '0xToken0', // token0
        '0xToken1', // token1
        true, // active
      ];

      mockContract.positions.mockResolvedValue(mockPosition);

      const result = await service.getPosition(1n);

      expect(result).toEqual({
        protocol: 'uniswapv4',
        dexTokenId: 123n,
        owner: '0xOwner',
        token0: '0xToken0',
        token1: '0xToken1',
        active: true,
      });
      expect(mockContract.positions).toHaveBeenCalledWith(1n);
    });

    it('should handle error when getting position', async () => {
      mockContract.positions.mockRejectedValue(new Error('Contract error'));

      await expect(service.getPosition(1n)).rejects.toThrow('Contract error');
    });
  });

  describe('getAdapterPosition', () => {
    it('should get adapter position details', async () => {
      const mockAdapterPosition = {
        key: 'key123',
        owner: '0xOwner',
        tickLower: -1000n,
        tickUpper: 1000n,
        liquidity: 1000000n,
      };

      mockContract.positions.mockResolvedValue(mockAdapterPosition);

      const result = await service.getAdapterPosition(123n);

      expect(result).toEqual(mockAdapterPosition);
    });

    it('should handle error when getting adapter position', async () => {
      mockContract.positions.mockRejectedValue(new Error('Adapter error'));

      await expect(service.getAdapterPosition(123n)).rejects.toThrow('Adapter error');
    });
  });

  describe('moveRange', () => {
    it('should move range successfully', async () => {
      const mockTx = {
        hash: '0xtxhash',
        wait: jest.fn().mockResolvedValue({
          blockNumber: 12345,
          gasUsed: 100000n,
        }),
      };

      mockContract.moveRange.mockResolvedValue(mockTx);

      const result = await service.moveRange(1n, -2000, 2000, false);

      expect(result).toEqual({
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      });
      expect(mockContract.moveRange).toHaveBeenCalledWith(1n, -2000, 2000, false, '0x');
    });

    it('should handle error when moving range', async () => {
      mockContract.moveRange.mockRejectedValue(new Error('Move range failed'));

      await expect(service.moveRange(1n, -2000, 2000, false)).rejects.toThrow(
        'Move range failed',
      );
    });
  });

  describe('closePosition', () => {
    it('should close position successfully', async () => {
      const mockTx = {
        hash: '0xtxhash',
        wait: jest.fn().mockResolvedValue({
          blockNumber: 12345,
          gasUsed: 100000n,
        }),
      };

      mockContract.closePosition.mockResolvedValue(mockTx);

      const result = await service.closePosition(1n, 1000000n);

      expect(result).toEqual({
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      });
      expect(mockContract.closePosition).toHaveBeenCalledWith(1n, 1000000n);
    });

    it('should handle error when closing position', async () => {
      mockContract.closePosition.mockRejectedValue(new Error('Close failed'));

      await expect(service.closePosition(1n, 1000000n)).rejects.toThrow('Close failed');
    });
  });

  describe('compound', () => {
    it('should compound position successfully', async () => {
      const mockTx = {
        hash: '0xtxhash',
        wait: jest.fn().mockResolvedValue({
          blockNumber: 12345,
          gasUsed: 100000n,
        }),
      };

      mockContract.compound.mockResolvedValue(mockTx);

      const result = await service.compound(1n, false);

      expect(result).toEqual({
        transactionHash: '0xtxhash',
        blockNumber: 12345,
        gasUsed: '100000',
      });
      expect(mockContract.compound).toHaveBeenCalledWith(1n, false, '0x');
    });

    it('should handle error when compounding', async () => {
      mockContract.compound.mockRejectedValue(new Error('Compound failed'));

      await expect(service.compound(1n, false)).rejects.toThrow('Compound failed');
    });
  });

  describe('Utility Methods', () => {
    it('should get provider', () => {
      const provider = service.getProvider();
      expect(provider).toBeDefined();
    });

    it('should get wallet', () => {
      const wallet = service.getWallet();
      expect(wallet).toBeDefined();
    });

    it('should get LP manager contract', () => {
      const contract = service.getLPManagerContract();
      expect(contract).toBeDefined();
    });

    it('should get adapter contract', () => {
      const contract = service.getAdapterContract();
      expect(contract).toBeDefined();
    });

    it('should get current block', async () => {
      const blockNumber = await service.getCurrentBlock();
      expect(blockNumber).toBe(12345);
      expect(mockProvider.getBlockNumber).toHaveBeenCalled();
    });

    it('should get gas price', async () => {
      const gasPrice = await service.getGasPrice();
      expect(gasPrice).toBe(1000000n);
      expect(mockProvider.getFeeData).toHaveBeenCalled();
    });
  });

  describe('Event Listeners', () => {
    it('should setup position created listener', async () => {
      const callback = jest.fn();
      await service.listenToPositionCreated(callback);

      expect(mockContract.on).toHaveBeenCalledWith('PositionOpened', expect.any(Function));
    });

    it('should setup range moved listener', async () => {
      const callback = jest.fn();
      await service.listenToRangeMoved(callback);

      expect(mockContract.on).toHaveBeenCalledWith('RangeMoved', expect.any(Function));
    });

    it('should setup position closed listener', async () => {
      const callback = jest.fn();
      await service.listenToPositionClosed(callback);

      expect(mockContract.on).toHaveBeenCalledWith('PositionClosed', expect.any(Function));
    });
  });
});
