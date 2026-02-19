import { Router, Request, Response, NextFunction } from 'express';
import * as subgraph from '../../services/subgraph.js';
import * as blockchain from '../../services/blockchain.js';
import * as database from '../../services/database.js';
import * as multichain from '../../services/multichain.js';
import { logger } from '../../utils/logger.js';
import { memoryCache } from '../../services/cache.js';
import { config } from '../../config/index.js';
import { isSupportedChain } from '../../config/chains.js';
import { rpcManager } from '../../services/rpc-manager.js';
import { ErrorCodes } from '../../utils/errors.js';
import {
  analyzePosition,
  calculateVolatility,
  getPriceHistory,
  recordPriceSample,
  makeRebalanceDecision,
  RebalanceDecision,
} from '../../services/smart-rebalance.js';
import {
  calculatePositionValueUSD,
} from '../../services/price.js';

const router = Router();
const routeLogger = logger.child({ route: 'positions' });

// Promise timeout configuration
const ENRICHMENT_TIMEOUT_MS = 10000; // 10 seconds for enrichment operations

/**
 * Check if RPC service is available and healthy
 * Returns true if at least one RPC endpoint is healthy
 */
function isRpcHealthy(chainId: number = config.CHAIN_ID): boolean {
  const stats = rpcManager.getStats();
  const chainStats = stats.rpcs.find(r => r.chainId === chainId);
  return chainStats ? chainStats.healthy > 0 : false;
}

/**
 * Middleware to check RPC health before operations that require chain access
 * Returns 503 Service Unavailable if all RPCs are unhealthy
 */
function checkRpcHealth(req: Request, res: Response, next: NextFunction): void {
  const chainId = req.query.chainId ? parseInt(req.query.chainId as string, 10) : config.CHAIN_ID;

  if (!isRpcHealthy(chainId)) {
    const stats = rpcManager.getStats();
    routeLogger.warn({ chainId, rpcStats: stats }, 'RPC service degraded, returning 503');

    res.setHeader('Retry-After', '30');
    res.status(503).json({
      error: 'Service temporarily unavailable',
      code: ErrorCodes.RPC_ALL_UNHEALTHY,
      message: 'All RPC endpoints are currently unhealthy. Please retry in 30 seconds.',
      retryAfter: 30,
    });
    return;
  }

  next();
}

/**
 * Wrap a promise with a timeout
 * Returns { data, timedOut } - if timedOut is true, data will be undefined
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label?: string
): Promise<{ data?: T; timedOut: boolean; error?: string }> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<{ data?: T; timedOut: boolean; error: string }>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ timedOut: true, error: `Operation timed out after ${timeoutMs}ms${label ? ` (${label})` : ''}` });
    }, timeoutMs);
  });

  try {
    const data = await Promise.race([
      promise.then(data => ({ data, timedOut: false })),
      timeoutPromise,
    ]);
    clearTimeout(timeoutId!);
    return data;
  } catch (error) {
    clearTimeout(timeoutId!);
    return {
      timedOut: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Wrap Promise.all with timeout and return partial results
 */
async function promiseAllWithTimeout<T>(
  promises: Promise<T>[],
  timeoutMs: number
): Promise<{ results: (T | null)[]; completedCount: number; timedOutCount: number }> {
  const wrappedPromises = promises.map(p =>
    withTimeout(p, timeoutMs).then(result => (result.timedOut ? null : result.data ?? null))
  );

  const results = await Promise.all(wrappedPromises);
  const completedCount = results.filter(r => r !== null).length;
  const timedOutCount = results.filter(r => r === null).length;

  return { results, completedCount, timedOutCount };
}

// Cache settings (optimized to reduce RPC calls)
const MEMORY_CACHE_TTL = 30 * 1000; // 30 seconds for in-memory
const DB_CACHE_STALE_MINUTES = 2; // Consider DB cache stale after 2 minutes

// Fee tier to tick spacing mapping (Uniswap V4 standard)
function feeToTickSpacing(fee: number): number {
  switch (fee) {
    case 100: return 1;     // 0.01% fee tier
    case 500: return 10;    // 0.05% fee tier
    case 3000: return 60;   // 0.30% fee tier
    case 10000: return 200; // 1.00% fee tier
    default: return Math.max(1, Math.floor(fee / 50)); // Fallback calculation
  }
}

// Get position by token ID - uses caching to minimize RPC calls
// checkRpcHealth middleware ensures RPC is available before proceeding
router.get('/:tokenId', checkRpcHealth, async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const includeUSD = req.query.includeUSD !== 'false'; // Default to true
    const noCache = req.query.noCache === 'true';
    const chainId = req.query.chainId ? parseInt(req.query.chainId as string, 10) : config.CHAIN_ID;

    // LAYER 1: Check memory cache first (60 second TTL)
    const cacheKey = `position_${chainId}_${tokenId}_${includeUSD}`;
    if (!noCache) {
      const cached = memoryCache.get<any>(cacheKey);
      if (cached) {
        routeLogger.debug({ tokenId, layer: 'memory' }, 'Position cache hit');
        return res.json(cached);
      }
    }

    // LAYER 2: Try Ponder first (0 RPC calls for lookup)
    try {
      const ponderResult = await subgraph.getPosition(tokenId);
      if (ponderResult.position) {
        let position = ponderResult.position;

        // CRITICAL: Check if position needs enrichment from chain
        // poolId === 'unknown' or tickLower/tickUpper === 0 means Ponder has incomplete data
        const needsEnrichment = !position.poolId || position.poolId === 'unknown' ||
          (position.tickLower === 0 && position.tickUpper === 0);

        if (needsEnrichment) {
          routeLogger.info({ tokenId }, 'Position needs enrichment from chain (unknown poolId)');
          const onChainInfo = await blockchain.getPositionInfo(BigInt(tokenId));

          if (onChainInfo) {
            // Merge on-chain data with Ponder data (on-chain takes precedence for pool info)
            position = {
              ...position,
              poolId: onChainInfo.poolId,
              poolKey: onChainInfo.poolKey,
              tickLower: onChainInfo.tickLower,
              tickUpper: onChainInfo.tickUpper,
              liquidity: onChainInfo.liquidity,
              owner: onChainInfo.owner,
            };

            // Persist to database for future requests (async, don't wait)
            subgraph.updatePositionFromChain(
              tokenId,
              onChainInfo.poolId,
              onChainInfo.tickLower,
              onChainInfo.tickUpper,
              onChainInfo.liquidity
            ).catch(err => {
              routeLogger.warn({ error: err, tokenId }, 'Failed to persist enriched position to database');
            });
          }
        }

        // CRITICAL: Verify on-chain liquidity - Ponder may have stale data
        // (e.g., liquidity removed via PositionManager directly, not V4Utils)
        if (position.liquidity && BigInt(position.liquidity) > 0n && !needsEnrichment) {
          try {
            const onChainLiquidity = await blockchain.getPositionLiquidity(BigInt(tokenId));
            if (onChainLiquidity === 0n) {
              // Position is closed on-chain but Ponder is stale - update response
              position.liquidity = '0';
              position.closedAtTimestamp = Math.floor(Date.now() / 1000).toString();
              routeLogger.info({ tokenId }, 'Ponder position has stale liquidity, updated from on-chain');
            }
          } catch (e) {
            routeLogger.debug({ tokenId, error: e }, 'Failed to verify on-chain liquidity');
          }
        }

        // Get currentTick and inRange from pool data (if we have valid poolId)
        if (position.poolId && position.poolId !== 'unknown') {
          try {
            let poolKey = position.poolKey;

            // If no poolKey yet, construct it from poolId or pool data
            if (!poolKey) {
              // Try to get pool from Ponder first (has correct tickSpacing)
              const poolResult = await subgraph.getPool(position.poolId);

              let token0: string;
              let token1: string;
              let fee: number;
              let tickSpacing: number;
              let hooks: string;

              if (poolResult.pool) {
                // Use pool data from Ponder (accurate tickSpacing)
                token0 = poolResult.pool.token0Id || poolResult.pool.token0 || poolResult.pool.currency0;
                token1 = poolResult.pool.token1Id || poolResult.pool.token1 || poolResult.pool.currency1;
                fee = poolResult.pool.fee || poolResult.pool.feeTier || 3000;
                tickSpacing = poolResult.pool.tickSpacing || feeToTickSpacing(fee);
                hooks = poolResult.pool.hooks || '0x0000000000000000000000000000000000000000';
              } else {
                // Fallback: Parse poolId (format: "token0-token1-fee")
                const poolParts = position.poolId.split('-');
                if (poolParts.length < 2) {
                  throw new Error('Invalid poolId format');
                }
                token0 = poolParts[0];
                token1 = poolParts[1];
                fee = parseInt(poolParts[2] || '3000');
                tickSpacing = feeToTickSpacing(fee);
                hooks = '0x0000000000000000000000000000000000000000';
              }

              poolKey = {
                currency0: token0,
                currency1: token1,
                fee,
                tickSpacing,
                hooks,
              };
            }

            const slot0 = await blockchain.getPoolSlot0(poolKey);

            // Set current tick and inRange (always needed)
            (position as any).currentTick = slot0.tick;
            (position as any).sqrtPriceX96 = slot0.sqrtPriceX96.toString();
            (position as any).inRange = slot0.tick >= position.tickLower && slot0.tick < position.tickUpper;
            (position as any).poolKey = poolKey;

            // Add USD values if requested and position has liquidity
            if (includeUSD && position.liquidity && BigInt(position.liquidity) > 0n) {
              const usdValues = await calculatePositionValueUSD(
                BigInt(position.liquidity),
                slot0.sqrtPriceX96,
                position.tickLower,
                position.tickUpper,
                poolKey.currency0,
                poolKey.currency1,
                chainId
              );
              (position as any).usdValues = usdValues;
            }
          } catch (poolError) {
            routeLogger.debug({ tokenId, error: poolError }, 'Failed to get pool data for Ponder position');
          }
        }

        memoryCache.set(cacheKey, position, MEMORY_CACHE_TTL);
        routeLogger.debug({ tokenId, layer: 'ponder' }, 'Position from Ponder');
        return res.json(position);
      }
    } catch (e) {
      routeLogger.debug({ tokenId, error: e }, 'Ponder lookup failed, trying chain');
    }

    // LAYER 3: Fetch from chain (requires RPC calls)
    const position = await blockchain.getPositionInfo(BigInt(tokenId));

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Enrich with compound/range config from Ponder
    try {
      const compoundConfig = await blockchain.getCompoundConfig(BigInt(tokenId));
      (position as any).compoundConfig = compoundConfig;
    } catch (e) {
      // Not registered for compounding
    }

    try {
      const rangeConfig = await blockchain.getRangeConfig(BigInt(tokenId));
      (position as any).rangeConfig = rangeConfig;
    } catch (e) {
      // Not registered for auto-range
    }

    // Get pending fees if registered for compounding
    let pendingFees = { amount0: 0n, amount1: 0n };
    try {
      pendingFees = await blockchain.getPendingFees(BigInt(tokenId));
      (position as any).pendingFees = {
        amount0: pendingFees.amount0.toString(),
        amount1: pendingFees.amount1.toString(),
      };
    } catch (e) {
      // Position might not be registered for compounding
    }

    // Get current tick and calculate inRange from pool data
    if (position.poolKey) {
      try {
        const slot0 = await blockchain.getPoolSlot0(position.poolKey);
        (position as any).currentTick = slot0.tick;
        (position as any).sqrtPriceX96 = slot0.sqrtPriceX96.toString();
        (position as any).inRange = slot0.tick >= position.tickLower && slot0.tick < position.tickUpper;

        // Add USD values if requested
        if (includeUSD) {
          const usdValues = await calculatePositionValueUSD(
            BigInt(position.liquidity),
            slot0.sqrtPriceX96,
            position.tickLower,
            position.tickUpper,
            position.poolKey.currency0,
            position.poolKey.currency1,
            chainId,
            pendingFees
          );
          (position as any).usdValues = usdValues;
        }
      } catch (e) {
        routeLogger.warn({ tokenId, error: e }, 'Failed to get pool slot0');
        (position as any).usdValues = null;
        (position as any).usdError = 'Failed to fetch pool data';
      }
    }

    // Cache the result to avoid RPC calls on next request
    memoryCache.set(cacheKey, position, MEMORY_CACHE_TTL);
    routeLogger.debug({ tokenId, layer: 'chain' }, 'Position fetched from chain and cached');

    if (res.headersSent) return;
    res.json(position);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get position');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch position' });
  }
});

// Get positions by owner - uses multi-layer caching:
// 1. Memory cache (15 seconds) - instant
// 2. Database cache (2 minutes) - fast, persistent
// 3. Alchemy NFT API + RPC - fresh data
// checkRpcHealth middleware ensures RPC is available before proceeding
router.get('/owner/:address', checkRpcHealth, async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const enrich = req.query.enrich !== 'false'; // Default to true
    const noCache = req.query.noCache === 'true'; // Force fresh fetch
    const chainId = req.query.chainId ? parseInt(req.query.chainId as string, 10) : config.CHAIN_ID;

    // Check if chain is supported
    if (!isSupportedChain(chainId)) {
      routeLogger.debug({ address, chainId }, 'Unsupported chain, returning empty');
      return res.json([]);
    }

    // Use legacy single-chain path for primary configured chain (optimized)
    const useLegacyPath = chainId === config.CHAIN_ID;

    // LAYER 1: Check memory cache (15 second TTL)
    const memoryCacheKey = `positions_${address.toLowerCase()}_${chainId}_${enrich}`;
    if (!noCache) {
      const memoryCached = memoryCache.get<any[]>(memoryCacheKey);
      if (memoryCached) {
        routeLogger.debug({ address, count: memoryCached.length, layer: 'memory' }, 'Cache hit');
        return res.json(memoryCached);
      }
    }

    // LAYER 2: Check database cache
    if (!noCache && database.isDatabaseAvailable()) {
      const dbPositions = await database.getPositionsByOwner(address, chainId);

      if (dbPositions.length > 0) {
        // Check if cache is fresh (within 2 minutes)
        const oldestUpdate = Math.min(...dbPositions.map(p => new Date(p.updatedAt).getTime()));
        const cacheAge = Date.now() - oldestUpdate;
        const isFresh = cacheAge < DB_CACHE_STALE_MINUTES * 60 * 1000;

        if (isFresh) {
          // Transform DB format to API format (using full config data from cache)
          const rawPositions = dbPositions
            .filter(p => BigInt(p.liquidity) > 0n)
            .map(dbPos => ({
              tokenId: dbPos.tokenId,
              owner: dbPos.owner,
              poolId: dbPos.poolId,
              poolKey: {
                currency0: dbPos.currency0,
                currency1: dbPos.currency1,
                fee: dbPos.fee,
                tickSpacing: dbPos.tickSpacing || feeToTickSpacing(dbPos.fee),
                hooks: dbPos.hooks,
              },
              tickLower: dbPos.tickLower,
              tickUpper: dbPos.tickUpper,
              liquidity: dbPos.liquidity,
              currentTick: dbPos.currentTick,
              sqrtPriceX96: '0',
              inRange: dbPos.inRange,
              compoundConfig: dbPos.compoundConfig,
              rangeConfig: dbPos.rangeConfig,
            }));

          // Enrich with fresh slot0 data for accurate USD calculations
          const poolSlot0Cache = new Map<string, { tick: number; sqrtPriceX96: bigint }>();
          const positions = await Promise.all(rawPositions.map(async (pos: any) => {
            try {
              const poolCacheKey = `${pos.poolKey.currency0}-${pos.poolKey.currency1}-${pos.poolKey.fee}`;
              let slot0 = poolSlot0Cache.get(poolCacheKey);
              if (!slot0) {
                slot0 = await blockchain.getPoolSlot0(pos.poolKey);
                poolSlot0Cache.set(poolCacheKey, slot0);
              }
              return {
                ...pos,
                currentTick: slot0.tick,
                sqrtPriceX96: slot0.sqrtPriceX96.toString(),
                inRange: slot0.tick >= pos.tickLower && slot0.tick < pos.tickUpper,
              };
            } catch (e) {
              return pos;
            }
          }));

          // Store in memory cache
          memoryCache.set(memoryCacheKey, positions, MEMORY_CACHE_TTL);
          routeLogger.debug({ address, count: positions.length, layer: 'database', ageMs: cacheAge }, 'Cache hit');
          return res.json(positions);
        } else {
          routeLogger.debug({ address, ageMs: cacheAge }, 'DB cache stale, refreshing');
        }
      }
    }

    // LAYER 3: Check Ponder's indexed position table (0 RPC calls for lookup, but enrich with slot0)
    // Ponder indexes positions from V4Utils:PositionMinted events
    // Skip Ponder if noCache is true (user wants fresh data, e.g., after rebalance)
    if (!noCache) try {
      const ponderResult = await subgraph.getPositionsByOwner(address);
      if (ponderResult.positions?.items?.length > 0) {
        routeLogger.info({ address, count: ponderResult.positions.items.length, layer: 'ponder' }, 'Found positions in Ponder');

        // CRITICAL: Verify on-chain liquidity AND enrich unknown positions
        // Ponder may have stale data or incomplete data (poolId: "unknown")
        // Process in batches of 10 with overall 18s deadline (before 30s server timeout)
        const ENRICHMENT_BATCH_SIZE = 10;
        const ENRICHMENT_DEADLINE = Date.now() + 18000; // 18s overall deadline
        const ponderPositionsEnriched: any[] = [];
        let enrichmentTimedOut = 0;

        const allItems = ponderResult.positions.items;
        for (let i = 0; i < allItems.length; i += ENRICHMENT_BATCH_SIZE) {
          // Check deadline - if running out of time, skip remaining enrichments
          if (Date.now() > ENRICHMENT_DEADLINE) {
            routeLogger.warn({ processed: i, total: allItems.length }, 'Enrichment deadline reached, using Ponder data for rest');
            for (let j = i; j < allItems.length; j++) {
              ponderPositionsEnriched.push({ ...allItems[j], _verified: false });
              enrichmentTimedOut++;
            }
            break;
          }

          const batch = allItems.slice(i, i + ENRICHMENT_BATCH_SIZE);

          // Split batch: positions needing enrichment (unknown poolId) vs already valid
          const needsEnrichmentBatch: any[] = [];
          const validBatch: any[] = [];
          for (const p of batch) {
            const needsIt = !p.poolId || p.poolId === 'unknown' || (p.tickLower === 0 && p.tickUpper === 0);
            if (needsIt) needsEnrichmentBatch.push(p);
            else validBatch.push(p);
          }

          // Only make RPC calls for positions that actually need enrichment
          // Trust Ponder's liquidity for positions with valid pool data (saves 100s of RPC calls)
          const batchResult = await promiseAllWithTimeout(
            needsEnrichmentBatch.map(async (p: any) => {
              try {
                const onChainInfo = await blockchain.getPositionInfo(BigInt(p.tokenId));
                if (onChainInfo) {
                  return {
                    ...p,
                    poolId: onChainInfo.poolId,
                    poolKey: onChainInfo.poolKey,
                    tickLower: onChainInfo.tickLower,
                    tickUpper: onChainInfo.tickUpper,
                    liquidity: onChainInfo.liquidity,
                    _enrichedFromChain: true,
                    _verified: true,
                  };
                }
                return { ...p, _verified: false };
              } catch (e) {
                routeLogger.debug({ tokenId: p.tokenId, error: e }, 'Failed to enrich position');
                return { ...p, _verified: false };
              }
            }),
            6000 // 6s per batch timeout
          );

          // Add enriched positions
          for (let j = 0; j < needsEnrichmentBatch.length; j++) {
            const result = batchResult.results[j];
            ponderPositionsEnriched.push(result !== null ? result : { ...needsEnrichmentBatch[j], _verified: false });
          }
          enrichmentTimedOut += batchResult.timedOutCount;

          // Add valid positions as-is (trust Ponder data, no RPC needed)
          for (const p of validBatch) {
            ponderPositionsEnriched.push({ ...p, _verified: true });
          }
        }

        if (enrichmentTimedOut > 0) {
          routeLogger.warn({ timedOut: enrichmentTimedOut, total: allItems.length }, 'Ponder enrichment had timeouts');
        }

        // Persist enriched positions back to database (async, don't wait)
        // This ensures future requests don't need to fetch from chain again
        const enrichedFromChain = ponderPositionsEnriched.filter((p: any) => p._enrichedFromChain);
        if (enrichedFromChain.length > 0) {
          subgraph.batchUpdatePositionsFromChain(
            enrichedFromChain.map((p: any) => ({
              tokenId: p.tokenId,
              poolId: p.poolId,
              tickLower: p.tickLower,
              tickUpper: p.tickUpper,
              liquidity: p.liquidity,
            }))
          ).catch(err => {
            routeLogger.warn({ error: err }, 'Failed to persist enriched positions to database');
          });
        }

        // Transform Ponder format to API format (filter by verified on-chain liquidity)
        // Filter out positions with 0 liquidity OR still unknown poolId (can't display them properly)
        const rawPositions = ponderPositionsEnriched
          .filter((p: any) => BigInt(p.liquidity || '0') > 0n && p.poolId && p.poolId !== 'unknown')
          .map((ponderPos: any) => {
            // Use enriched poolKey if available, otherwise parse from poolId
            const poolKey = ponderPos.poolKey || {
              currency0: ponderPos.poolId?.split('-')[0] || '',
              currency1: ponderPos.poolId?.split('-')[1] || '',
              fee: parseInt(ponderPos.poolId?.split('-')[2] || '0'),
              tickSpacing: feeToTickSpacing(parseInt(ponderPos.poolId?.split('-')[2] || '3000')),
              hooks: '0x0000000000000000000000000000000000000000',
            };

            return {
              tokenId: ponderPos.tokenId,
              owner: ponderPos.owner,
              poolId: ponderPos.poolId,
              poolKey,
              tickLower: ponderPos.tickLower,
              tickUpper: ponderPos.tickUpper,
              liquidity: ponderPos.liquidity,
              currentTick: 0,
              sqrtPriceX96: '0',
              inRange: true,
              compoundConfig: ponderPos.compoundConfig,
              rangeConfig: ponderPos.rangeConfig,
              depositedToken0: ponderPos.depositedToken0 || '0',
              depositedToken1: ponderPos.depositedToken1 || '0',
            };
          });

        // Enrich with slot0 data (currentTick, sqrtPriceX96) for USD calculations
        // Group positions by unique poolKey to minimize RPC calls
        // Check deadline before starting slot0 enrichment
        const poolSlot0Cache = new Map<string, { tick: number; sqrtPriceX96: bigint }>();
        const SLOT0_DEADLINE = Date.now() + 8000; // 8s for slot0 step

        const positions: any[] = [];
        for (let i = 0; i < rawPositions.length; i += ENRICHMENT_BATCH_SIZE) {
          if (Date.now() > SLOT0_DEADLINE) {
            // Out of time - push remaining positions without slot0 data
            routeLogger.warn({ remaining: rawPositions.length - i }, 'Slot0 deadline hit, skipping rest');
            for (let j = i; j < rawPositions.length; j++) {
              positions.push(rawPositions[j]);
            }
            break;
          }

          const batch = rawPositions.slice(i, i + ENRICHMENT_BATCH_SIZE);
          const batchResult = await promiseAllWithTimeout(
            batch.map(async (pos: any) => {
              try {
                const poolCacheKey = `${pos.poolKey.currency0}-${pos.poolKey.currency1}-${pos.poolKey.fee}`;
                let slot0 = poolSlot0Cache.get(poolCacheKey);
                if (!slot0) {
                  slot0 = await blockchain.getPoolSlot0(pos.poolKey);
                  poolSlot0Cache.set(poolCacheKey, slot0);
                }
                return {
                  ...pos,
                  currentTick: slot0.tick,
                  sqrtPriceX96: slot0.sqrtPriceX96.toString(),
                  inRange: slot0.tick >= pos.tickLower && slot0.tick < pos.tickUpper,
                };
              } catch (e) {
                routeLogger.debug({ tokenId: pos.tokenId, error: e }, 'Failed to enrich with slot0');
                return pos;
              }
            }),
            5000 // 5s per batch
          );

          for (let j = 0; j < batch.length; j++) {
            positions.push(batchResult.results[j] !== null ? batchResult.results[j] : batch[j]);
          }
        }

        // Store in memory cache
        memoryCache.set(memoryCacheKey, positions, MEMORY_CACHE_TTL);

        // Also save tokenIds to position_cache for blockchain.getPositionTokenIds() (async, don't wait)
        // This ensures next time the cache layers in blockchain.ts will find them
        if (positions.length > 0) {
          const tokenIds = positions.map((p: any) => p.tokenId);
          database.savePositionCache(address, chainId, 'ponder', tokenIds).catch(err => {
            routeLogger.debug({ error: err }, 'Failed to save Ponder tokenIds to position_cache');
          });
        }

        return res.json(positions);
      }
    } catch (ponderError) {
      routeLogger.debug({ error: ponderError, address }, 'Ponder query failed, falling back to chain');
    }

    // LAYER 4: Fetch fresh data from chain (requires RPC calls)
    routeLogger.info({ address, enrich, chainId, useLegacyPath }, 'Fetching positions from chain');

    let onChainPositions: any[];

    if (useLegacyPath) {
      // Use optimized single-chain path for primary configured chain
      // Pass noCache to ensure fresh discovery (skips Ponder/DB cache when true)
      onChainPositions = await blockchain.getPositionsByOwnerOnChain(address, noCache);
    } else {
      // Use multichain service for other supported chains
      onChainPositions = await multichain.fetchPositionsForOwner(chainId, address);
    }

    routeLogger.info({ address, count: onChainPositions.length, chainId }, 'Found positions on chain');

    // Enrich positions with automation configs and current tick (in parallel with timeout)
    const enrichmentErrors: string[] = [];

    const enrichmentPromises = onChainPositions.map(async (position) => {
      const enrichedPosition: any = {
        ...position,
        depositedToken0: '0',
        depositedToken1: '0',
        withdrawnToken0: '0',
        withdrawnToken1: '0',
        collectedFeesToken0: '0',
        collectedFeesToken1: '0',
        compoundConfig: null,
        rangeConfig: null,
        currentTick: position.currentTick || 0,
        sqrtPriceX96: position.sqrtPriceX96 || '0',
        inRange: position.inRange ?? true,
        _enrichmentComplete: true,
      };

      if (!enrich) return enrichedPosition;

      const tokenId = BigInt(position.tokenId);

      if (useLegacyPath) {
        // Primary chain: full enrichment with automation configs
        const [compoundConfig, rangeConfig] = await Promise.all([
          blockchain.getCompoundConfig(tokenId).catch(() => null),
          blockchain.getRangeConfig(tokenId).catch(() => null),
        ]);

        if (compoundConfig?.enabled) {
          enrichedPosition.compoundConfig = compoundConfig;
        }
        if (rangeConfig?.enabled) {
          enrichedPosition.rangeConfig = rangeConfig;
        }

        // Get current tick and sqrtPriceX96 from StateView
        if (position.poolKey) {
          try {
            const slot0 = await blockchain.getPoolSlot0(position.poolKey);
            enrichedPosition.currentTick = slot0.tick;
            enrichedPosition.sqrtPriceX96 = slot0.sqrtPriceX96.toString();
            enrichedPosition.inRange = slot0.tick >= position.tickLower && slot0.tick < position.tickUpper;
          } catch (e) {
            routeLogger.warn({ tokenId: position.tokenId, error: e }, 'Failed to get slot0 from StateView');
            enrichedPosition._enrichmentComplete = false;
          }
        }
      }
      // For non-primary chains, multichain.fetchPositionsForOwner already includes currentTick and inRange

      return enrichedPosition;
    });

    // Use timeout wrapper for enrichment
    const { results, completedCount, timedOutCount } = await promiseAllWithTimeout(
      enrichmentPromises,
      ENRICHMENT_TIMEOUT_MS
    );

    // Filter out null results (timed out) and track errors
    const positions = results.map((result, index) => {
      if (result === null) {
        enrichmentErrors.push(`Position ${onChainPositions[index]?.tokenId}: enrichment timed out`);
        // Return base position without enrichment
        return {
          ...onChainPositions[index],
          depositedToken0: '0',
          depositedToken1: '0',
          withdrawnToken0: '0',
          withdrawnToken1: '0',
          collectedFeesToken0: '0',
          collectedFeesToken1: '0',
          compoundConfig: null,
          rangeConfig: null,
          currentTick: onChainPositions[index]?.currentTick || 0,
          sqrtPriceX96: onChainPositions[index]?.sqrtPriceX96 || '0',
          inRange: onChainPositions[index]?.inRange ?? true,
          _enrichmentComplete: false,
        };
      }
      return result;
    });

    // Determine if we should return partial content
    const isPartialContent = timedOutCount > 0 || enrichmentErrors.length > 0;

    // Save to memory cache
    memoryCache.set(memoryCacheKey, positions, MEMORY_CACHE_TTL);

    // Save to database cache (async, don't wait) - includes full config data
    if (database.isDatabaseAvailable() && positions.length > 0) {
      const dbPositions = positions.map(p => ({
        tokenId: p.tokenId,
        owner: address.toLowerCase(),
        chainId,
        poolId: p.poolId || '',
        currency0: p.poolKey?.currency0 || '',
        currency1: p.poolKey?.currency1 || '',
        fee: p.poolKey?.fee || 0,
        tickSpacing: p.poolKey?.tickSpacing || 0,
        hooks: p.poolKey?.hooks || '0x0000000000000000000000000000000000000000',
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        liquidity: p.liquidity,
        currentTick: p.currentTick || 0,
        inRange: p.inRange ?? true,
        compoundConfig: p.compoundConfig || null,
        rangeConfig: p.rangeConfig || null,
        exitConfig: p.exitConfig || null,
      }));

      database.savePositions(dbPositions).catch(err => {
        routeLogger.warn({ error: err }, 'Failed to save positions to database');
      });
    }

    routeLogger.debug({ address, count: positions.length, layer: 'chain', timedOutCount }, 'Fetched fresh');

    if (res.headersSent) return;

    // Return 206 Partial Content if some enrichments failed
    if (isPartialContent) {
      const dataCompleteness = completedCount / (completedCount + timedOutCount);
      res.setHeader('X-Data-Completeness', dataCompleteness.toFixed(2));
      res.setHeader('X-Enrichment-Errors', enrichmentErrors.length.toString());

      routeLogger.warn({
        address,
        completedCount,
        timedOutCount,
        errorsCount: enrichmentErrors.length,
      }, 'Returning partial content due to enrichment failures');

      return res.status(206).json({
        positions,
        _meta: {
          partial: true,
          completeness: dataCompleteness,
          enrichmentErrors: enrichmentErrors.slice(0, 10), // Limit errors in response
        },
      });
    }

    res.json(positions);
  } catch (error) {
    routeLogger.error({
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      address: req.params.address
    }, 'Failed to get positions');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// Get position analytics with USD metrics
router.get('/:tokenId/analytics', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const includeUSD = req.query.includeUSD !== 'false'; // Default to true
    const chainId = req.query.chainId ? parseInt(req.query.chainId as string, 10) : config.CHAIN_ID;

    const result = await subgraph.getPosition(tokenId);

    if (!(result as any).position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    const position = (result as any).position;

    // Calculate analytics
    const deposited0 = BigInt(position.depositedToken0 || '0');
    const deposited1 = BigInt(position.depositedToken1 || '0');
    const withdrawn0 = BigInt(position.withdrawnToken0 || '0');
    const withdrawn1 = BigInt(position.withdrawnToken1 || '0');
    const fees0 = BigInt(position.collectedFeesToken0 || '0');
    const fees1 = BigInt(position.collectedFeesToken1 || '0');

    const analytics: any = {
      tokenId,
      pool: position.pool,
      totalDeposited: {
        token0: deposited0.toString(),
        token1: deposited1.toString(),
      },
      totalWithdrawn: {
        token0: withdrawn0.toString(),
        token1: withdrawn1.toString(),
      },
      totalFees: {
        token0: fees0.toString(),
        token1: fees1.toString(),
      },
      currentLiquidity: position.liquidity,
      tickRange: {
        lower: position.tickLower,
        upper: position.tickUpper,
      },
      inRange: position.pool?.tick >= position.tickLower && position.pool?.tick < position.tickUpper,
    };

    // Add USD metrics if requested
    if (includeUSD) {
      try {
        const positionInfo = await blockchain.getPositionInfo(BigInt(tokenId));

        if (positionInfo?.poolKey) {
          const slot0 = await blockchain.getPoolSlot0(positionInfo.poolKey);

          // Get pending fees
          let pendingFees = { amount0: 0n, amount1: 0n };
          try {
            pendingFees = await blockchain.getPendingFees(BigInt(tokenId));
          } catch (e) {
            // Position might not be registered for compounding
          }

          // Import and use calculateUSDMetrics
          const { calculateUSDMetrics } = await import('../../services/price.js');

          const createdAt = parseInt(position.createdAtTimestamp || '0');

          const usdMetrics = await calculateUSDMetrics(
            BigInt(position.liquidity || '0'),
            slot0.sqrtPriceX96,
            position.tickLower,
            position.tickUpper,
            positionInfo.poolKey.currency0,
            positionInfo.poolKey.currency1,
            chainId,
            pendingFees,
            { amount0: fees0, amount1: fees1 },
            createdAt
          );

          analytics.usdMetrics = usdMetrics;
        }
      } catch (e) {
        routeLogger.warn({ tokenId, error: e }, 'Failed to calculate USD metrics');
        analytics.usdMetrics = null;
        analytics.usdError = 'Failed to fetch prices';
      }
    }

    if (res.headersSent) return;
    res.json(analytics);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get analytics');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get position snapshots (historical data)
router.get('/:tokenId/snapshots', async (req: Request, res: Response) => {
  try {
    // This would query snapshots from subgraph
    // For now, return empty array
    res.json([]);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get snapshots');
    res.status(500).json({ error: 'Failed to fetch snapshots' });
  }
});

// ============ Smart Rebalance Analysis ============

/**
 * Get smart rebalance analysis for a position
 * Returns center drift, urgency, recommendation, and whether to rebalance
 */
router.get('/:tokenId/smart-analysis', checkRpcHealth, async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const noCache = req.query.noCache === 'true';
    const tokenIdBigInt = BigInt(tokenId);

    // Check cache first (30 second TTL for analysis data)
    const cacheKey = `smart_analysis_${config.CHAIN_ID}_${tokenId}`;
    if (!noCache) {
      const cached = memoryCache.get<any>(cacheKey);
      if (cached) {
        routeLogger.debug({ tokenId, layer: 'memory' }, 'Smart analysis cache hit');
        return res.json(cached);
      }
    }

    // Get position status from chain (these have their own internal caching)
    const positionStatus = await blockchain.getPositionStatus(tokenIdBigInt);
    const positionInfo = await blockchain.getAutoRangePositionInfo(tokenIdBigInt);
    const rangeConfig = await blockchain.getRangeConfig(tokenIdBigInt);

    if (!positionStatus || !positionInfo) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Record price sample for volatility tracking
    const poolId = `${positionInfo.poolKey.currency0}-${positionInfo.poolKey.currency1}-${positionInfo.poolKey.fee}`;
    recordPriceSample(poolId, positionStatus.currentTick);

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

    // Get last rebalance time from contract
    let lastRebalanceTime = 0;
    try {
      lastRebalanceTime = await blockchain.getLastRebalanceTime(tokenIdBigInt);
    } catch {
      // Not found
    }

    // Make rebalance decision if range config exists
    let decision: RebalanceDecision | null = null;
    if (rangeConfig?.enabled) {
      decision = makeRebalanceDecision(
        analysis,
        volatility,
        rangeConfig,
        lastRebalanceTime
      );
    }

    // Calculate token composition estimate
    const tokenComposition = {
      token0Percent: Math.round((1 - analysis.tokenRatio) * 100),
      token1Percent: Math.round(analysis.tokenRatio * 100),
    };

    // Format response
    const response = {
      tokenId,
      analysis: {
        currentTick: analysis.currentTick,
        tickLower: analysis.tickLower,
        tickUpper: analysis.tickUpper,
        rangeCenter: analysis.rangeCenter,
        rangeWidth: analysis.rangeWidth,
        positionInRange: Math.round(analysis.positionInRange * 100), // 0-100%
        centerDrift: Math.round(analysis.centerDrift * 100), // 0-100%
        tokenComposition,
        inRange: analysis.inRange,
        urgency: analysis.urgency,
        action: analysis.action,
        reason: analysis.reason,
      },
      volatility: {
        tickVolatility: Math.round(volatility.tickVolatility * 100) / 100,
        hourlyChange: Math.round(volatility.hourlyChange * 100) / 100,
        momentum: Math.round(volatility.momentum * 100) / 100,
        trendStrength: Math.round(volatility.trendStrength * 100) / 100,
        priceDirection: volatility.momentum > 0.1 ? 'rising' : volatility.momentum < -0.1 ? 'falling' : 'stable',
      },
      decision: decision ? {
        shouldRebalance: decision.shouldRebalance,
        reason: decision.reason,
        urgency: decision.urgency,
        estimatedSavingsBps: decision.estimatedSavings,
        waitRecommendation: decision.waitRecommendation,
      } : null,
      rangeConfig: rangeConfig || null,
      lastRebalanceTime,
      cooldownRemaining: Math.max(0, 3600 - (Math.floor(Date.now() / 1000) - lastRebalanceTime)),
    };

    // Cache for 30 seconds (analysis data changes slowly)
    memoryCache.set(cacheKey, response, 30 * 1000);

    if (res.headersSent) return;
    res.json(response);
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get smart analysis');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to analyze position' });
  }
});

/**
 * Get smart analysis for multiple positions at once
 */
router.post('/batch-smart-analysis', checkRpcHealth, async (req: Request, res: Response) => {
  try {
    const { tokenIds } = req.body;

    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      return res.status(400).json({ error: 'tokenIds array required' });
    }

    // Limit batch size
    const limitedIds = tokenIds.slice(0, 20);

    const results = await Promise.all(
      limitedIds.map(async (tokenId: string) => {
        try {
          const tokenIdBigInt = BigInt(tokenId);

          // Get position data from PositionManager (more reliable than V4AutoRange)
          const [positionData, rangeConfig, lastRebalanceTime] = await Promise.all([
            blockchain.getPositionInfo(tokenIdBigInt),
            blockchain.getRangeConfig(tokenIdBigInt).catch(() => null),
            blockchain.getLastRebalanceTime(tokenIdBigInt).catch(() => 0),
          ]);

          if (!positionData || !positionData.poolKey) {
            return { tokenId, error: 'Position not found' };
          }

          // Get current tick directly from StateView
          const currentTick = await blockchain.getPoolCurrentTick(positionData.poolKey);

          // Debug logging
          routeLogger.info({
            tokenId,
            currentTick,
            tickLower: positionData.tickLower,
            tickUpper: positionData.tickUpper,
            inRange: currentTick >= positionData.tickLower && currentTick < positionData.tickUpper,
          }, 'Position analysis data');

          // Record price sample
          const poolId = `${positionData.poolKey.currency0}-${positionData.poolKey.currency1}-${positionData.poolKey.fee}`;
          recordPriceSample(poolId, currentTick);

          // Analyze using tick data from PositionManager and currentTick from StateView
          const analysis = analyzePosition(
            tokenId,
            currentTick,
            positionData.tickLower,
            positionData.tickUpper
          );

          const priceHistory = getPriceHistory(poolId);
          const volatility = calculateVolatility(priceHistory);

          // Get decision if range enabled
          let decision: RebalanceDecision | null = null;
          if (rangeConfig?.enabled) {
            decision = makeRebalanceDecision(analysis, volatility, rangeConfig, lastRebalanceTime);
          }

          // Calculate cooldown remaining
          const cooldownRemaining = Math.max(0, 3600 - (Math.floor(Date.now() / 1000) - lastRebalanceTime));

          return {
            tokenId,
            centerDrift: Math.round(analysis.centerDrift * 100),
            inRange: analysis.inRange,
            action: analysis.action,
            urgency: analysis.urgency,
            shouldRebalance: decision?.shouldRebalance || false,
            reason: decision?.reason || analysis.reason,
            cooldownRemaining,
            tokenComposition: {
              token0Percent: Math.round((1 - analysis.tokenRatio) * 100),
              token1Percent: Math.round(analysis.tokenRatio * 100),
            },
          };
        } catch (err) {
          return { tokenId, error: 'Failed to analyze' };
        }
      })
    );

    if (res.headersSent) return;
    res.json({ positions: results });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to batch analyze positions');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to analyze positions' });
  }
});

export { router as positionsRouter };
