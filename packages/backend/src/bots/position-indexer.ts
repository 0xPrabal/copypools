import { parseAbiItem } from 'viem';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as database from '../services/database.js';
import { publicClient } from '../services/blockchain.js';

const indexerLogger = logger.child({ module: 'position-indexer' });

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

// Process Transfer events and update position cache
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

    // Group events by address for batch updates
    const addressUpdates = new Map<string, { incoming: Set<string>; outgoing: Set<string> }>();

    for (const log of logs) {
      const from = (log.args.from as string).toLowerCase();
      const to = (log.args.to as string).toLowerCase();
      const tokenId = (log.args.tokenId as bigint).toString();

      // Skip zero address (minting)
      if (from !== '0x0000000000000000000000000000000000000000') {
        if (!addressUpdates.has(from)) {
          addressUpdates.set(from, { incoming: new Set(), outgoing: new Set() });
        }
        addressUpdates.get(from)!.outgoing.add(tokenId);
      }

      // Skip zero address (burning)
      if (to !== '0x0000000000000000000000000000000000000000') {
        if (!addressUpdates.has(to)) {
          addressUpdates.set(to, { incoming: new Set(), outgoing: new Set() });
        }
        addressUpdates.get(to)!.incoming.add(tokenId);
      }
    }

    // Update cache for each affected address
    for (const [address, updates] of addressUpdates) {
      // Get existing cache
      const existing = await database.getPositionCache(address, config.CHAIN_ID);
      let tokenIds = new Set<string>(existing?.tokenIds || []);

      // Add incoming tokens
      for (const tokenId of updates.incoming) {
        tokenIds.add(tokenId);
      }

      // Remove outgoing tokens
      for (const tokenId of updates.outgoing) {
        tokenIds.delete(tokenId);
      }

      // Save updated cache
      await database.savePositionCache(
        address,
        config.CHAIN_ID,
        toBlock.toString(),
        Array.from(tokenIds)
      );
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
