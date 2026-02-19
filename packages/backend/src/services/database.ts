import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { memoryCache, CACHE_KEYS, CACHE_TTL } from './cache.js';

const dbLogger = logger.child({ module: 'database' });

// Configuration
const DB_CONFIG = {
  STATEMENT_TIMEOUT_MS: 30000, // 30 second query timeout
  SLOW_QUERY_THRESHOLD_MS: 100, // Log queries taking longer than 100ms
  MAX_CONNECTIONS: 20,
  IDLE_TIMEOUT_MS: 30000,
  CONNECTION_TIMEOUT_MS: 2000,
};

// Create pool connection with statement timeout
const pool = config.DATABASE_URL
  ? new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: DB_CONFIG.MAX_CONNECTIONS,
      idleTimeoutMillis: DB_CONFIG.IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DB_CONFIG.CONNECTION_TIMEOUT_MS,
      statement_timeout: DB_CONFIG.STATEMENT_TIMEOUT_MS,
    })
  : null;

// Track slow queries
interface QueryMetrics {
  totalQueries: number;
  slowQueries: number;
  totalDurationMs: number;
  errors: number;
}

const queryMetrics: QueryMetrics = {
  totalQueries: 0,
  slowQueries: 0,
  totalDurationMs: 0,
  errors: 0,
};

/**
 * Execute a query with timing and slow query logging
 */
async function timedQuery<T extends pg.QueryResultRow>(
  client: pg.Pool | pg.PoolClient,
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  queryMetrics.totalQueries++;

  try {
    const result = await client.query<T>(text, params);
    const duration = Date.now() - start;
    queryMetrics.totalDurationMs += duration;

    if (duration > DB_CONFIG.SLOW_QUERY_THRESHOLD_MS) {
      queryMetrics.slowQueries++;
      dbLogger.warn(
        {
          duration,
          queryPreview: text.substring(0, 100),
          paramCount: params?.length || 0,
        },
        'Slow query detected'
      );
    }

    return result;
  } catch (error) {
    queryMetrics.errors++;
    throw error;
  }
}

/**
 * Get query metrics for monitoring
 */
export function getQueryMetrics(): QueryMetrics & { avgDurationMs: number } {
  return {
    ...queryMetrics,
    avgDurationMs:
      queryMetrics.totalQueries > 0
        ? Math.round(queryMetrics.totalDurationMs / queryMetrics.totalQueries)
        : 0,
  };
}

/**
 * Reset query metrics
 */
export function resetQueryMetrics(): void {
  queryMetrics.totalQueries = 0;
  queryMetrics.slowQueries = 0;
  queryMetrics.totalDurationMs = 0;
  queryMetrics.errors = 0;
}

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

// Exit config interface (matches blockchain response)
export interface ExitConfig {
  enabled: boolean;
  triggerTickLower: number;
  triggerTickUpper: number;
  exitOnRangeExit: boolean;
  exitToken: string;
  maxSwapSlippage: string;
  minExitInterval: number;
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
  exitConfig: ExitConfig | null;
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

        -- Step 4: Add exit_config JSONB column if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'positions' AND column_name = 'exit_config') THEN
          ALTER TABLE positions ADD COLUMN exit_config JSONB;
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

    // Additional indexes for performance (Phase 2.4)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_positions_owner
      ON positions(owner)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_positions_liquidity
      ON positions(liquidity) WHERE liquidity > '0'
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_positions_updated_desc
      ON positions(updated_at DESC)
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

    // Initialize webhook subscriptions table (persists webhooks across restarts)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id VARCHAR(64) PRIMARY KEY,
        url VARCHAR(2048) NOT NULL,
        events TEXT[] NOT NULL DEFAULT '{}',
        owner VARCHAR(42) NOT NULL,
        secret VARCHAR(256),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ws_owner ON webhook_subscriptions(LOWER(owner))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ws_active ON webhook_subscriptions(active) WHERE active = true`);

    // Initialize webhook deliveries table (tracks delivery attempts and status)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id SERIAL PRIMARY KEY,
        webhook_id VARCHAR(64) NOT NULL,
        notification_id VARCHAR(64) NOT NULL,
        attempts INTEGER DEFAULT 0,
        last_attempt TIMESTAMP WITH TIME ZONE,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        last_error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wd_status ON webhook_deliveries(status) WHERE status = 'failed'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wd_created ON webhook_deliveries(created_at DESC)`);

    // Initialize price samples table (persists price history for volatility calculations)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS price_samples (
        id BIGSERIAL PRIMARY KEY,
        pool_id VARCHAR(256) NOT NULL,
        tick INTEGER NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ps_pool_ts ON price_samples(pool_id, timestamp DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ps_cleanup ON price_samples(timestamp)`);

    // Initialize event cache table (persists blockchain events for fast recovery)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS event_cache (
        id BIGSERIAL PRIMARY KEY,
        event_type VARCHAR(32) NOT NULL,
        token_id VARCHAR(78) NOT NULL,
        block_number BIGINT NOT NULL,
        log_index INTEGER NOT NULL DEFAULT 0,
        data JSONB,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(event_type, block_number, log_index)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ec_type_token ON event_cache(event_type, token_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ec_block ON event_cache(block_number DESC)`);

    // Create token_prices table for DB-cached pricing (Phase 2)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS token_prices (
        address VARCHAR(42) NOT NULL,
        chain_id INTEGER NOT NULL,
        symbol VARCHAR(32),
        decimals INTEGER DEFAULT 18,
        price_usd DECIMAL(24,8),
        derived_eth DECIMAL(24,18),
        source VARCHAR(32),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (address, chain_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tp_updated ON token_prices(updated_at DESC)`);

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
    const result = await timedQuery(
      pool,
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
    const result = await timedQuery(
      pool,
      `SELECT token_id, owner, chain_id, pool_id, currency0, currency1,
              fee, tick_spacing, hooks, tick_lower, tick_upper, liquidity,
              current_tick, in_range, compound_config, range_config, exit_config, updated_at
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
      exitConfig: row.exit_config as ExitConfig | null,
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

  const exitConfigJson = position.exitConfig ? JSON.stringify(position.exitConfig) : null;

  try {
    await pool.query(
      `INSERT INTO positions (
        token_id, chain_id, owner, pool_id, currency0, currency1,
        fee, tick_spacing, hooks, tick_lower, tick_upper, liquidity,
        current_tick, in_range, compound_config, range_config, exit_config, updated_at
      ) VALUES ($1, $2, LOWER($3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
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
        exit_config = $17,
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
        exitConfigJson,
      ]
    );
  } catch (error) {
    dbLogger.error({ error, tokenId: position.tokenId }, 'Failed to save position');
  }
}

// Batch save positions (optimized with multi-row INSERT using unnest)
export async function savePositions(positions: Omit<CachedPosition, 'updatedAt'>[]): Promise<void> {
  if (!pool || positions.length === 0) {
    return;
  }

  try {
    // Prepare arrays for batch insert using unnest
    const tokenIds: string[] = [];
    const chainIds: number[] = [];
    const owners: string[] = [];
    const poolIds: string[] = [];
    const currency0s: string[] = [];
    const currency1s: string[] = [];
    const fees: number[] = [];
    const tickSpacings: number[] = [];
    const hooksList: string[] = [];
    const tickLowers: number[] = [];
    const tickUppers: number[] = [];
    const liquidities: string[] = [];
    const currentTicks: number[] = [];
    const inRanges: boolean[] = [];
    const compoundConfigs: (string | null)[] = [];
    const rangeConfigs: (string | null)[] = [];
    const exitConfigs: (string | null)[] = [];

    for (const position of positions) {
      tokenIds.push(position.tokenId);
      chainIds.push(position.chainId);
      owners.push(position.owner.toLowerCase());
      poolIds.push(position.poolId);
      currency0s.push(position.currency0);
      currency1s.push(position.currency1);
      fees.push(position.fee);
      tickSpacings.push(position.tickSpacing);
      hooksList.push(position.hooks);
      tickLowers.push(position.tickLower);
      tickUppers.push(position.tickUpper);
      liquidities.push(position.liquidity);
      currentTicks.push(position.currentTick);
      inRanges.push(position.inRange);

      // Serialize config objects for JSONB storage
      compoundConfigs.push(
        position.compoundConfig
          ? JSON.stringify({
              enabled: position.compoundConfig.enabled,
              minCompoundInterval: position.compoundConfig.minCompoundInterval,
              minRewardAmount: position.compoundConfig.minRewardAmount?.toString() || '0',
              autoSwap: position.compoundConfig.autoSwap,
            })
          : null
      );

      rangeConfigs.push(
        position.rangeConfig
          ? JSON.stringify({
              enabled: position.rangeConfig.enabled,
              lowerDelta: position.rangeConfig.lowerDelta,
              upperDelta: position.rangeConfig.upperDelta,
              rebalanceThreshold: position.rangeConfig.rebalanceThreshold,
              maxSlippage: position.rangeConfig.maxSlippage,
            })
          : null
      );

      exitConfigs.push(
        position.exitConfig ? JSON.stringify(position.exitConfig) : null
      );
    }

    // Use unnest for efficient multi-row INSERT
    await timedQuery(
      pool,
      `INSERT INTO positions (
        token_id, chain_id, owner, pool_id, currency0, currency1,
        fee, tick_spacing, hooks, tick_lower, tick_upper, liquidity,
        current_tick, in_range, compound_config, range_config, exit_config, updated_at
      )
      SELECT * FROM unnest(
        $1::varchar[], $2::integer[], $3::varchar[], $4::varchar[],
        $5::varchar[], $6::varchar[], $7::integer[], $8::integer[],
        $9::varchar[], $10::integer[], $11::integer[], $12::varchar[],
        $13::integer[], $14::boolean[], $15::jsonb[], $16::jsonb[], $17::jsonb[]
      ) AS t(
        token_id, chain_id, owner, pool_id, currency0, currency1,
        fee, tick_spacing, hooks, tick_lower, tick_upper, liquidity,
        current_tick, in_range, compound_config, range_config, exit_config
      ),
      LATERAL (SELECT NOW() AS updated_at) AS time_val
      ON CONFLICT (token_id, chain_id)
      DO UPDATE SET
        owner = EXCLUDED.owner,
        pool_id = EXCLUDED.pool_id,
        currency0 = EXCLUDED.currency0,
        currency1 = EXCLUDED.currency1,
        fee = EXCLUDED.fee,
        tick_spacing = EXCLUDED.tick_spacing,
        hooks = EXCLUDED.hooks,
        tick_lower = EXCLUDED.tick_lower,
        tick_upper = EXCLUDED.tick_upper,
        liquidity = EXCLUDED.liquidity,
        current_tick = EXCLUDED.current_tick,
        in_range = EXCLUDED.in_range,
        compound_config = EXCLUDED.compound_config,
        range_config = EXCLUDED.range_config,
        exit_config = EXCLUDED.exit_config,
        updated_at = NOW()`,
      [
        tokenIds,
        chainIds,
        owners,
        poolIds,
        currency0s,
        currency1s,
        fees,
        tickSpacings,
        hooksList,
        tickLowers,
        tickUppers,
        liquidities,
        currentTicks,
        inRanges,
        compoundConfigs,
        rangeConfigs,
        exitConfigs,
      ]
    );

    dbLogger.debug({ count: positions.length }, 'Batch saved positions (optimized)');
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
              current_tick, in_range, compound_config, range_config, exit_config, updated_at
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
      exitConfig: row.exit_config as ExitConfig | null,
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

// ============ Batch Config Functions (Phase 1 DB Caching) ============

/**
 * Batch read automation configs for multiple positions from DB.
 * Returns a Map keyed by tokenId with compound, range, and exit configs.
 */
export async function getPositionConfigs(
  tokenIds: string[],
  chainId: number = 8453
): Promise<Map<string, { compoundConfig: CompoundConfig | null; rangeConfig: RangeConfig | null; exitConfig: ExitConfig | null }>> {
  const result = new Map<string, { compoundConfig: CompoundConfig | null; rangeConfig: RangeConfig | null; exitConfig: ExitConfig | null }>();

  if (!pool || tokenIds.length === 0) {
    return result;
  }

  try {
    const queryResult = await timedQuery(
      pool,
      `SELECT token_id, compound_config, range_config, exit_config
       FROM positions
       WHERE token_id = ANY($1) AND chain_id = $2`,
      [tokenIds, chainId]
    );

    for (const row of queryResult.rows) {
      result.set(row.token_id, {
        compoundConfig: row.compound_config as CompoundConfig | null,
        rangeConfig: row.range_config as RangeConfig | null,
        exitConfig: row.exit_config as ExitConfig | null,
      });
    }

    dbLogger.debug({ count: queryResult.rows.length, requested: tokenIds.length }, 'Batch read position configs from DB');
  } catch (error) {
    dbLogger.error({ error, count: tokenIds.length }, 'Failed to batch read position configs');
  }

  return result;
}

/**
 * Update a specific config column for a position (write-through cache).
 */
export async function updatePositionConfig(
  tokenId: string,
  chainId: number,
  configType: 'compound_config' | 'range_config' | 'exit_config',
  configData: CompoundConfig | RangeConfig | ExitConfig | null
): Promise<void> {
  if (!pool) return;

  // Serialize bigint values for JSONB storage
  const jsonData = configData ? JSON.stringify(configData, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ) : null;

  try {
    await pool.query(
      `UPDATE positions SET ${configType} = $1, updated_at = NOW()
       WHERE token_id = $2 AND chain_id = $3`,
      [jsonData, tokenId, chainId]
    );
  } catch (error) {
    dbLogger.error({ error, tokenId, configType }, 'Failed to update position config');
  }
}

/**
 * Batch update configs for multiple positions (used by sync job).
 */
export async function batchUpdatePositionConfigs(
  updates: Array<{
    tokenId: string;
    chainId: number;
    compoundConfig?: CompoundConfig | null;
    rangeConfig?: RangeConfig | null;
    exitConfig?: ExitConfig | null;
  }>
): Promise<void> {
  if (!pool || updates.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const update of updates) {
      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (update.compoundConfig !== undefined) {
        setClauses.push(`compound_config = $${paramIdx++}`);
        params.push(update.compoundConfig ? JSON.stringify(update.compoundConfig, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        ) : null);
      }
      if (update.rangeConfig !== undefined) {
        setClauses.push(`range_config = $${paramIdx++}`);
        params.push(update.rangeConfig ? JSON.stringify(update.rangeConfig, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        ) : null);
      }
      if (update.exitConfig !== undefined) {
        setClauses.push(`exit_config = $${paramIdx++}`);
        params.push(update.exitConfig ? JSON.stringify(update.exitConfig, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        ) : null);
      }

      if (setClauses.length === 0) continue;

      setClauses.push('updated_at = NOW()');
      params.push(update.tokenId, update.chainId);

      await client.query(
        `UPDATE positions SET ${setClauses.join(', ')}
         WHERE token_id = $${paramIdx++} AND chain_id = $${paramIdx}`,
        params
      );
    }

    await client.query('COMMIT');
    dbLogger.debug({ count: updates.length }, 'Batch updated position configs');
  } catch (error) {
    await client.query('ROLLBACK');
    dbLogger.error({ error, count: updates.length }, 'Failed to batch update position configs');
  } finally {
    client.release();
  }
}

/**
 * Get positions with active liquidity that have null configs (need syncing).
 * Used by the background sync job to find positions needing config refresh.
 */
export async function getPositionsNeedingConfigSync(
  chainId: number = 8453,
  limit: number = 50
): Promise<Array<{ tokenId: string; compoundConfig: CompoundConfig | null; rangeConfig: RangeConfig | null; exitConfig: ExitConfig | null }>> {
  if (!pool) return [];

  try {
    const result = await timedQuery(
      pool,
      `SELECT token_id, compound_config, range_config, exit_config
       FROM positions
       WHERE chain_id = $1
         AND liquidity != '0'
         AND (compound_config IS NULL OR range_config IS NULL OR exit_config IS NULL)
       ORDER BY updated_at ASC
       LIMIT $2`,
      [chainId, limit]
    );

    return result.rows.map(row => ({
      tokenId: row.token_id,
      compoundConfig: row.compound_config as CompoundConfig | null,
      rangeConfig: row.range_config as RangeConfig | null,
      exitConfig: row.exit_config as ExitConfig | null,
    }));
  } catch (error) {
    dbLogger.error({ error }, 'Failed to get positions needing config sync');
    return [];
  }
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

// ============ Webhook Subscription Functions ============

export interface DbWebhookSubscription {
  id: string;
  url: string;
  events: string[];
  owner: string;
  secret?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function createWebhookSubscription(sub: {
  id: string;
  url: string;
  events: string[];
  owner: string;
  secret?: string;
  active: boolean;
}): Promise<void> {
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO webhook_subscriptions (id, url, events, owner, secret, active)
       VALUES ($1, $2, $3, LOWER($4), $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         url = $2, events = $3, secret = $5, active = $6, updated_at = NOW()`,
      [sub.id, sub.url, sub.events, sub.owner, sub.secret || null, sub.active]
    );
  } catch (error) {
    dbLogger.error({ error, id: sub.id }, 'Failed to create webhook subscription');
  }
}

export async function getWebhooksByOwner(owner: string): Promise<DbWebhookSubscription[]> {
  if (!pool) return [];

  try {
    const result = await pool.query(
      `SELECT id, url, events, owner, secret, active, created_at, updated_at
       FROM webhook_subscriptions
       WHERE LOWER(owner) = LOWER($1) AND active = true`,
      [owner]
    );
    return result.rows.map(row => ({
      id: row.id,
      url: row.url,
      events: row.events || [],
      owner: row.owner,
      secret: row.secret || undefined,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    dbLogger.error({ error, owner }, 'Failed to get webhooks by owner');
    return [];
  }
}

export async function deleteWebhookSubscription(id: string, owner: string): Promise<boolean> {
  if (!pool) return false;

  try {
    const result = await pool.query(
      `DELETE FROM webhook_subscriptions WHERE id = $1 AND LOWER(owner) = LOWER($2)`,
      [id, owner]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    dbLogger.error({ error, id }, 'Failed to delete webhook subscription');
    return false;
  }
}

export async function getAllActiveWebhooks(): Promise<DbWebhookSubscription[]> {
  if (!pool) return [];

  try {
    const result = await pool.query(
      `SELECT id, url, events, owner, secret, active, created_at, updated_at
       FROM webhook_subscriptions WHERE active = true`
    );
    return result.rows.map(row => ({
      id: row.id,
      url: row.url,
      events: row.events || [],
      owner: row.owner,
      secret: row.secret || undefined,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    dbLogger.error({ error }, 'Failed to get all active webhooks');
    return [];
  }
}

// ============ Webhook Delivery Functions ============

export async function upsertWebhookDelivery(delivery: {
  webhookId: string;
  notificationId: string;
  attempts: number;
  status: 'pending' | 'success' | 'failed';
  lastError?: string;
}): Promise<void> {
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO webhook_deliveries (webhook_id, notification_id, attempts, last_attempt, status, last_error)
       VALUES ($1, $2, $3, NOW(), $4, $5)`,
      [delivery.webhookId, delivery.notificationId, delivery.attempts, delivery.status, delivery.lastError || null]
    );
  } catch (error) {
    dbLogger.error({ error, webhookId: delivery.webhookId }, 'Failed to upsert webhook delivery');
  }
}

export async function getRecentFailedDeliveries(limit: number = 20): Promise<Array<{
  webhookId: string;
  notificationId: string;
  attempts: number;
  lastAttempt: Date;
  status: string;
  lastError?: string;
}>> {
  if (!pool) return [];

  try {
    const result = await pool.query(
      `SELECT webhook_id, notification_id, attempts, last_attempt, status, last_error
       FROM webhook_deliveries
       WHERE status = 'failed'
       ORDER BY last_attempt DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(row => ({
      webhookId: row.webhook_id,
      notificationId: row.notification_id,
      attempts: row.attempts,
      lastAttempt: row.last_attempt,
      status: row.status,
      lastError: row.last_error || undefined,
    }));
  } catch (error) {
    dbLogger.error({ error }, 'Failed to get recent failed deliveries');
    return [];
  }
}

export async function cleanupOldDeliveries(daysOld: number = 7): Promise<number> {
  if (!pool) return 0;

  try {
    const result = await pool.query(
      `DELETE FROM webhook_deliveries WHERE created_at < NOW() - make_interval(days => $1)`,
      [daysOld]
    );
    return result.rowCount ?? 0;
  } catch (error) {
    dbLogger.error({ error }, 'Failed to cleanup old deliveries');
    return 0;
  }
}

// ============ Price Sample Functions ============

export async function insertPriceSample(poolId: string, tick: number): Promise<void> {
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO price_samples (pool_id, tick) VALUES ($1, $2)`,
      [poolId, tick]
    );
  } catch (error) {
    dbLogger.error({ error, poolId }, 'Failed to insert price sample');
  }
}

export async function getPriceSamples(poolId: string, hoursBack: number = 24): Promise<Array<{ tick: number; timestamp: number }>> {
  if (!pool) return [];

  try {
    const result = await pool.query(
      `SELECT tick, timestamp
       FROM price_samples
       WHERE pool_id = $1 AND timestamp > NOW() - make_interval(hours => $2)
       ORDER BY timestamp ASC`,
      [poolId, hoursBack]
    );
    return result.rows.map(row => ({
      tick: row.tick,
      timestamp: new Date(row.timestamp).getTime(),
    }));
  } catch (error) {
    dbLogger.error({ error, poolId }, 'Failed to get price samples');
    return [];
  }
}

export async function cleanupOldPriceSamples(hoursOld: number = 24): Promise<number> {
  if (!pool) return 0;

  try {
    const result = await pool.query(
      `DELETE FROM price_samples WHERE timestamp < NOW() - make_interval(hours => $1)`,
      [hoursOld]
    );
    return result.rowCount ?? 0;
  } catch (error) {
    dbLogger.error({ error }, 'Failed to cleanup old price samples');
    return 0;
  }
}

export async function getRecentPriceSamplesForAllPools(hoursBack: number = 24): Promise<Map<string, Array<{ tick: number; timestamp: number }>>> {
  if (!pool) return new Map();

  try {
    const result = await pool.query(
      `SELECT pool_id, tick, timestamp
       FROM price_samples
       WHERE timestamp > NOW() - make_interval(hours => $1)
       ORDER BY pool_id, timestamp ASC`,
      [hoursBack]
    );

    const map = new Map<string, Array<{ tick: number; timestamp: number }>>();
    for (const row of result.rows) {
      const poolId = row.pool_id;
      if (!map.has(poolId)) map.set(poolId, []);
      map.get(poolId)!.push({
        tick: row.tick,
        timestamp: new Date(row.timestamp).getTime(),
      });
    }
    return map;
  } catch (error) {
    dbLogger.error({ error }, 'Failed to get recent price samples for all pools');
    return new Map();
  }
}

// ============ Event Cache Functions ============

export async function insertEventCacheBatch(events: Array<{
  eventType: string;
  tokenId: string;
  blockNumber: bigint;
  logIndex: number;
  data?: Record<string, unknown>;
}>): Promise<void> {
  if (!pool || events.length === 0) return;

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const evt of events) {
        await client.query(
          `INSERT INTO event_cache (event_type, token_id, block_number, log_index, data)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (event_type, block_number, log_index) DO NOTHING`,
          [evt.eventType, evt.tokenId, Number(evt.blockNumber), evt.logIndex, evt.data ? JSON.stringify(evt.data) : null]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    dbLogger.error({ error, count: events.length }, 'Failed to insert event cache batch');
  }
}

export async function getLatestEventBlock(): Promise<bigint> {
  if (!pool) return 0n;

  try {
    const result = await pool.query(
      `SELECT MAX(block_number) as max_block FROM event_cache`
    );
    const maxBlock = result.rows[0]?.max_block;
    return maxBlock ? BigInt(maxBlock) : 0n;
  } catch (error) {
    dbLogger.error({ error }, 'Failed to get latest event block');
    return 0n;
  }
}

export async function getActiveRangeTokenIds(): Promise<Set<string>> {
  if (!pool) return new Set();

  try {
    // Get all tokens with RangeConfigured events minus those with RangeRemoved
    const result = await pool.query(
      `SELECT DISTINCT token_id FROM event_cache WHERE event_type = 'RangeConfigured'
       EXCEPT
       SELECT DISTINCT token_id FROM event_cache WHERE event_type = 'RangeRemoved'`
    );
    return new Set(result.rows.map(row => row.token_id));
  } catch (error) {
    dbLogger.error({ error }, 'Failed to get active range token IDs');
    return new Set();
  }
}

// ============ Token Price Functions (Phase 2 DB Caching) ============

export interface DbTokenPrice {
  address: string;
  chainId: number;
  symbol: string | null;
  decimals: number;
  priceUsd: number | null;
  derivedEth: number | null;
  source: string | null;
  updatedAt: Date;
}

/**
 * Get a token price from DB cache.
 */
export async function getTokenPriceFromDb(
  address: string,
  chainId: number = 8453
): Promise<DbTokenPrice | null> {
  if (!pool) return null;

  try {
    const result = await timedQuery(
      pool,
      `SELECT address, chain_id, symbol, decimals, price_usd, derived_eth, source, updated_at
       FROM token_prices
       WHERE LOWER(address) = LOWER($1) AND chain_id = $2
         AND updated_at > NOW() - INTERVAL '10 minutes'`,
      [address, chainId]
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      address: row.address,
      chainId: row.chain_id,
      symbol: row.symbol,
      decimals: row.decimals,
      priceUsd: row.price_usd ? parseFloat(row.price_usd) : null,
      derivedEth: row.derived_eth ? parseFloat(row.derived_eth) : null,
      source: row.source,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    dbLogger.error({ error, address }, 'Failed to get token price from DB');
    return null;
  }
}

/**
 * Batch get token prices from DB cache.
 */
export async function getBatchTokenPricesFromDb(
  addresses: string[],
  chainId: number = 8453
): Promise<Map<string, DbTokenPrice>> {
  const result = new Map<string, DbTokenPrice>();
  if (!pool || addresses.length === 0) return result;

  try {
    const lowerAddresses = addresses.map(a => a.toLowerCase());
    const queryResult = await timedQuery(
      pool,
      `SELECT address, chain_id, symbol, decimals, price_usd, derived_eth, source, updated_at
       FROM token_prices
       WHERE LOWER(address) = ANY($1) AND chain_id = $2
         AND updated_at > NOW() - INTERVAL '10 minutes'`,
      [lowerAddresses, chainId]
    );

    for (const row of queryResult.rows) {
      result.set(row.address.toLowerCase(), {
        address: row.address,
        chainId: row.chain_id,
        symbol: row.symbol,
        decimals: row.decimals,
        priceUsd: row.price_usd ? parseFloat(row.price_usd) : null,
        derivedEth: row.derived_eth ? parseFloat(row.derived_eth) : null,
        source: row.source,
        updatedAt: row.updated_at,
      });
    }
  } catch (error) {
    dbLogger.error({ error, count: addresses.length }, 'Failed to batch get token prices from DB');
  }

  return result;
}

/**
 * Upsert token prices to DB (used by sync job).
 */
export async function upsertTokenPrices(
  prices: Array<{
    address: string;
    chainId: number;
    symbol?: string;
    decimals?: number;
    priceUsd: number | null;
    derivedEth?: number | null;
    source: string;
  }>
): Promise<void> {
  if (!pool || prices.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const p of prices) {
      await client.query(
        `INSERT INTO token_prices (address, chain_id, symbol, decimals, price_usd, derived_eth, source, updated_at)
         VALUES (LOWER($1), $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (address, chain_id)
         DO UPDATE SET
           symbol = COALESCE($3, token_prices.symbol),
           decimals = COALESCE($4, token_prices.decimals),
           price_usd = $5,
           derived_eth = COALESCE($6, token_prices.derived_eth),
           source = $7,
           updated_at = NOW()`,
        [p.address, p.chainId, p.symbol || null, p.decimals || 18, p.priceUsd, p.derivedEth || null, p.source]
      );
    }

    await client.query('COMMIT');
    dbLogger.debug({ count: prices.length }, 'Upserted token prices');
  } catch (error) {
    await client.query('ROLLBACK');
    dbLogger.error({ error, count: prices.length }, 'Failed to upsert token prices');
  } finally {
    client.release();
  }
}

// Export pool for direct queries if needed
export { pool };
