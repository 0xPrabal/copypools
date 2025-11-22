import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { PositionsService } from './positions.service';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';

@ApiTags('positions')
@Controller('positions')
@UseGuards(new RateLimitGuard(100, 60000)) // 100 requests per minute
export class PositionsController {
  private readonly logger = new Logger(PositionsController.name);

  constructor(private readonly positionsService: PositionsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get position by ID', description: 'Retrieve basic position information by position ID' })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiResponse({ status: 200, description: 'Position found and returned successfully' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async getPosition(@Param('id') id: string) {
    this.logger.log(`Getting position ${id}`);
    return await this.positionsService.getPosition(BigInt(id));
  }

  @Get(':id/details')
  @ApiOperation({ summary: 'Get detailed position information', description: 'Retrieve comprehensive position details including liquidity and tick range' })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiResponse({ status: 200, description: 'Position details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async getPositionDetails(@Param('id') id: string) {
    this.logger.log(`Getting detailed position info for ${id}`);
    return await this.positionsService.getPositionDetails(BigInt(id));
  }

  @Post(':id/move-range')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move position range',
    description: 'Move liquidity position to a new tick range. Optionally swap tokens to maintain ratio.'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiBody({
    description: 'Range move parameters',
    schema: {
      type: 'object',
      properties: {
        tickLower: { type: 'number', example: -887220, description: 'New lower tick boundary' },
        tickUpper: { type: 'number', example: 887220, description: 'New upper tick boundary' },
        doSwap: { type: 'boolean', example: false, description: 'Whether to swap tokens for optimal ratio' },
      },
      required: ['tickLower', 'tickUpper'],
    },
  })
  @ApiResponse({ status: 200, description: 'Range moved successfully' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async moveRange(
    @Param('id') id: string,
    @Body() body: { tickLower: number; tickUpper: number; doSwap?: boolean },
  ) {
    this.logger.log(`Moving range for position ${id}`);
    return await this.positionsService.moveRange(
      BigInt(id),
      body.tickLower,
      body.tickUpper,
      body.doSwap || false,
    );
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close position',
    description: 'Close a liquidity position and withdraw specified liquidity amount'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiBody({
    description: 'Close position parameters',
    schema: {
      type: 'object',
      properties: {
        liquidity: { type: 'string', example: '1000000000000000000', description: 'Amount of liquidity to withdraw' },
      },
      required: ['liquidity'],
    },
  })
  @ApiResponse({ status: 200, description: 'Position closed successfully' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async closePosition(
    @Param('id') id: string,
    @Body() body: { liquidity: string },
  ) {
    this.logger.log(`Closing position ${id}`);
    return await this.positionsService.closePosition(
      BigInt(id),
      BigInt(body.liquidity),
    );
  }

  @Post(':id/compound')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compound position fees',
    description: 'Collect and reinvest accumulated fees back into the position'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiBody({
    description: 'Compound parameters',
    schema: {
      type: 'object',
      properties: {
        doSwap: { type: 'boolean', example: false, description: 'Whether to swap tokens for optimal ratio before reinvesting' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Fees compounded successfully' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async compound(
    @Param('id') id: string,
    @Body() body: { doSwap?: boolean },
  ) {
    this.logger.log(`Compounding position ${id}`);
    return await this.positionsService.compound(
      BigInt(id),
      body.doSwap || false,
    );
  }

  @Get('health/status')
  @ApiOperation({
    summary: 'Health check',
    description: 'Check the health status of the backend service, blockchain connection, database, Ponder indexer, and contract addresses'
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        blockchain: {
          type: 'object',
          properties: {
            connected: { type: 'boolean', example: true },
            blockNumber: { type: 'number', example: 9661449 },
            gasPrice: { type: 'string', example: '999997' },
            contracts: {
              type: 'object',
              properties: {
                lpManager: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', example: '0x...' },
                    accessible: { type: 'boolean', example: true },
                  },
                },
                adapter: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', example: '0x...' },
                    accessible: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
        },
        database: {
          type: 'object',
          properties: {
            totalPositions: { type: 'number', example: 1 },
            activePositions: { type: 'number', example: 0 },
            pool: {
              type: 'object',
              properties: {
                connected: { type: 'boolean', example: true },
                status: { type: 'string', example: 'healthy' },
              },
            },
          },
        },
        ponder: {
          type: 'object',
          properties: {
            active: { type: 'boolean', example: true },
            lastIndexedBlock: { type: 'number', example: 9661449 },
            totalEvents: { type: 'number', example: 42 },
            lastUpdate: { type: 'string', example: '2025-01-20T10:00:00.000Z' },
          },
        },
        timestamp: { type: 'string', example: '2025-11-19T10:59:27.328Z' },
      },
    },
    examples: {
      healthy: {
        summary: 'Healthy service',
        value: {
          status: 'healthy',
          blockchain: {
            connected: true,
            blockNumber: 9661449,
            gasPrice: '999997',
            contracts: {
              lpManager: { address: '0x...', accessible: true },
              adapter: { address: '0x...', accessible: true },
            },
          },
          database: {
            totalPositions: 5,
            activePositions: 3,
            pool: { connected: true, status: 'healthy' },
          },
          ponder: {
            active: true,
            lastIndexedBlock: 9661449,
            totalEvents: 42,
            lastUpdate: '2025-01-20T10:00:00.000Z',
          },
          timestamp: '2025-11-19T10:59:27.328Z',
        },
      },
    },
  })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async getHealthStatus() {
    return await this.positionsService.getHealthStatus();
  }

  @Get()
  @ApiOperation({
    summary: 'Get all positions',
    description: 'Retrieve all positions from the database, optionally filtered by owner address'
  })
  @ApiQuery({
    name: 'owner',
    required: false,
    description: 'Filter positions by owner address',
    example: '0x2BCc053BB6915F28aC2041855D2292dDca406903',
  })
  @ApiResponse({ 
    status: 200, 
    description: 'List of positions retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          positionId: { type: 'string', example: '1' },
          protocol: { type: 'string', example: 'uniswap-v4' },
          owner: { type: 'string', example: '0x2BCc053BB6915F28aC2041855D2292dDca406903' },
          active: { type: 'boolean', example: true },
        },
      },
    },
  })
  async getAllPositions(@Query('owner') owner?: string) {
    this.logger.log(`Getting all positions${owner ? ` for owner ${owner}` : ''}`);
    return await this.positionsService.getAllPositions(owner);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create/Sync position',
    description: 'Create a new position record or sync existing position from blockchain to database. Use this after creating a position via smart contract to ensure it appears in the API immediately.'
  })
  @ApiBody({
    description: 'Position creation/sync parameters',
    schema: {
      type: 'object',
      properties: {
        positionId: { 
          type: 'string', 
          example: '1', 
          description: 'Position ID from smart contract' 
        },
      },
      required: ['positionId'],
    },
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Position created/synced successfully',
    schema: {
      type: 'object',
      properties: {
        positionId: { type: 'string', example: '1' },
        protocol: { type: 'string', example: 'uniswap-v4' },
        owner: { type: 'string', example: '0x2BCc053BB6915F28aC2041855D2292dDca406903' },
        active: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Position synced successfully' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Position not found on blockchain' })
  @ApiResponse({ status: 400, description: 'Invalid position ID' })
  async createOrSyncPosition(@Body() body: { positionId: string }) {
    this.logger.log(`Creating/syncing position ${body.positionId}`);
    return await this.positionsService.createOrSyncPosition(BigInt(body.positionId));
  }

  @Get(':id/transactions')
  @ApiOperation({
    summary: 'Get position transactions',
    description: 'Retrieve all transactions history for a specific position'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiResponse({ status: 200, description: 'Transaction history retrieved successfully' })
  async getPositionTransactions(@Param('id') id: string) {
    this.logger.log(`Getting transactions for position ${id}`);
    return await this.positionsService.getPositionTransactions(id);
  }

  @Get(':id/history')
  @ApiOperation({
    summary: 'Get position history',
    description: 'Retrieve range move history for a position from Ponder indexed data'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiResponse({ status: 200, description: 'Position history retrieved successfully' })
  async getPositionHistory(@Param('id') id: string) {
    this.logger.log(`Getting history for position ${id}`);
    return await this.positionsService.getPositionHistory(id);
  }

  @Get(':id/compounds')
  @ApiOperation({
    summary: 'Get compound events',
    description: 'Retrieve all compound events for a position from Ponder indexed data'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiResponse({ status: 200, description: 'Compound events retrieved successfully' })
  async getPositionCompoundEvents(@Param('id') id: string) {
    this.logger.log(`Getting compound events for position ${id}`);
    return await this.positionsService.getPositionCompoundEvents(id);
  }

  @Get(':id/timeline')
  @ApiOperation({
    summary: 'Get position timeline',
    description: 'Retrieve complete timeline with all events (range moves, compounds, close) for a position'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiResponse({ status: 200, description: 'Position timeline retrieved successfully' })
  async getPositionTimeline(@Param('id') id: string) {
    this.logger.log(`Getting timeline for position ${id}`);
    return await this.positionsService.getPositionTimeline(id);
  }

  @Get(':id/close-event')
  @ApiOperation({
    summary: 'Get close event',
    description: 'Retrieve close event for a position from Ponder indexed data'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiResponse({ status: 200, description: 'Close event retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Close event not found' })
  async getPositionCloseEvent(@Param('id') id: string) {
    this.logger.log(`Getting close event for position ${id}`);
    return await this.positionsService.getPositionCloseEvent(id);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync position from blockchain',
    description: 'Manually sync position data from blockchain to database'
  })
  @ApiParam({ name: 'id', description: 'Position ID', example: '1' })
  @ApiResponse({ status: 200, description: 'Position synced successfully' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async syncPosition(@Param('id') id: string) {
    this.logger.log(`Syncing position ${id} from blockchain`);
    const position = await this.positionsService.getPosition(BigInt(id));
    return position;
  }
}
