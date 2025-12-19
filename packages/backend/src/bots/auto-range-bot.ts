import { CronJob } from 'cron';
import { config, contracts } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as subgraph from '../services/subgraph.js';
import * as blockchain from '../services/blockchain.js';
import { getRebalanceSwapData, calculateRebalanceSwap } from '../services/swap.js';
import { publicClient, getLatestPositionInChain, getRebalancedTo } from '../services/blockchain.js';
import { Address, parseAbiItem } from 'viem';
import {
  analyzePosition,
  calculateVolatility,
  recordPriceSample,
  getPriceHistory,
  makeRebalanceDecision,
  canRebalanceInCurrentBlock,
  markRebalancedInBlock,
  logPositionAnalysis,
  summarizePositions,
  PositionAnalysis,
  RebalanceDecision,
} from '../services/smart-rebalance.js';

const botLogger = logger.child({ bot: 'auto-range' });

// Bot name for state persistence
const BOT_NAME = 'auto-range';

// Track known position IDs with auto-range enabled (from on-chain events)
let knownRangePositions = new Set<string>();

// Contract deployment block - start scanning from here (Base Mainnet)
const CONTRACT_START_BLOCK = BigInt(39369847);
let lastScannedBlock = CONTRACT_START_BLOCK;
let stateLoaded = false;

// Track last rebalance time per position (in-memory cache)
const lastRebalanceTimeCache = new Map<string, number>();

interface RebalanceablePosition {
  tokenId: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  lowerDelta: number;
  upperDelta: number;
  rebalanceThreshold: number;
  minRebalanceInterval: number;
  lastRebalanceTimestamp: string | null;
  maxSwapSlippage: string;
}

// Estimate position token amounts based on liquidity and tick range
function estimatePositionAmounts(
  currentTick: number,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint
): { amount0: bigint; amount1: bigint } {
  if (liquidity === 0n) {
    return { amount0: 0n, amount1: 0n };
  }

  const Q96 = 2n ** 96n;

  // Calculate sqrt prices at ticks
  const sqrtPriceLower = BigInt(Math.floor(Math.sqrt(1.0001 ** tickLower) * Number(Q96)));
  const sqrtPriceUpper = BigInt(Math.floor(Math.sqrt(1.0001 ** tickUpper) * Number(Q96)));
  const sqrtPriceCurrent = BigInt(Math.floor(Math.sqrt(1.0001 ** currentTick) * Number(Q96)));

  if (currentTick < tickLower) {
    // Below range: 100% token0
    const amount0 = (liquidity * Q96 * (sqrtPriceUpper - sqrtPriceLower)) / (sqrtPriceLower * sqrtPriceUpper);
    return { amount0, amount1: 0n };
  } else if (currentTick >= tickUpper) {
    // Above range: 100% token1
    const amount1 = (liquidity * (sqrtPriceUpper - sqrtPriceLower)) / Q96;
    return { amount0: 0n, amount1 };
  } else {
    // In range: mixed
    const amount0 = (liquidity * Q96 * (sqrtPriceUpper - sqrtPriceCurrent)) / (sqrtPriceCurrent * sqrtPriceUpper);
    const amount1 = (liquidity * (sqrtPriceCurrent - sqrtPriceLower)) / Q96;
    return { amount0, amount1 };
  }
}

// Scan a block range for RangeConfigured, RangeRemoved, and Rebalanced events
async function scanBlockRange(fromBlock: bigint, toBlock: bigint): Promise<void> {
  // Scan for RangeConfigured events
  const configuredLogs = await publicClient.getLogs({
    address: contracts.v4AutoRange as Address,
    event: parseAbiItem('event RangeConfigured(uint256 indexed tokenId, address indexed owner, int24 lowerDelta, int24 upperDelta, uint32 rebalanceThreshold)'),
    fromBlock,
    toBlock,
  });

  for (const log of configuredLogs) {
    const tokenId = (log.args as any).tokenId?.toString();
    if (tokenId) {
      knownRangePositions.add(tokenId);
      botLogger.info({ tokenId, block: log.blockNumber.toString() }, 'Found RangeConfigured event');
    }
  }

  // Scan for RangeRemoved events
  const removedLogs = await publicClient.getLogs({
    address: contracts.v4AutoRange as Address,
    event: parseAbiItem('event RangeRemoved(uint256 indexed tokenId)'),
    fromBlock,
    toBlock,
  });

  for (const log of removedLogs) {
    const tokenId = (log.args as any).tokenId?.toString();
    if (tokenId) {
      knownRangePositions.delete(tokenId);
      botLogger.info({ tokenId, block: log.blockNumber.toString() }, 'Found RangeRemoved event');
    }
  }

  // Scan for Rebalanced events to track new positions and update last rebalance time
  const rebalancedLogs = await publicClient.getLogs({
    address: contracts.v4AutoRange as Address,
    event: parseAbiItem('event Rebalanced(uint256 indexed oldTokenId, uint256 indexed newTokenId, int24 newTickLower, int24 newTickUpper, uint128 liquidity, uint256 fee0, uint256 fee1)'),
    fromBlock,
    toBlock,
  });

  for (const log of rebalancedLogs) {
    const oldTokenId = (log.args as any).oldTokenId?.toString();
    const newTokenId = (log.args as any).newTokenId?.toString();
    if (oldTokenId && newTokenId) {
      knownRangePositions.delete(oldTokenId);
      knownRangePositions.add(newTokenId);

      // Get block timestamp for last rebalance time
      try {
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        lastRebalanceTimeCache.set(newTokenId, Number(block.timestamp));
      } catch {
        lastRebalanceTimeCache.set(newTokenId, Math.floor(Date.now() / 1000));
      }

      botLogger.info({ oldTokenId, newTokenId, block: log.blockNumber.toString() }, 'Found Rebalanced event');
    }
  }
}

// Load state from database on first run
async function loadStateFromDb(): Promise<void> {
  if (stateLoaded) return;

  try {
    await subgraph.initBotStateTable();
    const savedState = await subgraph.loadBotState(BOT_NAME);
    if (savedState) {
      lastScannedBlock = savedState.lastScannedBlock;
      knownRangePositions = savedState.knownPositions;
      botLogger.info({
        lastScannedBlock: lastScannedBlock.toString(),
        positionCount: knownRangePositions.size,
        positions: Array.from(knownRangePositions),
      }, 'Loaded bot state from database');
    } else {
      botLogger.info('No saved state found, will scan from contract deployment block');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    botLogger.warn({ errorMessage }, 'Failed to load state from database, will scan from beginning');
  }

  stateLoaded = true;
}

// Save state to database
async function saveStateToDb(): Promise<void> {
  try {
    await subgraph.saveBotState(BOT_NAME, lastScannedBlock, knownRangePositions);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    botLogger.warn({ errorMessage }, 'Failed to save bot state');
  }
}

// Scan blockchain for RangeConfigured events
async function scanForRangeConfiguredEvents(): Promise<void> {
  try {
    await loadStateFromDb();
    const currentBlock = await publicClient.getBlockNumber();

    if (lastScannedBlock <= CONTRACT_START_BLOCK) {
      botLogger.info({ fromBlock: CONTRACT_START_BLOCK.toString(), toBlock: currentBlock.toString() }, 'Starting initial full scan for events');

      const chunkSize = BigInt(10000);
      let scanFrom = CONTRACT_START_BLOCK;

      while (scanFrom < currentBlock) {
        const scanTo = scanFrom + chunkSize > currentBlock ? currentBlock : scanFrom + chunkSize;
        botLogger.debug({ fromBlock: scanFrom.toString(), toBlock: scanTo.toString() }, 'Scanning chunk');
        await scanBlockRange(scanFrom, scanTo);
        scanFrom = scanTo + BigInt(1);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      lastScannedBlock = currentBlock + BigInt(1);
      botLogger.info({ positionsFound: knownRangePositions.size, positions: Array.from(knownRangePositions) }, 'Initial scan complete');
      await saveStateToDb();
      return;
    }

    if (currentBlock < lastScannedBlock) {
      return;
    }

    const maxBlocksPerScan = BigInt(10000);
    const toBlock = lastScannedBlock + maxBlocksPerScan > currentBlock
      ? currentBlock
      : lastScannedBlock + maxBlocksPerScan;

    if (toBlock >= lastScannedBlock) {
      const blocksToScan = Number(toBlock - lastScannedBlock);
      if (blocksToScan > 0) {
        botLogger.debug({ fromBlock: lastScannedBlock.toString(), toBlock: toBlock.toString(), blocks: blocksToScan }, 'Scanning for new events');
        await scanBlockRange(lastScannedBlock, toBlock);
        lastScannedBlock = toBlock + BigInt(1);
        await saveStateToDb();
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    botLogger.error({ errorMessage }, 'Failed to scan for RangeConfigured events');
  }
}

/**
 * Process a position using SMART rebalancing logic
 * This is the core of the improved auto-range system
 */
async function processPositionSmart(tokenId: string): Promise<{ rebalanced: boolean; decision: RebalanceDecision | null }> {
  try {
    const tokenIdBigInt = BigInt(tokenId);

    // Check per-block deduplication
    if (!(await canRebalanceInCurrentBlock(tokenId))) {
      botLogger.debug({ tokenId }, 'Already processed in this block');
      return { rebalanced: false, decision: null };
    }

    // Verify range config is enabled on-chain
    const rangeConfig = await blockchain.getRangeConfig(tokenIdBigInt);
    if (!rangeConfig || !rangeConfig.enabled) {
      botLogger.debug({ tokenId }, 'Range config not enabled on-chain');
      knownRangePositions.delete(tokenId);
      return { rebalanced: false, decision: null };
    }

    // Check if already rebalanced to newer position
    const rebalancedTo = await getRebalancedTo(tokenIdBigInt);
    if (rebalancedTo > 0n) {
      botLogger.debug({ tokenId, rebalancedTo: rebalancedTo.toString() }, 'Position already rebalanced');
      return { rebalanced: false, decision: null };
    }

    // Get position status
    const positionStatus = await blockchain.getPositionStatus(tokenIdBigInt);
    const positionInfo = await blockchain.getAutoRangePositionInfo(tokenIdBigInt);

    // Skip empty positions
    if (positionInfo.liquidity === 0n) {
      botLogger.debug({ tokenId }, 'Position has 0 liquidity');
      return { rebalanced: false, decision: null };
    }

    // Record price sample for volatility tracking
    const poolId = `${positionInfo.poolKey.currency0}-${positionInfo.poolKey.currency1}-${positionInfo.poolKey.fee}`;
    recordPriceSample(poolId, positionStatus.currentTick);

    // ============ SMART ANALYSIS ============

    // Analyze position
    const analysis = analyzePosition(
      tokenId,
      positionStatus.currentTick,
      positionStatus.tickLower,
      positionStatus.tickUpper
    );

    // Calculate volatility from history
    const priceHistory = getPriceHistory(poolId);
    const volatility = calculateVolatility(priceHistory);

    // Get last rebalance time
    let lastRebalanceTime = lastRebalanceTimeCache.get(tokenId) || 0;
    if (lastRebalanceTime === 0) {
      // Try to get from contract
      try {
        const contractTime = await publicClient.readContract({
          address: contracts.v4AutoRange as Address,
          abi: [{ name: 'lastRebalanceTime', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] }],
          functionName: 'lastRebalanceTime',
          args: [tokenIdBigInt],
        }) as bigint;
        lastRebalanceTime = Number(contractTime);
        lastRebalanceTimeCache.set(tokenId, lastRebalanceTime);
      } catch {
        // Not found, use 0
      }
    }

    // Make smart decision
    const decision = makeRebalanceDecision(
      analysis,
      volatility,
      rangeConfig,
      lastRebalanceTime
    );

    // Log analysis
    logPositionAnalysis(analysis, decision);

    // ============ EXECUTE IF NEEDED ============

    if (!decision.shouldRebalance) {
      return { rebalanced: false, decision };
    }

    // Double-check contract's checkRebalance (it enforces cooldown)
    const { needsRebalance: contractAllows } = await blockchain.checkRebalance(tokenIdBigInt);

    // Always respect the contract's decision - it enforces cooldown and other constraints
    if (!contractAllows) {
      botLogger.debug({ tokenId }, 'Contract checkRebalance returned false, respecting cooldown');
      return { rebalanced: false, decision };
    }

    // Get new range
    const newRange = await blockchain.calculateOptimalRange(tokenIdBigInt);

    // Estimate token amounts
    const { amount0, amount1 } = estimatePositionAmounts(
      positionStatus.currentTick,
      positionInfo.tickLower,
      positionInfo.tickUpper,
      positionInfo.liquidity
    );

    botLogger.info({
      tokenId,
      currentTick: positionStatus.currentTick,
      oldRange: `[${positionInfo.tickLower}, ${positionInfo.tickUpper}]`,
      newRange: `[${newRange.tickLower}, ${newRange.tickUpper}]`,
      centerDrift: `${Math.round(analysis.centerDrift * 100)}%`,
      decision: decision.reason,
    }, 'Executing smart rebalance');

    // Calculate swap requirements
    const swapParams = calculateRebalanceSwap(
      positionStatus.currentTick,
      newRange.tickLower,
      newRange.tickUpper,
      positionInfo.poolKey.currency0,
      positionInfo.poolKey.currency1,
      amount0,
      amount1
    );

    // Get swap data if needed
    let swapData = '0x' as `0x${string}`;
    if (swapParams.needsSwap) {
      swapData = await getRebalanceSwapData(
        positionStatus.currentTick,
        newRange.tickLower,
        newRange.tickUpper,
        positionInfo.poolKey.currency0,
        positionInfo.poolKey.currency1,
        amount0,
        amount1
      );

      if (swapData === '0x') {
        botLogger.warn({ tokenId }, 'Swap needed but no external swap data - using internal swap');
      }
    }

    // Execute rebalance
    const hash = await blockchain.executeRebalance(tokenIdBigInt, swapData);

    // Mark as rebalanced in this block
    await markRebalancedInBlock(tokenId);

    // Update last rebalance time cache
    lastRebalanceTimeCache.set(tokenId, Math.floor(Date.now() / 1000));

    botLogger.info({
      tokenId,
      hash,
      centerDrift: `${Math.round(analysis.centerDrift * 100)}%`,
      estimatedSavingsBps: decision.estimatedSavings,
    }, 'Smart rebalance executed successfully');

    return { rebalanced: true, decision };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    botLogger.error({ tokenId, errorMessage }, 'Smart rebalance failed');
    return { rebalanced: false, decision: null };
  }
}

async function runAutoRangeBot(): Promise<void> {
  botLogger.info('Starting smart auto-range bot run');

  try {
    // Check gas price
    await blockchain.getGasPrice();

    // Scan for new events
    await scanForRangeConfiguredEvents();

    botLogger.info({ positionCount: knownRangePositions.size }, 'Monitoring positions');

    let successCount = 0;
    let failCount = 0;
    const analyses: PositionAnalysis[] = [];

    // Process all known positions with smart logic
    for (const tokenId of knownRangePositions) {
      const { rebalanced, decision } = await processPositionSmart(tokenId);

      if (rebalanced) {
        successCount++;
      } else if (decision === null) {
        // Position was skipped (already rebalanced, no config, etc.)
      } else {
        failCount++;
      }

      // Collect analysis for summary
      if (decision) {
        try {
          const status = await blockchain.getPositionStatus(BigInt(tokenId));
          analyses.push(analyzePosition(tokenId, status.currentTick, status.tickLower, status.tickUpper));
        } catch {
          // Skip if can't get status
        }
      }

      // Rate limiting - but faster than before since we're smarter about decisions
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Log summary
    if (analyses.length > 0) {
      const summary = summarizePositions(analyses);
      botLogger.info({
        ...summary,
        rebalanced: successCount,
      }, 'Smart auto-range bot run completed');
    } else {
      botLogger.info({ successCount, failCount }, 'Auto-range bot run completed');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    botLogger.error({ errorMessage, errorStack }, 'Auto-range bot run failed');
  }
}

export function startAutoRangeBot(): CronJob {
  const intervalMs = config.AUTO_RANGE_INTERVAL_MS;
  const cronExpression = `*/${Math.floor(intervalMs / 1000)} * * * * *`;

  const job = new CronJob(cronExpression, runAutoRangeBot, null, false);

  if (config.BOT_ENABLED) {
    job.start();
    botLogger.info({ intervalMs }, 'Smart auto-range bot started');
  }

  return job;
}

export { runAutoRangeBot };
