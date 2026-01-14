import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { memoryCache, CACHE_KEYS, CACHE_TTL } from './cache.js';

const dbLogger = logger.child({ module: 'database' });

// Create pool connection
const pool = config.DATABASE_URL
  ? new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
  : null;

// Position cache interface (token IDs only)
export interface PositionCache {
  address: string;
  chainId: number;
  lastScannedBlock: string;
  tokenIds: string[];
  updatedAt: Date;
}

// Compound config interface (matches blockchain response)
export interface CompoundConfig {
  enabled: boolean;
  minCompoundInterval: number;
  minRewardAmount: bigint | string;
  autoSwap: boolean;
}

// Range config interface (matches blockchain response)
export interface RangeConfig {
  enabled: boolean;
  lowerDelta: number;
  upperDelta: number;
  rebalanceThreshold: number;
  maxSlippage: number;
}

// V4 Pool interface for pool listing
export interface V4Pool {
  id: string;
  chainId: number;
  currency0: string;
  currency1: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Logo: string | null;
  token1Logo: string | null;
  token0Decimals: number;
  token1Decimals: number;
  fee: number;
  tickSpacing: number;
  hooks: string;
  tvlUsd: number;
  volume1dUsd: number;
  volume30dUsd: number;
  fees1dUsd: number;
  poolApr: number;
  rewardApr: number | null;
  lastSyncedAt: Date;
  createdAt: Date;
}

// Chain IDs
export const CHAIN_IDS = {
  BASE: 8453,
  SEPOLIA: 11155111,
} as const;

// Full position data interface
export interface CachedPosition {
  tokenId: string;
  owner: string;
  chainId: number;
  poolId: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  currentTick: number;
  inRange: boolean;
  compoundConfig: CompoundConfig | null;
  rangeConfig: RangeConfig | null;
  updatedAt: Date;
}

// Initialize database schema
export async function initializeDatabase(): Promise<void> {
  if (!pool) {
    dbLogger.warn('No DATABASE_URL configured - position caching disabled');
    return;
  }

  try {
    // Create position_cache table if it doesn't exist (token IDs only - for fast lookups)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS position_cache (
        id SERIAL PRIMARY KEY,
        address VARCHAR(42) NOT NULL,
        chain_id INTEGER NOT NULL,
        last_scanned_block VARCHAR(78) NOT NULL,
        token_ids TEXT[] NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(address, chain_id)
      )
    `);

    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_position_cache_address_chain
      ON position_cache(address, chain_id)
    `);

    // Create positions table for full position data cache
    await pool.query(`
      CREATE TABLE IF NOT EXISTS positions (
        token_id VARCHAR(78) NOT NULL,
        chain_id INTEGER NOT NULL,
        owner VARCHAR(42) NOT NULL,
        pool_id VARCHAR(66),
        currency0 VARCHAR(42),
        currency1 VARCHAR(42),
        fee INTEGER,
        tick_spacing INTEGER,
        hooks VARCHAR(42),
        tick_lower INTEGER,
        tick_upper INTEGER,
        liquidity VARCHAR(78),
        current_tick INTEGER DEFAULT 0,
        in_range BOOLEAN DEFAULT true,
        compound_config JSONB,
        range_config JSONB,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (token_id, chain_id)
      )
    `);

    // Migration: Add JSONB columns and migrate data from old boolean columns
    await pool.query(`
      DO $$
      BEGIN
        -- Step 1: Add new JSONB columns if they don't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'positions' AND column_name = 'compound_config') THEN
          ALTER TABLE positions ADD COLUMN compound_config JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'positions' AND column_name = 'range_config') THEN
          ALTER TABLE positions ADD COLUMN range_config JSONB;
        END IF;

        -- Step 2: Migrate data from old boolean columns to new JSONB columns
        -- Only migrate if old columns exist and new columns are null
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'positions' AND column_name = 'compound_enabled') THEN
          UPDATE positions
          SET compound_config = jsonb_build_object('enabled', true, 'minCompoundInterval', 3600, 'minRewardAmount', '0', 'autoSwap', true),
              updated_at = NOW() - INTERVAL '3 minutes'  -- Mark as stale so it refreshes from chain
          WHERE compound_enabled = true AND compound_config IS NULL;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'positions' AND column_name = 'range_enabled') THEN
          UPDATE positions
          SET range_config = jsonb_build_object('enabled', true, 'lowerDelta', 600, 'upperDelta', 600, 'rebalanceThreshold', 100, 'maxSlippage', 100),
              updated_at = NOW() - INTERVAL '3 minutes'  -- Mark as stale so it refreshes from chain
          WHERE range_enabled = true AND range_config IS NULL;
        END IF;

        -- Step 3: Drop old boolean columns after migration
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'positions' AND column_name = 'compound_enabled') THEN
          ALTER TABLE positions DROP COLUMN compound_enabled;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'positions' AND column_name = 'range_enabled') THEN
          ALTER TABLE positions DROP COLUMN range_enabled;
        END IF;
      END $$;
    `);

    // Create indexes for positions table
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_positions_owner_chain
      ON positions(owner, chain_id)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_positions_updated
      ON positions(updated_at)
    `);

    // Create v4_pools table for pool listing with TVL, volume, APR
    await pool.query(`
      CREATE TABLE IF NOT EXISTS v4_pools (
        id VARCHAR(66) PRIMARY KEY,
        chain_id INTEGER NOT NULL DEFAULT 8453,
        currency0 VARCHAR(42) NOT NULL,
        currency1 VARCHAR(42) NOT NULL,
        token0_symbol VARCHAR(32),
        token1_symbol VARCHAR(32),
        token0_logo VARCHAR(512),
        token1_logo VARCHAR(512),
        token0_decimals INTEGER DEFAULT 18,
        token1_decimals INTEGER DEFAULT 18,
        fee INTEGER NOT NULL,
        tick_spacing INTEGER,
        hooks VARCHAR(42),
        tvl_usd DECIMAL(24,2) DEFAULT 0,
        volume_1d_usd DECIMAL(24,2) DEFAULT 0,
        volume_30d_usd DECIMAL(24,2) DEFAULT 0,
        fees_1d_usd DECIMAL(24,2) DEFAULT 0,
        pool_apr DECIMAL(12,4) DEFAULT 0,
        reward_apr DECIMAL(12,4),
        last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Create indexes for v4_pools
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_v4_pools_tvl ON v4_pools(tvl_usd DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_v4_pools_apr ON v4_pools(pool_apr DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_v4_pools_volume ON v4_pools(volume_1d_usd DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_v4_pools_chain ON v4_pools(chain_id)
    `);

    // Initialize notifications table
    await initializeNotificationsTable();

    dbLogger.info('Database schema initialized successfully');
  } catch (error) {
    dbLogger.error({ error }, 'Failed to initialize database schema');
    throw error;
  }
}

// Get position cache for an address (with in-memory caching)
export async function getPositionCache(
  address: string,
  chainId: number
): Promise<PositionCache | null> {
  if (!pool) {
    return null;
  }

  // Check in-memory cache first
  const cacheKey = CACHE_KEYS.positionCache(address, chainId);
  const cached = memoryCache.get<PositionCache>(cacheKey);
  if (cached) {
    dbLogger.debug({ address, chainId }, 'Position cache hit (memory)');
    return cached;
  }

  try {
    const result = await pool.query(
      `SELECT address, chain_id, last_scanned_block, token_ids, updated_at
       FROM position_cache
       WHERE LOWER(address) = LOWER($1) AND chain_id = $2`,
      [address, chainId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const positionCache: PositionCache = {
      address: row.address,
      chainId: row.chain_id,
      lastScannedBlock: row.last_scanned_block,
      tokenIds: row.token_ids || [],
      updatedAt: row.updated_at,
    };

    // Store in memory cache
    memoryCache.set(cacheKey, positionCache, CACHE_TTL.POSITION_CACHE);

    return positionCache;
  } catch (error) {
    dbLogger.error({ error, address, chainId }, 'Failed to get position cache');
    return null;
  }
}

// Save or update position cache
export async function savePositionCache(
  address: string,
  chainId: number,
  lastScannedBlock: string,
  tokenIds: string[]
): Promise<void> {
  if (!pool) {
    dbLogger.warn('No database connection - cannot save position cache');
    return;
  }

  try {
    await pool.query(
      `INSERT INTO position_cache (address, chain_id, last_scanned_block, token_ids, updated_at)
       VALUES (LOWER($1), $2, $3, $4, NOW())
       ON CONFLICT (address, chain_id)
       DO UPDATE SET
         last_scanned_block = $3,
         token_ids = $4,
         updated_at = NOW()`,
      [address.toLowerCase(), chainId, lastScannedBlock, tokenIds]
    );

    // Invalidate memory cache so next read gets fresh data
    const cacheKey = CACHE_KEYS.positionCache(address, chainId);
    memoryCache.delete(cacheKey);

    dbLogger.debug(
      { address, chainId, tokenCount: tokenIds.length, lastScannedBlock },
      'Position cache saved'
    );
  } catch (error) {
    dbLogger.error({ error, address, chainId }, 'Failed to save position cache');
    throw error;
  }
}

// Add new token IDs to existing cache (for incremental updates)
// Uses atomic PostgreSQL array operations to prevent race conditions
export async function addTokensToCache(
  address: string,
  chainId: number,
  newTokenIds: string[],
  lastScannedBlock: string
): Promise<void> {
  if (!pool || newTokenIds.length === 0) {
    return;
  }

  try {
    // Atomic upsert with array merge using PostgreSQL array functions
    // array_cat concatenates arrays, then we use a subquery to dedupe
    await pool.query(
      `INSERT INTO position_cache (address, chain_id, last_scanned_block, token_ids, updated_at)
       VALUES (LOWER($1), $2, $3, $4, NOW())
       ON CONFLICT (address, chain_id)
       DO UPDATE SET
         last_scanned_block = GREATEST(position_cache.last_scanned_block, $3),
         token_ids = (
           SELECT ARRAY(SELECT DISTINCT unnest(array_cat(position_cache.token_ids, $4)))
         ),
         updated_at = NOW()`,
      [address.toLowerCase(), chainId, lastScannedBlock, newTokenIds]
    );

    // Invalidate memory cache
    const cacheKey = CACHE_KEYS.positionCache(address, chainId);
    memoryCache.delete(cacheKey);

    dbLogger.debug(
      { address, chainId, addedCount: newTokenIds.length, lastScannedBlock },
      'Tokens added to cache (atomic)'
    );
  } catch (error) {
    dbLogger.error({ error, address, chainId }, 'Failed to add tokens to cache');
    throw error;
  }
}

// Remove token IDs from cache (when positions are burned/transferred)
// Uses atomic PostgreSQL array operations to prevent race conditions
export async function removeTokensFromCache(
  address: string,
  chainId: number,
  tokenIdsToRemove: string[]
): Promise<void> {
  if (!pool || tokenIdsToRemove.length === 0) {
    return;
  }

  try {
    // Atomic removal using PostgreSQL array_remove in a loop via unnest
    // This removes all specified tokens in a single atomic operation
    await pool.query(
      `UPDATE position_cache
       SET token_ids = (
         SELECT ARRAY(
           SELECT unnest(token_ids)
           EXCEPT
           SELECT unnest($3::text[])
         )
       ),
       updated_at = NOW()
       WHERE LOWER(address) = LOWER($1) AND chain_id = $2`,
      [address.toLowerCase(), chainId, tokenIdsToRemove]
    );

    // Invalidate memory cache
    const cacheKey = CACHE_KEYS.positionCache(address, chainId);
    memoryCache.delete(cacheKey);

    dbLogger.debug(
      { address, chainId, removedCount: tokenIdsToRemove.length },
      'Tokens removed from cache (atomic)'
    );
  } catch (error) {
    dbLogger.error({ error, address, chainId }, 'Failed to remove tokens from cache');
    throw error;
  }
}

// ============ Full Position Data Functions ============

// Get positions by owner from database cache
export async function getPositionsByOwner(
  owner: string,
  chainId: number
): Promise<CachedPosition[]> {
  if (!pool) {
    return [];
  }

  try {
    const result = await pool.query(
      `SELECT token_id, owner, chain_id, pool_id, currency0, currency1,
              fee, tick_spacing, hooks, tick_lower, tick_upper, liquidity,
              current_tick, in_range, compound_config, range_config, updated_at
       FROM positions
       WHERE LOWER(owner) = LOWER($1) AND chain_id = $2
       ORDER BY token_id DESC`,
      [owner, chainId]
    );

    return result.rows.map(row => ({
      tokenId: row.token_id,
      owner: row.owner,
      chainId: row.chain_id,
      poolId: row.pool_id,
      currency0: row.currency0,
      currency1: row.currency1,
      fee: row.fee,
      tickSpacing: row.tick_spacing,
      hooks: row.hooks,
      tickLower: row.tick_lower,
      tickUpper: row.tick_upper,
      liquidity: row.liquidity,
      currentTick: row.current_tick,
      inRange: row.in_range,
      compoundConfig: row.compound_config as CompoundConfig | null,
      rangeConfig: row.range_config as RangeConfig | null,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    dbLogger.error({ error, owner, chainId }, 'Failed to get positions by owner');
    return [];
  }
}

// Save or update a single position
export async function savePosition(position: Omit<CachedPosition, 'updatedAt'>): Promise<void> {
  if (!pool) {
    return;
  }

  // Serialize config objects for JSONB storage
  const compoundConfigJson = position.compoundConfig ? JSON.stringify({
    enabled: position.compoundConfig.enabled,
    minCompoundInterval: position.compoundConfig.minCompoundInterval,
    minRewardAmount: position.compoundConfig.minRewardAmount?.toString() || '0',
    autoSwap: position.compoundConfig.autoSwap,
  }) : null;

  const rangeConfigJson = position.rangeConfig ? JSON.stringify({
    enabled: position.rangeConfig.enabled,
    lowerDelta: position.rangeConfig.lowerDelta,
    upperDelta: position.rangeConfig.upperDelta,
    rebalanceThreshold: position.rangeConfig.rebalanceThreshold,
    maxSlippage: position.rangeConfig.maxSlippage,
  }) : null;

  try {
    await pool.query(
      `INSERT INTO positions (
        token_id, chain_id, owner, pool_id, currency0, currency1,
        fee, tick_spacing, hooks, tick_lower, tick_upper, liquidity,
        current_tick, in_range, compound_config, range_config, updated_at
      ) VALUES ($1, $2, LOWER($3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      ON CONFLICT (token_id, chain_id)
      DO UPDATE SET
        owner = LOWER($3),
        pool_id = $4,
        currency0 = $5,
        currency1 = $6,
        fee = $7,
        tick_spacing = $8,
        hooks = $9,
        tick_lower = $10,
        tick_upper = $11,
        liquidity = $12,
        current_tick = $13,
        in_range = $14,
        compound_config = $15,
        range_config = $16,
        updated_at = NOW()`,
      [
        position.tokenId,
        position.chainId,
        position.owner,
        position.poolId,
        position.currency0,
        position.currency1,
        position.fee,
        position.tickSpacing,
        position.hooks,
        position.tickLower,
        position.tickUpper,
        position.liquidity,
        position.currentTick,
        position.inRange,
        compoundConfigJson,
        rangeConfigJson,
      ]
    );
  } catch (error) {
    dbLogger.error({ error, tokenId: position.tokenId }, 'Failed to save position');
  }
}

// Batch save positions (more efficient for multiple positions)
export async function savePositions(positions: Omit<CachedPosition, 'updatedAt'>[]): Promise<void> {
  if (!pool || positions.length === 0) {
    return;
  }

  try {
    // Use a transaction for batch insert
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const position of positions) {
        // Serialize config objects for JSONB storage
        const compoundConfigJson = position.compoundConfig ? JSON.stringify({
          enabled: position.compoundConfig.enabled,
          minCompoundInterval: position.compoundConfig.minCompoundInterval,
          minRewardAmount: position.compoundConfig.minRewardAmount?.toString() || '0',
          autoSwap: position.compoundConfig.autoSwap,
        }) : null;

        const rangeConfigJson = position.rangeConfig ? JSON.stringify({
          enabled: position.rangeConfig.enabled,
          lowerDelta: position.rangeConfig.lowerDelta,
          upperDelta: position.rangeConfig.upperDelta,
          rebalanceThreshold: position.rangeConfig.rebalanceThreshold,
          maxSlippage: position.rangeConfig.maxSlippage,
        }) : null;

        await client.query(
          `INSERT INTO positions (
            token_id, chain_id, owner, pool_id, currency0, currency1,
            fee, tick_spacing, hooks, tick_lower, tick_upper, liquidity,
            current_tick, in_range, compound_config, range_config, updated_at
          ) VALUES ($1, $2, LOWER($3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          ON CONFLICT (token_id, chain_id)
          DO UPDATE SET
            owner = LOWER($3),
            pool_id = $4,
            currency0 = $5,
            currency1 = $6,
            fee = $7,
            tick_spacing = $8,
            hooks = $9,
            tick_lower = $10,
            tick_upper = $11,
            liquidity = $12,
            current_tick = $13,
            in_range = $14,
            compound_config = $15,
            range_config = $16,
            updated_at = NOW()`,
          [
            position.tokenId,
            position.chainId,
            position.owner,
            position.poolId,
            position.currency0,
            position.currency1,
            position.fee,
            position.tickSpacing,
            position.hooks,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            position.currentTick,
            position.inRange,
            compoundConfigJson,
            rangeConfigJson,
          ]
        );
      }

      await client.query('COMMIT');
      dbLogger.debug({ count: positions.length }, 'Batch saved positions');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    dbLogger.error({ error, count: positions.length }, 'Failed to batch save positions');
  }
}

// Delete position (when burned or transferred)
export async function deletePosition(tokenId: string, chainId: number): Promise<void> {
  if (!pool) {
    return;
  }

  try {
    await pool.query(
      `DELETE FROM positions WHERE token_id = $1 AND chain_id = $2`,
      [tokenId, chainId]
    );
  } catch (error) {
    dbLogger.error({ error, tokenId, chainId }, 'Failed to delete position');
  }
}

// Get stale positions (not updated in the last N minutes)
export async function getStalePositions(
  chainId: number,
  staleMinutes: number = 5
): Promise<CachedPosition[]> {
  if (!pool) {
    return [];
  }

  // Validate staleMinutes to prevent injection (must be positive integer)
  const sanitizedMinutes = Math.max(1, Math.floor(Math.abs(staleMinutes)));

  try {
    const result = await pool.query(
      `SELECT token_id, owner, chain_id, pool_id, currency0, currency1,
              fee, tick_spacing, hooks, tick_lower, tick_upper, liquidity,
              current_tick, in_range, compound_config, range_config, updated_at
       FROM positions
       WHERE chain_id = $1 AND updated_at < NOW() - make_interval(mins => $2)
       ORDER BY updated_at ASC
       LIMIT 100`,
      [chainId, sanitizedMinutes]
    );

    return result.rows.map(row => ({
      tokenId: row.token_id,
      owner: row.owner,
      chainId: row.chain_id,
      poolId: row.pool_id,
      currency0: row.currency0,
      currency1: row.currency1,
      fee: row.fee,
      tickSpacing: row.tick_spacing,
      hooks: row.hooks,
      tickLower: row.tick_lower,
      tickUpper: row.tick_upper,
      liquidity: row.liquidity,
      currentTick: row.current_tick,
      inRange: row.in_range,
      compoundConfig: row.compound_config as CompoundConfig | null,
      rangeConfig: row.range_config as RangeConfig | null,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    dbLogger.error({ error, chainId }, 'Failed to get stale positions');
    return [];
  }
}

// Check if database is available
export function isDatabaseAvailable(): boolean {
  return pool !== null;
}

// Close database connections
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    dbLogger.info('Database connections closed');
  }
}

// Health check - verify database connectivity
export async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  if (!pool) {
    return { healthy: false, latencyMs: 0, error: 'No database connection configured' };
  }

  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Get database stats
export async function getStats(): Promise<{
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
}> {
  if (!pool) {
    return { totalConnections: 0, idleConnections: 0, waitingClients: 0 };
  }

  return {
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    waitingClients: pool.waitingCount,
  };
}

// ============ V4 Pool Functions ============

// Get pools with pagination and sorting
export async function getV4Pools(options: {
  chainId?: number;
  page?: number;
  limit?: number;
  sortBy?: 'tvl' | 'apr' | 'volume1d' | 'volume30d' | 'fee';
  sortOrder?: 'asc' | 'desc';
}): Promise<{ pools: V4Pool[]; total: number }> {
  if (!pool) {
    return { pools: [], total: 0 };
  }

  const {
    chainId = 8453,
    page = 1,
    limit = 20,
    sortBy = 'apr',
    sortOrder = 'desc',
  } = options;

  const offset = (page - 1) * limit;

  // Map sortBy to column names
  const sortColumnMap: Record<string, string> = {
    tvl: 'tvl_usd',
    apr: 'pool_apr',
    volume1d: 'volume_1d_usd',
    volume30d: 'volume_30d_usd',
    fee: 'fee',
  };
  const sortColumn = sortColumnMap[sortBy] || 'pool_apr';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

  try {
    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM v4_pools WHERE chain_id = $1`,
      [chainId]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get paginated pools
    const result = await pool.query(
      `SELECT id, chain_id, currency0, currency1, token0_symbol, token1_symbol,
              token0_logo, token1_logo, token0_decimals, token1_decimals,
              fee, tick_spacing, hooks, tvl_usd, volume_1d_usd, volume_30d_usd,
              fees_1d_usd, pool_apr, reward_apr, last_synced_at, created_at
       FROM v4_pools
       WHERE chain_id = $1
       ORDER BY ${sortColumn} ${order} NULLS LAST
       LIMIT $2 OFFSET $3`,
      [chainId, limit, offset]
    );

    const pools: V4Pool[] = result.rows.map(row => ({
      id: row.id,
      chainId: row.chain_id,
      currency0: row.currency0,
      currency1: row.currency1,
      token0Symbol: row.token0_symbol || 'UNKNOWN',
      token1Symbol: row.token1_symbol || 'UNKNOWN',
      token0Logo: row.token0_logo,
      token1Logo: row.token1_logo,
      token0Decimals: row.token0_decimals || 18,
      token1Decimals: row.token1_decimals || 18,
      fee: row.fee,
      tickSpacing: row.tick_spacing,
      hooks: row.hooks,
      tvlUsd: parseFloat(row.tvl_usd) || 0,
      volume1dUsd: parseFloat(row.volume_1d_usd) || 0,
      volume30dUsd: parseFloat(row.volume_30d_usd) || 0,
      fees1dUsd: parseFloat(row.fees_1d_usd) || 0,
      poolApr: parseFloat(row.pool_apr) || 0,
      rewardApr: row.reward_apr ? parseFloat(row.reward_apr) : null,
      lastSyncedAt: row.last_synced_at,
      createdAt: row.created_at,
    }));

    return { pools, total };
  } catch (error) {
    dbLogger.error({ error, chainId }, 'Failed to get v4 pools');
    return { pools: [], total: 0 };
  }
}

// Upsert a single pool
export async function upsertV4Pool(poolData: Partial<V4Pool> & { id: string; currency0: string; currency1: string; fee: number }): Promise<void> {
  if (!pool) {
    return;
  }

  try {
    await pool.query(
      `INSERT INTO v4_pools (
        id, chain_id, currency0, currency1, token0_symbol, token1_symbol,
        token0_logo, token1_logo, token0_decimals, token1_decimals,
        fee, tick_spacing, hooks, tvl_usd, volume_1d_usd, volume_30d_usd,
        fees_1d_usd, pool_apr, reward_apr, last_synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        token0_symbol = COALESCE($5, v4_pools.token0_symbol),
        token1_symbol = COALESCE($6, v4_pools.token1_symbol),
        token0_logo = COALESCE($7, v4_pools.token0_logo),
        token1_logo = COALESCE($8, v4_pools.token1_logo),
        token0_decimals = COALESCE($9, v4_pools.token0_decimals),
        token1_decimals = COALESCE($10, v4_pools.token1_decimals),
        fee = $11,
        tick_spacing = COALESCE($12, v4_pools.tick_spacing),
        hooks = COALESCE($13, v4_pools.hooks),
        tvl_usd = $14,
        volume_1d_usd = $15,
        volume_30d_usd = $16,
        fees_1d_usd = $17,
        pool_apr = $18,
        reward_apr = $19,
        last_synced_at = NOW()`,
      [
        poolData.id,
        8453, // Base mainnet
        poolData.currency0,
        poolData.currency1,
        poolData.token0Symbol || null,
        poolData.token1Symbol || null,
        poolData.token0Logo || null,
        poolData.token1Logo || null,
        poolData.token0Decimals || 18,
        poolData.token1Decimals || 18,
        poolData.fee,
        poolData.tickSpacing || null,
        poolData.hooks || null,
        poolData.tvlUsd || 0,
        poolData.volume1dUsd || 0,
        poolData.volume30dUsd || 0,
        poolData.fees1dUsd || 0,
        poolData.poolApr || 0,
        poolData.rewardApr || null,
      ]
    );
  } catch (error) {
    dbLogger.error({ error, poolId: poolData.id }, 'Failed to upsert v4 pool');
  }
}

// Batch upsert pools (more efficient for sync)
export async function batchUpsertV4Pools(poolsData: Array<Partial<V4Pool> & { id: string; currency0: string; currency1: string; fee: number }>): Promise<void> {
  if (!pool || poolsData.length === 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const poolData of poolsData) {
      await client.query(
        `INSERT INTO v4_pools (
          id, chain_id, currency0, currency1, token0_symbol, token1_symbol,
          token0_logo, token1_logo, token0_decimals, token1_decimals,
          fee, tick_spacing, hooks, tvl_usd, volume_1d_usd, volume_30d_usd,
          fees_1d_usd, pool_apr, reward_apr, last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          token0_symbol = COALESCE($5, v4_pools.token0_symbol),
          token1_symbol = COALESCE($6, v4_pools.token1_symbol),
          token0_logo = COALESCE($7, v4_pools.token0_logo),
          token1_logo = COALESCE($8, v4_pools.token1_logo),
          token0_decimals = COALESCE($9, v4_pools.token0_decimals),
          token1_decimals = COALESCE($10, v4_pools.token1_decimals),
          fee = $11,
          tick_spacing = COALESCE($12, v4_pools.tick_spacing),
          hooks = COALESCE($13, v4_pools.hooks),
          tvl_usd = $14,
          volume_1d_usd = $15,
          volume_30d_usd = $16,
          fees_1d_usd = $17,
          pool_apr = $18,
          reward_apr = $19,
          last_synced_at = NOW()`,
        [
          poolData.id,
          8453,
          poolData.currency0,
          poolData.currency1,
          poolData.token0Symbol || null,
          poolData.token1Symbol || null,
          poolData.token0Logo || null,
          poolData.token1Logo || null,
          poolData.token0Decimals || 18,
          poolData.token1Decimals || 18,
          poolData.fee,
          poolData.tickSpacing || null,
          poolData.hooks || null,
          poolData.tvlUsd || 0,
          poolData.volume1dUsd || 0,
          poolData.volume30dUsd || 0,
          poolData.fees1dUsd || 0,
          poolData.poolApr || 0,
          poolData.rewardApr || null,
        ]
      );
    }

    await client.query('COMMIT');
    dbLogger.info({ count: poolsData.length }, 'Batch upserted v4 pools');
  } catch (error) {
    await client.query('ROLLBACK');
    dbLogger.error({ error, count: poolsData.length }, 'Failed to batch upsert v4 pools');
    throw error;
  } finally {
    client.release();
  }
}

// Get last sync time for pools
export async function getPoolsLastSyncTime(chainId: number = 8453): Promise<Date | null> {
  if (!pool) {
    return null;
  }

  try {
    const result = await pool.query(
      `SELECT MAX(last_synced_at) as last_sync FROM v4_pools WHERE chain_id = $1`,
      [chainId]
    );
    return result.rows[0]?.last_sync || null;
  } catch (error) {
    dbLogger.error({ error }, 'Failed to get pools last sync time');
    return null;
  }
}

// ============ Notifications Functions ============

export type NotificationType =
  // Automated notifications
  | 'compound_profitable'
  | 'rebalance_needed'
  | 'position_out_of_range'
  | 'high_fees_accumulated'
  | 'gas_price_low'
  | 'position_liquidatable'
  | 'compound_executed'
  | 'rebalance_executed'
  // User action notifications
  | 'position_created'
  | 'liquidity_increased'
  | 'liquidity_decreased'
  | 'fees_collected'
  | 'position_closed'
  | 'auto_compound_enabled'
  | 'auto_compound_disabled'
  | 'auto_range_enabled'
  | 'auto_range_disabled';

export interface DbNotification {
  id: string;
  type: NotificationType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  positionId: string | null;
  owner: string;
  data: Record<string, unknown> | null;
  timestamp: Date;
  read: boolean;
}

// Initialize notifications table (called from initializeDatabase)
export async function initializeNotificationsTable(): Promise<void> {
  if (!pool) {
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(64) PRIMARY KEY,
        type VARCHAR(32) NOT NULL,
        severity VARCHAR(16) NOT NULL DEFAULT 'info',
        title VARCHAR(256) NOT NULL,
        message TEXT NOT NULL,
        position_id VARCHAR(78),
        owner VARCHAR(42) NOT NULL,
        data JSONB,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        read BOOLEAN DEFAULT false
      )
    `);

    // Create indexes for notifications
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_owner
      ON notifications(LOWER(owner))
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_owner_timestamp
      ON notifications(LOWER(owner), timestamp DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_type
      ON notifications(type)
    `);

    dbLogger.info('Notifications table initialized');
  } catch (error) {
    dbLogger.error({ error }, 'Failed to initialize notifications table');
  }
}

// Create a notification in the database
export async function createDbNotification(notification: Omit<DbNotification, 'timestamp'>): Promise<DbNotification | null> {
  if (!pool) {
    return null;
  }

  try {
    const result = await pool.query(
      `INSERT INTO notifications (id, type, severity, title, message, position_id, owner, data, read, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, LOWER($7), $8, $9, NOW())
       RETURNING id, type, severity, title, message, position_id, owner, data, timestamp, read`,
      [
        notification.id,
        notification.type,
        notification.severity,
        notification.title,
        notification.message,
        notification.positionId,
        notification.owner,
        notification.data ? JSON.stringify(notification.data) : null,
        notification.read,
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      message: row.message,
      positionId: row.position_id,
      owner: row.owner,
      data: row.data,
      timestamp: row.timestamp,
      read: row.read,
    };
  } catch (error) {
    dbLogger.error({ error, notificationId: notification.id }, 'Failed to create notification');
    return null;
  }
}

// Get notifications for a user from database
export async function getDbNotifications(owner: string, limit: number = 50): Promise<DbNotification[]> {
  if (!pool) {
    return [];
  }

  try {
    const result = await pool.query(
      `SELECT id, type, severity, title, message, position_id, owner, data, timestamp, read
       FROM notifications
       WHERE LOWER(owner) = LOWER($1) OR LOWER(owner) = 'global'
       ORDER BY timestamp DESC
       LIMIT $2`,
      [owner, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      message: row.message,
      positionId: row.position_id,
      owner: row.owner,
      data: row.data,
      timestamp: row.timestamp,
      read: row.read,
    }));
  } catch (error) {
    dbLogger.error({ error, owner }, 'Failed to get notifications');
    return [];
  }
}

// Mark a notification as read
export async function markNotificationAsRead(owner: string, notificationId: string): Promise<boolean> {
  if (!pool) {
    return false;
  }

  try {
    const result = await pool.query(
      `UPDATE notifications
       SET read = true
       WHERE id = $1 AND LOWER(owner) = LOWER($2)`,
      [notificationId, owner]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    dbLogger.error({ error, notificationId, owner }, 'Failed to mark notification as read');
    return false;
  }
}

// Mark all notifications as read for a user
export async function markAllNotificationsAsRead(owner: string): Promise<number> {
  if (!pool) {
    return 0;
  }

  try {
    const result = await pool.query(
      `UPDATE notifications
       SET read = true
       WHERE LOWER(owner) = LOWER($1) AND read = false`,
      [owner]
    );
    return result.rowCount ?? 0;
  } catch (error) {
    dbLogger.error({ error, owner }, 'Failed to mark all notifications as read');
    return 0;
  }
}

// Delete old notifications (cleanup job)
export async function cleanupOldNotifications(daysOld: number = 30): Promise<number> {
  if (!pool) {
    return 0;
  }

  try {
    const result = await pool.query(
      `DELETE FROM notifications
       WHERE timestamp < NOW() - make_interval(days => $1)`,
      [daysOld]
    );
    const deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      dbLogger.info({ deleted, daysOld }, 'Cleaned up old notifications');
    }
    return deleted;
  } catch (error) {
    dbLogger.error({ error, daysOld }, 'Failed to cleanup old notifications');
    return 0;
  }
}

// Get unread notification count for a user
export async function getUnreadNotificationCount(owner: string): Promise<number> {
  if (!pool) {
    return 0;
  }

  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM notifications
       WHERE (LOWER(owner) = LOWER($1) OR LOWER(owner) = 'global') AND read = false`,
      [owner]
    );
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    dbLogger.error({ error, owner }, 'Failed to get unread notification count');
    return 0;
  }
}

// Export pool for direct queries if needed
export { pool };
