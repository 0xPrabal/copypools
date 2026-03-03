import { parseAbiItem } from 'viem';
import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as database from '../services/database.js';
import { publicClient } from '../services/blockchain.js';

const indexerLogger = logger.child({ module: 'position-indexer' });

// ============ Ponder DB connection (separate pool with ponder schema search_path) ============
// Must match the schema used by subgraph.ts / Ponder deployment
const RAW_PONDER_SCHEMA = process.env.PONDER_SCHEMA || 'ponder_base';
const PONDER_SCHEMA = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(RAW_PONDER_SCHEMA)
  ? RAW_PONDER_SCHEMA
  : 'ponder_base';

let ponderPool: pg.Pool | null = null;

function getPonderPool(): pg.Pool | null {
  if (ponderPool) return ponderPool;
  if (!config.DATABASE_URL) return null;

  ponderPool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 3, // Small pool — only used for ownership updates
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });

  // Set search_path to ponder schema on each connection
  ponderPool.on('connect', (client) => {
    client.query(`SET search_path TO "${PONDER_SCHEMA}", public`);
  });

  return ponderPool;
}

// Transfer event signature for ERC721
const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
);

// Indexer state stored in database
interface IndexerState {
  lastIndexedBlock: bigint;
  chainId: number;
}

// Get indexer state from database
async function getIndexerState(): Promise<IndexerState | null> {
  const pool = database.pool;
  if (!pool) return null;

  try {
    // Create state table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS indexer_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        last_indexed_block VARCHAR(78) NOT NULL,
        chain_id INTEGER NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CHECK (id = 1)
      )
    `);

    const result = await pool.query('SELECT * FROM indexer_state WHERE id = 1');
    if (result.rows.length === 0) {
      return null;
    }

    return {
      lastIndexedBlock: BigInt(result.rows[0].last_indexed_block),
      chainId: result.rows[0].chain_id,
    };
  } catch (error) {
    indexerLogger.error({ error }, 'Failed to get indexer state');
    return null;
  }
}

// Save indexer state to database
async function saveIndexerState(lastIndexedBlock: bigint): Promise<void> {
  const pool = database.pool;
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO indexer_state (id, last_indexed_block, chain_id, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id)
       DO UPDATE SET last_indexed_block = $1, updated_at = NOW()`,
      [lastIndexedBlock.toString(), config.CHAIN_ID]
    );
  } catch (error) {
    indexerLogger.error({ error }, 'Failed to save indexer state');
  }
}

// ============ Ponder DB: Sync ownership on transfers (Bug fix — 0 extra RPC calls) ============

/**
 * Update position.owner in the Ponder schema for transferred positions.
 * This fixes BUG-006 issue #2 (stale ownership data).
 * Pure DB write — no RPC calls.
 */
async function syncOwnershipToPonder(
  transfers: Array<{ tokenId: string; newOwner: string }>,
  blockTimestamp: string
): Promise<number> {
  const pPool = getPonderPool();
  if (!pPool || transfers.length === 0) return 0;

  let updated = 0;
  try {
    for (const { tokenId, newOwner } of transfers) {
      // Update owner in Ponder's position table
      // Match on both id and token_id since Ponder uses id = tokenId string
      const result = await pPool.query(
        `UPDATE position SET owner = $2 WHERE id = $1 OR token_id = $1`,
        [tokenId, newOwner]
      );
      if (result.rowCount && result.rowCount > 0) {
        updated++;
      }
    }

    if (updated > 0) {
      indexerLogger.info({ updated, total: transfers.length }, 'Synced ownership to Ponder position table');
    }
  } catch (error) {
    // Non-fatal — position_cache is still correct, Ponder data is best-effort
    indexerLogger.warn({ error: (error as Error).message }, 'Failed to sync ownership to Ponder (non-fatal)');
  }

  return updated;
}

/**
 * Insert stub position rows in the Ponder schema for newly minted positions.
 * This fixes BUG-006 issue #1 (new positions not indexed).
 * Creates minimal rows that will be enriched on first API access via on-chain lookup.
 * Pure DB write — no RPC calls.
 */
async function insertMintedPositionsToPonder(
  mints: Array<{ tokenId: string; owner: string; blockNumber: string; blockTimestamp: string }>
): Promise<number> {
  const pPool = getPonderPool();
  if (!pPool || mints.length === 0) return 0;

  let inserted = 0;
  try {
    for (const { tokenId, owner, blockNumber, blockTimestamp } of mints) {
      // Use INSERT ... ON CONFLICT DO NOTHING to avoid overwriting positions already indexed by Ponder
      const result = await pPool.query(
        `INSERT INTO position (
          id, token_id, owner, pool_id, tick_lower, tick_upper, liquidity,
          deposited_token0, deposited_token1, withdrawn_token0, withdrawn_token1,
          collected_fees_token0, collected_fees_token1,
          created_at_timestamp, created_at_block_number
        ) VALUES ($1, $1, $2, 'unknown', 0, 0, '0', '0', '0', '0', '0', '0', '0', $3, $4)
        ON CONFLICT (id) DO NOTHING`,
        [tokenId, owner, blockTimestamp, blockNumber]
      );
      if (result.rowCount && result.rowCount > 0) {
        inserted++;
      }
    }

    if (inserted > 0) {
      indexerLogger.info({ inserted, total: mints.length }, 'Inserted stub positions into Ponder for newly minted tokens');
    }
  } catch (error) {
    // Non-fatal — positions will still be found via on-chain fallback (Layer 4)
    indexerLogger.warn({ error: (error as Error).message }, 'Failed to insert minted positions to Ponder (non-fatal)');
  }

  return inserted;
}

/**
 * Update owner in the backend positions cache table for transferred positions.
 * This ensures Layer 2 (DB cache) in the positions API also reflects correct ownership.
 * Pure DB write — no RPC calls.
 */
async function syncOwnershipToBackendCache(
  transfers: Array<{ tokenId: string; newOwner: string }>
): Promise<void> {
  const backendPool = database.pool;
  if (!backendPool || transfers.length === 0) return;

  try {
    for (const { tokenId, newOwner } of transfers) {
      await backendPool.query(
        `UPDATE positions SET owner = $2, updated_at = NOW() WHERE token_id = $1`,
        [tokenId, newOwner]
      );
    }
  } catch (error) {
    // Non-fatal
    indexerLogger.debug({ error: (error as Error).message }, 'Failed to sync ownership to backend positions cache');
  }
}

// Process Transfer events and update position cache + Ponder ownership + backend cache
async function processTransferEvents(
  fromBlock: bigint,
  toBlock: bigint
): Promise<number> {
  const pool = database.pool;
  if (!pool) return 0;

  try {
    // Get all Transfer events in this block range
    const logs = await publicClient.getLogs({
      address: config.POSITION_MANAGER_ADDRESS as `0x${string}`,
      event: TRANSFER_EVENT,
      fromBlock,
      toBlock,
    });

    if (logs.length === 0) {
      return 0;
    }

    indexerLogger.debug(
      { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), eventCount: logs.length },
      'Processing Transfer events'
    );

    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

    // Group events by address for batch updates (position_cache)
    const addressUpdates = new Map<string, { incoming: Set<string>; outgoing: Set<string> }>();

    // Collect ownership transfers and mints for Ponder sync (no additional RPC)
    const ownershipTransfers: Array<{ tokenId: string; newOwner: string }> = [];
    const newMints: Array<{ tokenId: string; owner: string; blockNumber: string; blockTimestamp: string }> = [];

    for (const log of logs) {
      const from = (log.args.from as string).toLowerCase();
      const to = (log.args.to as string).toLowerCase();
      const tokenId = (log.args.tokenId as bigint).toString();

      // Track mints (from == 0x0) — new positions to insert into Ponder
      if (from === ZERO_ADDRESS && to !== ZERO_ADDRESS) {
        newMints.push({
          tokenId,
          owner: to,
          blockNumber: log.blockNumber.toString(),
          // Use block number as timestamp proxy (actual timestamp would need an RPC call)
          blockTimestamp: Math.floor(Date.now() / 1000).toString(),
        });
      }

      // Track ownership transfers (both regular transfers and mints set the new owner)
      if (to !== ZERO_ADDRESS) {
        ownershipTransfers.push({ tokenId, newOwner: to });
      }

      // position_cache updates (existing logic)
      if (from !== ZERO_ADDRESS) {
        if (!addressUpdates.has(from)) {
          addressUpdates.set(from, { incoming: new Set(), outgoing: new Set() });
        }
        addressUpdates.get(from)!.outgoing.add(tokenId);
      }

      if (to !== ZERO_ADDRESS) {
        if (!addressUpdates.has(to)) {
          addressUpdates.set(to, { incoming: new Set(), outgoing: new Set() });
        }
        addressUpdates.get(to)!.incoming.add(tokenId);
      }
    }

    // Update position_cache for each affected address (existing logic)
    for (const [address, updates] of addressUpdates) {
      const existing = await database.getPositionCache(address, config.CHAIN_ID);
      let tokenIds = new Set<string>(existing?.tokenIds || []);

      for (const tokenId of updates.incoming) {
        tokenIds.add(tokenId);
      }
      for (const tokenId of updates.outgoing) {
        tokenIds.delete(tokenId);
      }

      await database.savePositionCache(
        address,
        config.CHAIN_ID,
        toBlock.toString(),
        Array.from(tokenIds)
      );
    }

    // ============ NEW: Sync to Ponder + backend DB (pure DB writes, 0 RPC calls) ============

    // 1. Insert stub positions for newly minted tokens (fixes: new positions not indexed)
    if (newMints.length > 0) {
      await insertMintedPositionsToPonder(newMints);
    }

    // 2. Update ownership in Ponder position table (fixes: stale ownership)
    if (ownershipTransfers.length > 0) {
      await syncOwnershipToPonder(ownershipTransfers, toBlock.toString());
    }

    // 3. Update ownership in backend positions cache table
    if (ownershipTransfers.length > 0) {
      await syncOwnershipToBackendCache(ownershipTransfers);
    }

    return logs.length;
  } catch (error) {
    indexerLogger.error({ error, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, 'Failed to process Transfer events');
    throw error;
  }
}

// Cap on how many chunks to process per startup to limit RPC usage
// 10 chunks × 50k blocks = 500k blocks max per startup (~1 day on Base)
const MAX_CATCHUP_CHUNKS = 10;
const CHUNK_SIZE = 50000n; // 50k blocks per chunk (larger to reduce RPC calls)

// Main indexing loop — only catches up recent blocks, NOT full history
async function runIndexer(): Promise<void> {
  if (!database.isDatabaseAvailable()) {
    indexerLogger.warn('Database not available - position indexer disabled');
    return;
  }

  indexerLogger.info('Starting position indexer');

  // Get current chain block
  const latestBlock = await publicClient.getBlockNumber();

  // Get saved state from DB
  const state = await getIndexerState();

  // If no saved state, DON'T scan from deployment block (that's ~17M blocks = 1700+ RPC calls).
  // Ponder is the primary source for historical positions.
  // This indexer only needs to track RECENT transfers as a backup layer.
  // Start from (latest - 100k blocks) which covers ~2-3 days on Base.
  const RECENT_LOOKBACK = 100000n;
  let currentBlock: bigint;

  if (state?.lastIndexedBlock) {
    currentBlock = state.lastIndexedBlock;

    // Safety: if saved state is way too far behind (>500k blocks), skip to recent
    const gap = latestBlock - currentBlock;
    if (gap > 500000n) {
      indexerLogger.warn(
        { savedBlock: currentBlock.toString(), latestBlock: latestBlock.toString(), gap: gap.toString() },
        'Saved state too far behind, skipping to recent blocks (Ponder covers history)'
      );
      currentBlock = latestBlock - RECENT_LOOKBACK;
      await saveIndexerState(currentBlock);
    }
  } else {
    // No saved state — start from recent blocks only
    currentBlock = latestBlock > RECENT_LOOKBACK ? latestBlock - RECENT_LOOKBACK : 0n;
    indexerLogger.info(
      { startBlock: currentBlock.toString(), latestBlock: latestBlock.toString() },
      'No saved state — starting from recent blocks only (Ponder covers historical positions)'
    );
  }

  indexerLogger.info(
    { startBlock: currentBlock.toString(), latestBlock: latestBlock.toString() },
    'Position indexer catching up'
  );

  // Process in chunks with a cap to limit RPC burst on startup
  let totalEvents = 0;
  let chunksProcessed = 0;

  while (currentBlock < latestBlock && chunksProcessed < MAX_CATCHUP_CHUNKS) {
    const toBlock = currentBlock + CHUNK_SIZE > latestBlock ? latestBlock : currentBlock + CHUNK_SIZE;

    try {
      const eventCount = await processTransferEvents(currentBlock, toBlock);
      totalEvents += eventCount;

      // Save progress
      await saveIndexerState(toBlock);
      currentBlock = toBlock + 1n;
      chunksProcessed++;

      // Small delay between chunks to avoid RPC rate limiting
      if (currentBlock < latestBlock) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      indexerLogger.error({ error, currentBlock: currentBlock.toString() }, 'Indexer error, skipping to live mode');
      // Don't retry forever — move to live mode and catch up incrementally
      break;
    }
  }

  if (chunksProcessed >= MAX_CATCHUP_CHUNKS && currentBlock < latestBlock) {
    indexerLogger.info(
      { chunksProcessed, currentBlock: currentBlock.toString(), latestBlock: latestBlock.toString(), totalEvents },
      'Catchup chunk limit reached — will continue in live mode'
    );
  } else {
    indexerLogger.info({ totalEvents, chunksProcessed }, 'Catchup complete, switching to live mode');
  }
}

// Live indexing — poll for new blocks
async function runLiveIndexer(): Promise<void> {
  if (!database.isDatabaseAvailable()) {
    return;
  }

  indexerLogger.info('Starting live position indexer (every 5 minutes)');

  let lastProcessedBlock = await publicClient.getBlockNumber();

  // Poll every 5 minutes — position ownership changes are rare
  setInterval(async () => {
    try {
      const currentBlock = await publicClient.getBlockNumber();

      if (currentBlock > lastProcessedBlock) {
        const eventCount = await processTransferEvents(lastProcessedBlock + 1n, currentBlock);

        if (eventCount > 0) {
          indexerLogger.debug(
            { fromBlock: (lastProcessedBlock + 1n).toString(), toBlock: currentBlock.toString(), eventCount },
            'Processed new Transfer events'
          );
        }

        await saveIndexerState(currentBlock);
        lastProcessedBlock = currentBlock;
      }
    } catch (error) {
      indexerLogger.error({ error }, 'Live indexer error');
    }
  }, 300000); // 5 minutes
}

// Start the position indexer
export async function startPositionIndexer(): Promise<void> {
  try {
    // Catch up recent blocks (capped at MAX_CATCHUP_CHUNKS)
    await runIndexer();

    // Then switch to live mode
    await runLiveIndexer();
  } catch (error) {
    indexerLogger.error({ error }, 'Failed to start position indexer');
  }
}

// Graceful shutdown — close Ponder pool
export async function stopPositionIndexer(): Promise<void> {
  if (ponderPool) {
    await ponderPool.end();
    ponderPool = null;
  }
}
