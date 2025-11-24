import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainService } from '../blockchain/blockchain.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainService: BlockchainService,
  ) {}

  async getDetailedHealth() {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkBlockchain(),
    ]);

    const [database, blockchain] = checks;

    return {
      status: checks.every((c) => c.status === 'fulfilled') ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: database.status === 'fulfilled' ? database.value : { status: 'unhealthy', error: (database as PromiseRejectedResult).reason.message },
        blockchain: blockchain.status === 'fulfilled' ? blockchain.value : { status: 'unhealthy', error: (blockchain as PromiseRejectedResult).reason.message },
      },
    };
  }

  async isReady(): Promise<boolean> {
    try {
      await this.checkDatabase();
      await this.checkBlockchain();
      return true;
    } catch (error) {
      this.logger.error('Readiness check failed', error);
      return false;
    }
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'healthy' };
    } catch (error) {
      throw new Error(`Database check failed: ${error.message}`);
    }
  }

  private async checkBlockchain() {
    try {
      const blockNumber = await this.blockchainService.getProvider().getBlockNumber();
      return {
        status: 'healthy',
        blockNumber,
        network: process.env.NETWORK,
      };
    } catch (error) {
      throw new Error(`Blockchain check failed: ${error.message}`);
    }
  }
}
