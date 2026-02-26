import { CronJob } from 'cron';
import { config, contracts } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as subgraph from '../services/subgraph.js';
import * as blockchain from '../services/blockchain.js';
import { getRebalanceSwapData, calculateRebalanceSwap } from '../services/swap.js';
import { publicClient, getLatestPositionInChain, getRebalancedTo } from '../services/blockchain.js';
import { getTokenInfo } from '../services/price.js';
import { getBatchTokenPricesFromDb } from '../services/database.js';
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
import {
  insertEventCacheBatch,
  getActiveRangeTokenIds,
} from '../services/database.js';

const botLogger = logger.child({ bot: 'auto-range' });

// Bot name for state persistence
const BOT_NAME = 'auto-range';

// Track known position IDs with auto-range enabled (from on-chain events)
let knownRangePositions = new Set<string>();

// Minimum position USD value to attempt rebalance (skip dust positions)
const MIN_POSITION_VALUE_USD = 2;

// Contract deployment block - start scanning from here (Base Mainnet)
const CONTRACT_START_BLOCK = BigInt(39369847);
let lastScannedBlock = CONTRACT_START_BLOCK;
let stateLoaded = false;

// Track last rebalance time per position (in-memory cache)
const lastRebalanceTimeCache = new Map<string, number>();

// Track recent errors for debugging (keep last 10)
const recentErrors: { tokenId: string; error: string; timestamp: string }[] = [];
const MAX_ERRORS = 10;

// Track position processing status
const positionStatus: { tokenId: string; status: string; timestamp: string }[] = [];
const MAX_STATUS = 20;

function recordError(tokenId: string, error: string) {
  recentErrors.unshift({ tokenId, error, timestamp: new Date().toISOString() });
  if (recentErrors.length > MAX_ERRORS) recentErrors.pop();
}

function recordStatus(tokenId: string, status: string) {
  positionStatus.unshift({ tokenId, status, timestamp: new Date().toISOString() });
  if (positionStatus.length > MAX_STATUS) positionStatus.pop();
}

export function getRecentErrors() {
  return recentErrors;
}

export function getPositionStatus() {
  return positionStatus;
}

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
  // Batch all 3 getLogs calls in parallel to reduce wall-clock time
  const [configuredLogs, removedLogs, rebalancedLogs] = await Promise.all([
    publicClient.getLogs({
      address: contracts.v4AutoRange as Address,
      event: parseAbiItem('event RangeConfigured(uint256 indexed tokenId, address indexed owner, int24 lowerDelta, int24 upperDelta, uint32 rebalanceThreshold)'),
      fromBlock,
      toBlock,
    }),
    publicClient.getLogs({
      address: contracts.v4AutoRange as Address,
      event: parseAbiItem('event RangeRemoved(uint256 indexed tokenId)'),
      fromBlock,
      toBlock,
    }),
    publicClient.getLogs({
      address: contracts.v4AutoRange as Address,
      event: parseAbiItem('event Rebalanced(uint256 indexed oldTokenId, uint256 indexed newTokenId, int24 newTickLower, int24 newTickUpper, uint128 liquidity, uint256 fee0, uint256 fee1)'),
      fromBlock,
      toBlock,
    }),
  ]);

  // Collect events for batch insert into event_cache
  const eventsToCache: Array<{ eventType: string; tokenId: string; blockNumber: bigint; logIndex: number; data?: Record<string, unknown> }> = [];

  for (const log of configuredLogs) {
    const tokenId = (log.args as any).tokenId?.toString();
    if (tokenId) {
      knownRangePositions.add(tokenId);
      eventsToCache.push({
        eventType: 'RangeConfigured',
        tokenId,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex ?? 0,
        data: { owner: (log.args as any).owner },
      });
      botLogger.info({ tokenId, block: log.blockNumber.toString() }, 'Found RangeConfigured event');
    }
  }

  for (const log of removedLogs) {
    const tokenId = (log.args as any).tokenId?.toString();
    if (tokenId) {
      knownRangePositions.delete(tokenId);
      eventsToCache.push({
        eventType: 'RangeRemoved',
        tokenId,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex ?? 0,
      });
      botLogger.info({ tokenId, block: log.blockNumber.toString() }, 'Found RangeRemoved event');
    }
  }

  // Deduplicate block fetches for Rebalanced events
  const blockTimestampCache = new Map<bigint, number>();
  for (const log of rebalancedLogs) {
    const oldTokenId = (log.args as any).oldTokenId?.toString();
    const newTokenId = (log.args as any).newTokenId?.toString();
    if (oldTokenId && newTokenId) {
      knownRangePositions.delete(oldTokenId);
      knownRangePositions.add(newTokenId);

      eventsToCache.push({
        eventType: 'Rebalanced',
        tokenId: newTokenId,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex ?? 0,
        data: { oldTokenId, newTokenId },
      });

      // Use cached block timestamp to avoid duplicate getBlock calls
      let timestamp = blockTimestampCache.get(log.blockNumber);
      if (timestamp === undefined) {
        try {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          timestamp = Number(block.timestamp);
          blockTimestampCache.set(log.blockNumber, timestamp);
        } catch {
          timestamp = Math.floor(Date.now() / 1000);
        }
      }
      lastRebalanceTimeCache.set(newTokenId, timestamp);

      botLogger.info({ oldTokenId, newTokenId, block: log.blockNumber.toString() }, 'Found Rebalanced event');
    }
  }

  // Fire-and-forget: persist events to database
  if (eventsToCache.length > 0) {
    insertEventCacheBatch(eventsToCache).catch((err) => {
      botLogger.debug({ err, count: eventsToCache.length }, 'Failed to cache events to database');
    });
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

    // Supplement with event_cache table (catches events persisted between restarts)
    try {
      const cachedTokenIds = await getActiveRangeTokenIds();
      if (cachedTokenIds.size > 0) {
        const beforeCount = knownRangePositions.size;
        for (const tokenId of cachedTokenIds) {
          knownRangePositions.add(tokenId);
        }
        const added = knownRangePositions.size - beforeCount;
        if (added > 0) {
          botLogger.info({ added, total: knownRangePositions.size }, 'Supplemented positions from event_cache');
        }
      }
    } catch (ecError) {
      botLogger.debug({ error: ecError }, 'Could not supplement from event_cache');
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

// Max blocks to scan per bot run to cap RPC usage (5 chunks × 3 parallel getLogs = 15 RPC calls max)
const MAX_CHUNKS_PER_RUN = 5;
const CHUNK_SIZE = BigInt(20000); // Larger chunks to cover same range with fewer RPC calls

// Scan blockchain for RangeConfigured events
async function scanForRangeConfiguredEvents(): Promise<void> {
  try {
    await loadStateFromDb();
    const currentBlock = await publicClient.getBlockNumber();

    if (lastScannedBlock <= CONTRACT_START_BLOCK) {
      // If we have positions from DB already, skip the full historical scan
      // and only scan recent blocks. The DB is the primary source of truth.
      if (knownRangePositions.size > 0) {
        // We already have positions from the DB — just scan recent blocks for new events
        const recentStart = currentBlock > BigInt(50000) ? currentBlock - BigInt(50000) : CONTRACT_START_BLOCK;
        botLogger.info({
          positionsFromDb: knownRangePositions.size,
          scanFrom: recentStart.toString(),
        }, 'Skipping full historical scan — positions loaded from DB, scanning recent blocks only');
        lastScannedBlock = recentStart;
      } else {
        // No DB positions — need full scan, but cap chunks per run to limit RPC
        botLogger.info({ fromBlock: CONTRACT_START_BLOCK.toString(), toBlock: currentBlock.toString() }, 'Starting initial scan (capped per run)');
        let scanFrom = CONTRACT_START_BLOCK;
        let chunksScanned = 0;

        while (scanFrom < currentBlock && chunksScanned < MAX_CHUNKS_PER_RUN) {
          const scanTo = scanFrom + CHUNK_SIZE > currentBlock ? currentBlock : scanFrom + CHUNK_SIZE;
          botLogger.debug({ fromBlock: scanFrom.toString(), toBlock: scanTo.toString() }, 'Scanning chunk');
          await scanBlockRange(scanFrom, scanTo);
          scanFrom = scanTo + BigInt(1);
          chunksScanned++;
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        lastScannedBlock = scanFrom;
        botLogger.info({
          positionsFound: knownRangePositions.size,
          chunksScanned,
          scanProgress: `${lastScannedBlock.toString()} / ${currentBlock.toString()}`,
        }, chunksScanned >= MAX_CHUNKS_PER_RUN ? 'Scan paused (chunk limit reached, will continue next run)' : 'Initial scan complete');
        await saveStateToDb();
        return;
      }
    }

    if (currentBlock < lastScannedBlock) {
      return;
    }

    // Incremental scan — cap at MAX_CHUNKS_PER_RUN chunks
    const maxBlocksPerScan = CHUNK_SIZE * BigInt(MAX_CHUNKS_PER_RUN);
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
async function processPositionSmart(tokenId: string): Promise<{ rebalanced: boolean; decision: RebalanceDecision | null; analysis: PositionAnalysis | null }> {
  try {
    const tokenIdBigInt = BigInt(tokenId);
    recordStatus(tokenId, 'Processing started');

    // Check per-block deduplication
    if (!(await canRebalanceInCurrentBlock(tokenId))) {
      recordStatus(tokenId, 'Skipped: Already processed in this block');
      botLogger.debug({ tokenId }, 'Already processed in this block');
      return { rebalanced: false, decision: null, analysis: null };
    }

    // Verify range config is enabled on-chain
    const rangeConfig = await blockchain.getRangeConfig(tokenIdBigInt);
    if (!rangeConfig || !rangeConfig.enabled) {
      recordStatus(tokenId, 'Skipped: Range config not enabled on-chain');
      botLogger.debug({ tokenId }, 'Range config not enabled on-chain');
      knownRangePositions.delete(tokenId);
      return { rebalanced: false, decision: null, analysis: null };
    }

    // Check if already rebalanced to newer position
    recordStatus(tokenId, 'Checking rebalancedTo...');
    const rebalancedTo = await getRebalancedTo(tokenIdBigInt);
    if (rebalancedTo > 0n) {
      recordStatus(tokenId, `Skipped: Already rebalanced to ${rebalancedTo}`);
      botLogger.debug({ tokenId, rebalancedTo: rebalancedTo.toString() }, 'Position already rebalanced, removing from tracking');
      // Permanently remove stale position — the new tokenId is tracked instead
      knownRangePositions.delete(tokenId);
      return { rebalanced: false, decision: null, analysis: null };
    }

    // Get position status
    recordStatus(tokenId, 'Getting position status...');
    const posStatus = await blockchain.getPositionStatus(tokenIdBigInt);

    // Get REAL liquidity from PositionManager (not from V4AutoRange which may have stale data)
    recordStatus(tokenId, 'Getting liquidity from PositionManager...');
    let realLiquidity: bigint;
    try {
      realLiquidity = await blockchain.getPositionLiquidity(tokenIdBigInt);
    } catch (error) {
      recordStatus(tokenId, 'Error: Could not get liquidity from PositionManager');
      botLogger.error({ tokenId, error }, 'Failed to get position liquidity');
      return { rebalanced: false, decision: null, analysis: null };
    }

    // Skip empty positions and remove from tracking
    if (realLiquidity === 0n) {
      recordStatus(tokenId, 'Skipped: 0 liquidity (verified from PositionManager)');
      botLogger.debug({ tokenId }, 'Position has 0 liquidity, removing from tracking');
      knownRangePositions.delete(tokenId);
      return { rebalanced: false, decision: null, analysis: null };
    }

    recordStatus(tokenId, `Liquidity: ${realLiquidity.toString()}`);

    // Get V4AutoRange info for poolKey (needed for swap calculations)
    recordStatus(tokenId, 'Getting position info from V4AutoRange...');
    const positionInfo = await blockchain.getAutoRangePositionInfo(tokenIdBigInt);

    // Estimate position USD value and skip dust positions
    recordStatus(tokenId, 'Estimating position USD value...');
    try {
      const { amount0, amount1 } = estimatePositionAmounts(
        posStatus.currentTick,
        positionInfo.tickLower,
        positionInfo.tickUpper,
        realLiquidity
      );

      const token0Info = getTokenInfo(positionInfo.poolKey.currency0, config.CHAIN_ID);
      const token1Info = getTokenInfo(positionInfo.poolKey.currency1, config.CHAIN_ID);

      // Use DB prices instead of external API calls to save RPC/API credits
      const dbPrices = await getBatchTokenPricesFromDb(
        [positionInfo.poolKey.currency0, positionInfo.poolKey.currency1],
        config.CHAIN_ID
      );
      const token0PriceUsd = dbPrices.get(positionInfo.poolKey.currency0.toLowerCase())?.priceUsd ?? 0;
      const token1PriceUsd = dbPrices.get(positionInfo.poolKey.currency1.toLowerCase())?.priceUsd ?? 0;

      const amount0Human = Number(amount0) / Math.pow(10, token0Info.decimals);
      const amount1Human = Number(amount1) / Math.pow(10, token1Info.decimals);
      const value0Usd = amount0Human * token0PriceUsd;
      const value1Usd = amount1Human * token1PriceUsd;
      const totalValueUsd = value0Usd + value1Usd;

      if (totalValueUsd < MIN_POSITION_VALUE_USD) {
        recordStatus(tokenId, `Skipped: dust position ($${totalValueUsd.toFixed(2)} < $${MIN_POSITION_VALUE_USD})`);
        botLogger.info({
          tokenId,
          totalValueUsd: totalValueUsd.toFixed(2),
          amount0Human: amount0Human.toFixed(8),
          amount1Human: amount1Human.toFixed(8),
          threshold: MIN_POSITION_VALUE_USD,
        }, 'Skipping dust position - value below minimum threshold');
        return { rebalanced: false, decision: null, analysis: null };
      }

      botLogger.debug({
        tokenId,
        totalValueUsd: totalValueUsd.toFixed(2),
      }, 'Position value above dust threshold');
    } catch (priceError) {
      // If we can't estimate price, continue with rebalance attempt rather than blocking
      botLogger.warn({ tokenId, error: priceError instanceof Error ? priceError.message : String(priceError) },
        'Could not estimate position USD value, continuing with rebalance');
    }

    recordStatus(tokenId, `Analyzing: tick=${posStatus.currentTick}, range=[${posStatus.tickLower},${posStatus.tickUpper}]`);

    // Record price sample for volatility tracking
    const poolId = `${positionInfo.poolKey.currency0}-${positionInfo.poolKey.currency1}-${positionInfo.poolKey.fee}`;
    recordPriceSample(poolId, posStatus.currentTick);

    // ============ SMART ANALYSIS ============

    // Analyze position
    const analysis = analyzePosition(
      tokenId,
      posStatus.currentTick,
      posStatus.tickLower,
      posStatus.tickUpper
    );

    // Calculate volatility from history
    const priceHistory = getPriceHistory(poolId);
    const volatility = calculateVolatility(priceHistory);

    // Get last rebalance time (uses cached blockchain call)
    let lastRebalanceTime = lastRebalanceTimeCache.get(tokenId) || 0;
    if (lastRebalanceTime === 0) {
      try {
        lastRebalanceTime = await blockchain.getLastRebalanceTime(tokenIdBigInt);
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
      recordStatus(tokenId, `Decision: No rebalance needed - ${decision.reason}`);
      return { rebalanced: false, decision, analysis };
    }

    recordStatus(tokenId, `Decision: Should rebalance - ${decision.reason}`);
    recordStatus(tokenId, 'Executing rebalance...');

    // Get new range
    const newRange = await blockchain.calculateOptimalRange(tokenIdBigInt);

    // Estimate token amounts (use real liquidity from PositionManager)
    const { amount0, amount1 } = estimatePositionAmounts(
      posStatus.currentTick,
      positionInfo.tickLower,
      positionInfo.tickUpper,
      realLiquidity
    );

    botLogger.info({
      tokenId,
      currentTick: posStatus.currentTick,
      oldRange: `[${positionInfo.tickLower}, ${positionInfo.tickUpper}]`,
      newRange: `[${newRange.tickLower}, ${newRange.tickUpper}]`,
      centerDrift: `${Math.round(analysis.centerDrift * 100)}%`,
      decision: decision.reason,
    }, 'Executing smart rebalance');

    // Calculate swap requirements
    const swapParams = calculateRebalanceSwap(
      posStatus.currentTick,
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
        posStatus.currentTick,
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

    return { rebalanced: true, decision, analysis };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    botLogger.error({ tokenId, errorMessage }, 'Smart rebalance failed');
    recordError(tokenId, errorMessage);
    return { rebalanced: false, decision: null, analysis: null };
  }
}

async function runAutoRangeBot(): Promise<void> {
  botLogger.info('Starting smart auto-range bot run');

  try {
    // Check gas price
    await blockchain.getGasPrice();

    // PRIMARY: Load positions from Ponder database (much faster than event scanning)
    try {
      const { rangeConfigs } = await subgraph.getRebalanceablePositions(500);
      if (rangeConfigs && rangeConfigs.length > 0) {
        // Update known positions from database
        for (const config of rangeConfigs) {
          if (config.position?.tokenId) {
            knownRangePositions.add(config.position.tokenId.toString());
          }
        }
        botLogger.info({ fromDatabase: rangeConfigs.length }, 'Loaded positions from Ponder database');
      }
    } catch (dbError) {
      botLogger.warn({ error: dbError instanceof Error ? dbError.message : String(dbError) }, 'Failed to load from database, falling back to event scanning');
    }

    // FALLBACK: Scan for new events (catches any not in database yet)
    await scanForRangeConfiguredEvents();

    botLogger.info({ positionCount: knownRangePositions.size }, 'Monitoring positions');

    let successCount = 0;
    let failCount = 0;
    const analyses: PositionAnalysis[] = [];

    // Process all known positions with smart logic
    for (const tokenId of knownRangePositions) {
      const { rebalanced, decision, analysis } = await processPositionSmart(tokenId);

      if (rebalanced) {
        successCount++;
      } else if (decision === null) {
        // Position was skipped (already rebalanced, no config, etc.)
      } else {
        failCount++;
      }

      // Collect analysis for summary (reuse analysis from processPositionSmart - no extra RPC call)
      if (analysis) {
        analyses.push(analysis);
      }

      // Rate limiting between positions (100ms is enough with proper caching)
      await new Promise((resolve) => setTimeout(resolve, 100));
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
  // Convert to minutes for cron expression (minimum 1 minute)
  const intervalMinutes = Math.max(1, Math.floor(intervalMs / 60000));
  const cronExpression = `*/${intervalMinutes} * * * *`; // Every X minutes

  const job = new CronJob(cronExpression, runAutoRangeBot, null, false);

  if (config.BOT_ENABLED) {
    job.start();
    botLogger.info({ intervalMs, intervalMinutes }, 'Smart auto-range bot started');
  }

  return job;
}

export { runAutoRangeBot };

// Export for debugging/API access
export function getKnownPositions(): string[] {
  return Array.from(knownRangePositions);
}

export function getLastScannedBlock(): string {
  return lastScannedBlock.toString();
}
