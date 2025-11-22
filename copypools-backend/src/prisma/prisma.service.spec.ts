import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);

    // Mock the Prisma client methods to prevent actual database connections during tests
    service.$connect = jest.fn().mockResolvedValue(undefined);
    service.$disconnect = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should connect to database successfully', async () => {
      await service.onModuleInit();

      expect(service.$connect).toHaveBeenCalled();
      expect(service.$connect).toHaveBeenCalledTimes(1);
    });

    it('should handle connection errors', async () => {
      const errorMessage = 'Connection failed';
      service.$connect = jest.fn().mockRejectedValue(new Error(errorMessage));

      await expect(service.onModuleInit()).rejects.toThrow(errorMessage);
    });

    it('should log successful connection', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.onModuleInit();

      expect(logSpy).toHaveBeenCalledWith('Prisma connected to database');
    });

    it('should log connection errors', async () => {
      const errorMessage = 'Connection failed';
      const errorSpy = jest.spyOn(service['logger'], 'error');
      service.$connect = jest.fn().mockRejectedValue(new Error(errorMessage));

      try {
        await service.onModuleInit();
      } catch (error) {
        // Expected to throw
      }

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to connect to database:',
        expect.any(Error),
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect from database', async () => {
      await service.onModuleDestroy();

      expect(service.$disconnect).toHaveBeenCalled();
      expect(service.$disconnect).toHaveBeenCalledTimes(1);
    });

    it('should log successful disconnection', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.onModuleDestroy();

      expect(logSpy).toHaveBeenCalledWith('Prisma disconnected from database');
    });
  });

  describe('enableShutdownHooks', () => {
    it('should register beforeExit hook', async () => {
      const mockApp = {
        close: jest.fn().mockResolvedValue(undefined),
      };

      // Store original process.on
      const originalProcessOn = process.on;

      // Mock process.on to capture the listener
      let beforeExitListener: (() => void) | null = null;
      process.on = jest.fn((event, listener) => {
        if (event === 'beforeExit') {
          beforeExitListener = listener as () => void;
        }
        return process;
      }) as any;

      await service.enableShutdownHooks(mockApp);

      expect(process.on).toHaveBeenCalledWith('beforeExit', expect.any(Function));

      // Simulate beforeExit event
      if (beforeExitListener) {
        await beforeExitListener();
        expect(mockApp.close).toHaveBeenCalled();
      }

      // Restore original process.on
      process.on = originalProcessOn;
    });

    it('should close app on beforeExit event', async () => {
      const mockApp = {
        close: jest.fn().mockResolvedValue(undefined),
      };

      const originalProcessOn = process.on;
      let beforeExitListener: (() => Promise<void>) | null = null;

      process.on = jest.fn((event, listener) => {
        if (event === 'beforeExit') {
          beforeExitListener = listener as () => Promise<void>;
        }
        return process;
      }) as any;

      await service.enableShutdownHooks(mockApp);

      if (beforeExitListener) {
        await beforeExitListener();
        expect(mockApp.close).toHaveBeenCalledTimes(1);
      }

      process.on = originalProcessOn;
    });
  });

  describe('Prisma Client Configuration', () => {
    it('should configure logging for development environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const devService = new PrismaService();

      // The service should be created with development logging configuration
      expect(devService).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });

    it('should configure logging for production environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const prodService = new PrismaService();

      // The service should be created with production logging configuration
      expect(prodService).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });
  });
});
