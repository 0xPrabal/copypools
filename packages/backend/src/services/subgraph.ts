import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as blockchain from './blockchain.js';

const subgraphLogger = logger.child({ module: 'subgraph' });

// Ponder schema name (must match ponder start --schema parameter)
// Default changed to 'ponder_base' to match the current Ponder deployment
const RAW_PONDER_SCHEMA = process.env.PONDER_SCHEMA || 'ponder_base';

// Sanitize schema name to prevent SQL injection - only allow alphanumeric and underscores
const PONDER_SCHEMA = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(RAW_PONDER_SCHEMA)
  ? RAW_PONDER_SCHEMA
  : 'ponder_base';

// PostgreSQL connection pool for Ponder database
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000, // 30 second query timeout
});

// Set search_path to ponder schema on each connection
// Schema name is sanitized above to prevent SQL injection
pool.on('connect', (client) => {
  client.query(`SET search_path TO "${PONDER_SCHEMA}", public`);
});

// Helper to convert snake_case to camelCase
function toCamelCase(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamelCase);
  if (typeof obj !== 'object') return obj;

  const newObj: any = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    newObj[camelKey] = toCamelCase(obj[key]);
  }
  return newObj;
}

// Query with retry logic
async function queryWithRetry<T>(sql: string, params: any[] = [], retries = 3): Promise<T[]> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const result = await pool.query(sql, params);
      return result.rows.map(toCamelCase);
    } catch (error) {
      lastError = error as Error;
      subgraphLogger.warn({ attempt: i + 1, error: lastError.message }, 'Database query failed, retrying...');

      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }
  }

  subgraphLogger.error({ error: lastError?.message }, 'All database retries failed');
  throw lastError;
}

// ============ Position Queries ============

export async function getPosition(tokenId: string) {
  const positions = await queryWithRetry<any>(
    `SELECT * FROM position WHERE id = $1 OR token_id = $1`,
    [tokenId]
  );

  if (positions.length === 0) {
    return { position: null };
  }

  const position = positions[0];

  // Fetch related configs from database
  const [compoundConfigs, exitConfigs, rangeConfigs] = await Promise.all([
    queryWithRetry<any>(`SELECT * FROM compound_config WHERE position_id = $1`, [tokenId]),
    queryWithRetry<any>(`SELECT * FROM exit_config WHERE position_id = $1`, [tokenId]),
    queryWithRetry<any>(`SELECT * FROM range_config WHERE position_id = $1`, [tokenId]),
  ]);

  position.compoundConfig = compoundConfigs[0] || null;
  position.exitConfig = exitConfigs[0] || null;
  position.rangeConfig = rangeConfigs[0] || null;

  // If no compound config in database, check on-chain
  if (!position.compoundConfig) {
    try {
      const onChainConfig = await blockchain.getCompoundConfig(BigInt(tokenId));
      if (onChainConfig.enabled) {
        position.compoundConfig = {
          enabled: onChainConfig.enabled,
          minCompoundInterval: onChainConfig.minCompoundInterval,
          minRewardAmount: onChainConfig.minRewardAmount.toString(),
        };
      }
    } catch (e) {
      // Position might not be registered
    }
  }

  // If no range config in database, check on-chain
  if (!position.rangeConfig) {
    try {
      const onChainRangeConfig = await blockchain.getRangeConfig(BigInt(tokenId));
      if (onChainRangeConfig?.enabled) {
        position.rangeConfig = {
          enabled: onChainRangeConfig.enabled,
          lowerDelta: onChainRangeConfig.lowerDelta,
          upperDelta: onChainRangeConfig.upperDelta,
          rebalanceThreshold: onChainRangeConfig.rebalanceThreshold,
        };
      }
    } catch (e) {
      // Position might not be registered
    }
  }

  return { position };
}

export async function getPositionsByOwner(owner: string, first = 100, skip = 0) {
  const positions = await queryWithRetry<any>(
    `SELECT * FROM position
     WHERE LOWER(owner) = LOWER($1)
     ORDER BY created_at_timestamp DESC
     LIMIT $2 OFFSET $3`,
    [owner, first, skip]
  );

  // Enrich with configs (from database and on-chain)
  const enrichedPositions = await Promise.all(
    positions.map(async (pos) => {
      const [compoundConfigs, exitConfigs, rangeConfigs] = await Promise.all([
        queryWithRetry<any>(`SELECT * FROM compound_config WHERE position_id = $1`, [pos.tokenId]),
        queryWithRetry<any>(`SELECT * FROM exit_config WHERE position_id = $1`, [pos.tokenId]),
        queryWithRetry<any>(`SELECT * FROM range_config WHERE position_id = $1`, [pos.tokenId]),
      ]);

      let compoundConfig = compoundConfigs[0] || null;
      let rangeConfig = rangeConfigs[0] || null;

      // If no compound config in database, check on-chain
      if (!compoundConfig) {
        try {
          const onChainConfig = await blockchain.getCompoundConfig(BigInt(pos.tokenId));
          if (onChainConfig.enabled) {
            compoundConfig = {
              enabled: onChainConfig.enabled,
              minCompoundInterval: onChainConfig.minCompoundInterval,
              minRewardAmount: onChainConfig.minRewardAmount.toString(),
            };
          }
        } catch (e) {
          // Position might not be registered
        }
      }

      // If no range config in database, check on-chain
      if (!rangeConfig) {
        try {
          const onChainRangeConfig = await blockchain.getRangeConfig(BigInt(pos.tokenId));
          if (onChainRangeConfig?.enabled) {
            rangeConfig = {
              enabled: onChainRangeConfig.enabled,
              lowerDelta: onChainRangeConfig.lowerDelta,
              upperDelta: onChainRangeConfig.upperDelta,
              rebalanceThreshold: onChainRangeConfig.rebalanceThreshold,
            };
          }
        } catch (e) {
          // Position might not be registered
        }
      }

      return {
        ...pos,
        compoundConfig,
        exitConfig: exitConfigs[0] || null,
        rangeConfig,
      };
    })
  );

  return { positions: { items: enrichedPositions } };
}

export async function getAllPositions(first = 100, skip = 0, activeOnly = false) {
  let sql = `SELECT * FROM position`;

  if (activeOnly) {
    sql += ` WHERE liquidity != '0' AND closed_at_timestamp IS NULL`;
  }

  sql += ` ORDER BY created_at_timestamp DESC LIMIT $1 OFFSET $2`;

  const positions = await queryWithRetry<any>(sql, [first, skip]);

  return { positions: { items: positions } };
}

/**
 * Get all positions with pool and token symbol data via JOINs
 * Used by top-positions to avoid empty symbol/fee fields
 */
export async function getAllPositionsWithPool(first = 100, skip = 0, activeOnly = false) {
  let sql = `
    SELECT
      p.*,
      pool.fee AS pool_fee,
      pool.tick AS pool_tick,
      pool.sqrt_price_x96 AS pool_sqrt_price_x96,
      t0.symbol AS token0_symbol,
      t0.decimals AS token0_decimals,
      t1.symbol AS token1_symbol,
      t1.decimals AS token1_decimals
    FROM position p
    LEFT JOIN pool ON p.pool_id = pool.id
    LEFT JOIN token t0 ON pool.token0_id = t0.id
    LEFT JOIN token t1 ON pool.token1_id = t1.id
  `;

  if (activeOnly) {
    sql += ` WHERE p.liquidity != '0' AND p.closed_at_timestamp IS NULL`;
  }

  sql += ` ORDER BY p.created_at_timestamp DESC LIMIT $1 OFFSET $2`;

  const positions = await queryWithRetry<any>(sql, [first, skip]);

  return { positions: { items: positions } };
}

/**
 * Update a position in the Ponder database with enriched on-chain data
 * Used to persist pool info for positions that had poolId: "unknown"
 */
export async function updatePositionFromChain(
  tokenId: string,
  poolId: string,
  tickLower: number,
  tickUpper: number,
  liquidity: string
): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE position
       SET pool_id = $2, tick_lower = $3, tick_upper = $4, liquidity = $5
       WHERE id = $1 OR token_id = $1`,
      [tokenId, poolId, tickLower, tickUpper, liquidity]
    );

    if (result.rowCount && result.rowCount > 0) {
      subgraphLogger.info({ tokenId, poolId }, 'Updated position with on-chain data');
      return true;
    }
    return false;
  } catch (error) {
    subgraphLogger.error({ error: (error as Error).message, tokenId }, 'Failed to update position');
    return false;
  }
}

/**
 * Batch update positions in the Ponder database with enriched on-chain data
 * More efficient than individual updates
 */
export async function batchUpdatePositionsFromChain(
  positions: Array<{
    tokenId: string;
    poolId: string;
    tickLower: number;
    tickUpper: number;
    liquidity: string;
  }>
): Promise<number> {
  if (positions.length === 0) return 0;

  let updatedCount = 0;

  // Use a transaction for batch updates
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const pos of positions) {
      const result = await client.query(
        `UPDATE position
         SET pool_id = $2, tick_lower = $3, tick_upper = $4, liquidity = $5
         WHERE (id = $1 OR token_id = $1) AND (pool_id = 'unknown' OR pool_id IS NULL)`,
        [pos.tokenId, pos.poolId, pos.tickLower, pos.tickUpper, pos.liquidity]
      );
      if (result.rowCount && result.rowCount > 0) {
        updatedCount++;
      }
    }

    await client.query('COMMIT');
    subgraphLogger.info({ count: updatedCount }, 'Batch updated positions with on-chain data');
  } catch (error) {
    await client.query('ROLLBACK');
    subgraphLogger.error({ error: (error as Error).message }, 'Failed to batch update positions');
  } finally {
    client.release();
  }

  return updatedCount;
}

// ============ Compound Queries ============

export async function getCompoundablePositions(minReward: string, limit = 100) {
  const configs = await queryWithRetry<any>(
    `SELECT cc.*, p.*
     FROM compound_config cc
     JOIN position p ON cc.position_id = p.token_id
     WHERE cc.enabled = true
     LIMIT $1`,
    [limit]
  );

  return { compoundConfigs: configs };
}

// ============ Exit Queries ============

export async function getExitablePositions(limit = 100) {
  const configs = await queryWithRetry<any>(
    `SELECT ec.*, p.*
     FROM exit_config ec
     JOIN position p ON ec.position_id = p.token_id
     WHERE ec.executed = false AND ec.exit_type > 0
     LIMIT $1`,
    [limit]
  );

  return { exitConfigs: configs };
}

// ============ Range Queries ============

export async function getRebalanceablePositions(limit = 100) {
  const configs = await queryWithRetry<any>(
    `SELECT
       rc.enabled,
       rc.lower_delta as "lowerDelta",
       rc.upper_delta as "upperDelta",
       rc.rebalance_threshold as "rebalanceThreshold",
       rc.min_rebalance_interval as "minRebalanceInterval",
       rc.last_rebalance_timestamp as "lastRebalanceTimestamp",
       rc.max_swap_slippage as "maxSwapSlippage",
       p.token_id as "tokenId",
       p.tick_lower as "tickLower",
       p.tick_upper as "tickUpper",
       p.pool_id as "poolId"
     FROM range_config rc
     JOIN position p ON rc.position_id = p.token_id
     WHERE rc.enabled = true
     LIMIT $1`,
    [limit]
  );

  // Transform to expected nested structure
  const rangeConfigs = configs.map((c: any) => ({
    enabled: c.enabled,
    lowerDelta: c.lowerDelta,
    upperDelta: c.upperDelta,
    rebalanceThreshold: c.rebalanceThreshold,
    minRebalanceInterval: c.minRebalanceInterval,
    lastRebalanceTimestamp: c.lastRebalanceTimestamp,
    maxSwapSlippage: c.maxSwapSlippage,
    position: {
      tokenId: c.tokenId,
      tickLower: c.tickLower,
      tickUpper: c.tickUpper,
      pool: {
        id: c.poolId,
        tick: 0, // Will be fetched on-chain if needed
      },
    },
  }));

  return { rangeConfigs };
}

// ============ Lending Queries ============

export async function getLiquidatableLoans(limit = 100) {
  const loans = await queryWithRetry<any>(
    `SELECT * FROM loan
     WHERE is_liquidatable = true AND liquidated = false
     ORDER BY health_factor ASC
     LIMIT $1`,
    [limit]
  );

  return { loans: { items: loans } };
}

// ============ Stats Queries ============

export async function getProtocolStats() {
  // Get counts from actual tables
  const [positionCount, compoundCount, rangeCount, exitCount, poolStats] = await Promise.all([
    queryWithRetry<any>(`SELECT COUNT(*) as count FROM position`),
    queryWithRetry<any>(`SELECT COUNT(*) as count FROM compound_config WHERE enabled = true`),
    queryWithRetry<any>(`SELECT COUNT(*) as count FROM range_config WHERE enabled = true`),
    queryWithRetry<any>(`SELECT COUNT(*) as count FROM exit_config WHERE executed = false AND exit_type > 0`),
    // Aggregate TVL, volume, fees from all pools
    queryWithRetry<any>(`
      SELECT
        COALESCE(SUM(CAST(total_value_locked_usd AS DECIMAL)), 0) as total_tvl,
        COALESCE(SUM(CAST(volume_usd AS DECIMAL)), 0) as total_volume,
        COALESCE(SUM(CAST(fees_usd AS DECIMAL)), 0) as total_fees
      FROM pool
    `),
  ]);

  const activePositions = await queryWithRetry<any>(
    `SELECT COUNT(*) as count FROM position WHERE liquidity != '0' AND closed_at_timestamp IS NULL`
  );

  // Extract pool stats
  const tvl = poolStats[0]?.totalTvl || poolStats[0]?.total_tvl || '0';
  const volume = poolStats[0]?.totalVolume || poolStats[0]?.total_volume || '0';
  const fees = poolStats[0]?.totalFees || poolStats[0]?.total_fees || '0';

  return {
    protocolStats: {
      id: '1',
      totalPositions: parseInt(positionCount[0]?.count || '0'),
      activePositions: parseInt(activePositions[0]?.count || '0'),
      totalCompoundConfigs: parseInt(compoundCount[0]?.count || '0'),
      totalRangeConfigs: parseInt(rangeCount[0]?.count || '0'),
      totalExitConfigs: parseInt(exitCount[0]?.count || '0'),
      totalVaults: 0,
      totalLoans: 0,
      activeLoans: 0,
      totalSupplied: tvl.toString(),
      totalBorrowed: '0',
      totalVolumeUSD: volume.toString(),
      totalFeesUSD: fees.toString(),
    },
  };
}

export async function getDailyStats(days = 30) {
  const stats = await queryWithRetry<any>(
    `SELECT * FROM daily_stats
     ORDER BY date DESC
     LIMIT $1`,
    [days]
  );

  return { dailyStatss: { items: stats } };
}

// ============ Pool Queries ============

export async function getPools(first = 100, skip = 0) {
  const pools = await queryWithRetry<any>(
    `SELECT * FROM pool
     ORDER BY total_value_locked_usd DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    [first, skip]
  );

  return { pools: { items: pools } };
}

export async function getPool(poolId: string) {
  const pools = await queryWithRetry<any>(
    `SELECT * FROM pool WHERE id = $1`,
    [poolId]
  );

  return { pool: pools[0] || null };
}

// ============ Token Queries ============

export async function getTokens(first = 100, skip = 0) {
  const tokens = await queryWithRetry<any>(
    `SELECT * FROM token
     ORDER BY total_value_locked_usd DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    [first, skip]
  );

  return { tokens: { items: tokens } };
}

// ============ Account Queries ============

export async function getAccount(address: string) {
  const accounts = await queryWithRetry<any>(
    `SELECT * FROM account WHERE LOWER(id) = LOWER($1)`,
    [address]
  );

  return { account: accounts[0] || null };
}

// ============ Bot State Persistence ============

// Create bot_state table if it doesn't exist (in public schema, not ponder schema)
export async function initBotStateTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.bot_state (
        bot_name VARCHAR(50) PRIMARY KEY,
        last_scanned_block BIGINT NOT NULL,
        known_positions TEXT[] NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    subgraphLogger.info('Bot state table initialized');
  } catch (error) {
    subgraphLogger.error({ error: (error as Error).message }, 'Failed to create bot_state table');
  }
}

// Save bot scan state to database
export async function saveBotState(
  botName: string,
  lastScannedBlock: bigint,
  knownPositions: Set<string>
): Promise<void> {
  try {
    const positionsArray = Array.from(knownPositions);
    await pool.query(`
      INSERT INTO public.bot_state (bot_name, last_scanned_block, known_positions, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (bot_name) DO UPDATE SET
        last_scanned_block = $2,
        known_positions = $3,
        updated_at = NOW()
    `, [botName, lastScannedBlock.toString(), positionsArray]);

    subgraphLogger.debug({ botName, lastScannedBlock: lastScannedBlock.toString(), positionCount: positionsArray.length }, 'Bot state saved');
  } catch (error) {
    subgraphLogger.error({ error: (error as Error).message }, 'Failed to save bot state');
  }
}

// Load bot scan state from database
export async function loadBotState(botName: string): Promise<{ lastScannedBlock: bigint; knownPositions: Set<string> } | null> {
  try {
    const result = await pool.query(`
      SELECT last_scanned_block, known_positions FROM public.bot_state WHERE bot_name = $1
    `, [botName]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      lastScannedBlock: BigInt(row.last_scanned_block),
      knownPositions: new Set(row.known_positions || []),
    };
  } catch (error) {
    subgraphLogger.warn({ error: (error as Error).message }, 'Failed to load bot state (table may not exist yet)');
    return null;
  }
}

// ============ Health Check ============

export async function checkPonderConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    subgraphLogger.error({ error: (error as Error).message }, 'Ponder database connection check failed');
    return false;
  }
}

// Graceful shutdown
export async function closeConnection() {
  await pool.end();
}
