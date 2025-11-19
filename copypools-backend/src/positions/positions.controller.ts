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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { PositionsService } from './positions.service';

@ApiTags('positions')
@Controller('positions')
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
    description: 'Check the health status of the backend service, blockchain connection, and database'
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
          },
        },
        database: {
          type: 'object',
          properties: {
            totalPositions: { type: 'number', example: 1 },
            activePositions: { type: 'number', example: 0 },
          },
        },
        timestamp: { type: 'string', example: '2025-11-19T10:59:27.328Z' },
      },
    },
  })
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
  @ApiResponse({ status: 200, description: 'List of positions retrieved successfully' })
  async getAllPositions(@Query('owner') owner?: string) {
    this.logger.log(`Getting all positions${owner ? ` for owner ${owner}` : ''}`);
    return await this.positionsService.getAllPositions(owner);
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
}
