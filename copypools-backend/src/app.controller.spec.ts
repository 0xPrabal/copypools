import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  const mockAppService = {
    getHello: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: mockAppService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(appController).toBeDefined();
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      const expectedResult = 'Hello World!';
      mockAppService.getHello.mockReturnValue(expectedResult);

      const result = appController.getHello();

      expect(result).toBe(expectedResult);
      expect(mockAppService.getHello).toHaveBeenCalled();
      expect(mockAppService.getHello).toHaveBeenCalledTimes(1);
    });

    it('should call appService.getHello', () => {
      mockAppService.getHello.mockReturnValue('Test Message');

      appController.getHello();

      expect(mockAppService.getHello).toHaveBeenCalled();
    });
  });
});
