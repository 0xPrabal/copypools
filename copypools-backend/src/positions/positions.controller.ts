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
import { PositionsService } from './positions.service';

@Controller('positions')
export class PositionsController {
  private readonly logger = new Logger(PositionsController.name);

  constructor(private readonly positionsService: PositionsService) {}

  @Get(':id')
  async getPosition(@Param('id') id: string) {
    this.logger.log(`Getting position ${id}`);
    return await this.positionsService.getPosition(BigInt(id));
  }

  @Get(':id/details')
  async getPositionDetails(@Param('id') id: string) {
    this.logger.log(`Getting detailed position info for ${id}`);
    return await this.positionsService.getPositionDetails(BigInt(id));
  }

  @Post(':id/move-range')
  @HttpCode(HttpStatus.OK)
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
  async getHealthStatus() {
    return await this.positionsService.getHealthStatus();
  }

  @Get()
  async getAllPositions(@Query('owner') owner?: string) {
    this.logger.log(`Getting all positions${owner ? ` for owner ${owner}` : ''}`);
    return await this.positionsService.getAllPositions(owner);
  }

  @Get(':id/transactions')
  async getPositionTransactions(@Param('id') id: string) {
    this.logger.log(`Getting transactions for position ${id}`);
    return await this.positionsService.getPositionTransactions(id);
  }
}
