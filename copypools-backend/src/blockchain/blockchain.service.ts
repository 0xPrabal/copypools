import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import * as LPManagerABI from '../contracts/abi/LPManagerV1.json';
import * as AdapterABI from '../contracts/abi/UniswapV4AdapterProduction.json';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private lpManagerContract: ethers.Contract;
  private adapterContract: ethers.Contract;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeProvider();
    await this.initializeContracts();
    this.logger.log('Blockchain service initialized');
  }

  private async initializeProvider() {
    const rpcUrl = this.configService.get<string>('RPC_URL');
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    const privateKey = this.configService.get<string>('OPERATOR_PRIVATE_KEY');
    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.logger.log(`Wallet initialized: ${this.wallet.address}`);
    } else {
      this.logger.warn('No private key configured - read-only mode');
    }
  }

  private async initializeContracts() {
    const lpManagerAddress = this.configService.get<string>('LP_MANAGER_ADDRESS');
    const adapterAddress = this.configService.get<string>('ADAPTER_ADDRESS');

    const signer = this.wallet || this.provider;

    this.lpManagerContract = new ethers.Contract(
      lpManagerAddress,
      LPManagerABI.abi,
      signer,
    );

    this.adapterContract = new ethers.Contract(
      adapterAddress,
      AdapterABI.abi,
      signer,
    );

    this.logger.log(`Contracts initialized:`);
    this.logger.log(`  LPManager: ${lpManagerAddress}`);
    this.logger.log(`  Adapter: ${adapterAddress}`);
  }

  // Contract Read Methods
  async getPosition(positionId: bigint) {
    try {
      const position = await this.lpManagerContract.positions(positionId);
      return {
        protocol: position[0],
        dexTokenId: position[1],
        owner: position[2],
        token0: position[3],
        token1: position[4],
        active: position[5],
      };
    } catch (error) {
      this.logger.error(`Error getting position ${positionId}:`, error);
      throw error;
    }
  }

  async getAdapterPosition(dexTokenId: bigint) {
    try {
      const position = await this.adapterContract.positions(dexTokenId);
      return {
        key: position.key,
        owner: position.owner,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: position.liquidity,
      };
    } catch (error) {
      this.logger.error(`Error getting adapter position ${dexTokenId}:`, error);
      throw error;
    }
  }

  // Contract Write Methods
  async moveRange(
    positionId: bigint,
    newTickLower: number,
    newTickUpper: number,
    doSwap: boolean = false,
  ) {
    try {
      this.logger.log(`Moving range for position ${positionId}`);
      const tx = await this.lpManagerContract.moveRange(
        positionId,
        newTickLower,
        newTickUpper,
        doSwap,
        '0x', // empty swap data
      );

      const receipt = await tx.wait();
      this.logger.log(`Move range successful: ${tx.hash}`);

      return {
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      this.logger.error(`Error moving range for position ${positionId}:`, error);
      throw error;
    }
  }

  async closePosition(positionId: bigint, liquidity: bigint) {
    try {
      this.logger.log(`Closing position ${positionId}`);
      const tx = await this.lpManagerContract.closePosition(
        positionId,
        liquidity,
      );

      const receipt = await tx.wait();
      this.logger.log(`Close position successful: ${tx.hash}`);

      return {
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      this.logger.error(`Error closing position ${positionId}:`, error);
      throw error;
    }
  }

  async compound(positionId: bigint, doSwap: boolean = false) {
    try {
      this.logger.log(`Compounding position ${positionId}`);
      const tx = await this.lpManagerContract.compound(
        positionId,
        doSwap,
        '0x', // empty swap data
      );

      const receipt = await tx.wait();
      this.logger.log(`Compound successful: ${tx.hash}`);

      return {
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      this.logger.error(`Error compounding position ${positionId}:`, error);
      throw error;
    }
  }

  // Event Listeners
  async listenToPositionCreated(callback: (event: any) => void) {
    this.lpManagerContract.on('PositionOpened', (positionId, owner, protocol, event) => {
      this.logger.log(`Position created: ${positionId} by ${owner}`);
      callback({
        positionId: positionId.toString(),
        owner,
        protocol,
        transactionHash: event.log.transactionHash,
        blockNumber: event.log.blockNumber,
      });
    });
  }

  async listenToRangeMoved(callback: (event: any) => void) {
    this.lpManagerContract.on(
      'RangeMoved',
      (oldPositionId, newPositionId, newTickLower, newTickUpper, event) => {
        this.logger.log(
          `Range moved: ${oldPositionId} -> ${newPositionId}`,
        );
        callback({
          oldPositionId: oldPositionId.toString(),
          newPositionId: newPositionId.toString(),
          newTickLower,
          newTickUpper,
          transactionHash: event.log.transactionHash,
          blockNumber: event.log.blockNumber,
        });
      },
    );
  }

  async listenToPositionClosed(callback: (event: any) => void) {
    this.lpManagerContract.on(
      'PositionClosed',
      (positionId, amount0, amount1, event) => {
        this.logger.log(`Position closed: ${positionId}`);
        callback({
          positionId: positionId.toString(),
          amount0: amount0.toString(),
          amount1: amount1.toString(),
          transactionHash: event.log.transactionHash,
          blockNumber: event.log.blockNumber,
        });
      },
    );
  }

  // Utility Methods
  getProvider(): ethers.Provider {
    return this.provider;
  }

  getWallet(): ethers.Wallet {
    return this.wallet;
  }

  getLPManagerContract(): ethers.Contract {
    return this.lpManagerContract;
  }

  getAdapterContract(): ethers.Contract {
    return this.adapterContract;
  }

  async getCurrentBlock(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    return feeData.gasPrice || 0n;
  }
}
