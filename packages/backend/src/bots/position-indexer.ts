import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as database from '../services/database.js';

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

// Create public client for reading blockchain
const publicClient = createPublicClient({
  chain: base,
  transport: http(config.RPC_URL),
});

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

// Main indexing loop
async function runIndexer(): Promise<void> {
  if (!database.isDatabaseAvailable()) {
    indexerLogger.warn('Database not available - position indexer disabled');
    return;
  }

  indexerLogger.info('Starting position indexer');

  // Get current chain block
  const latestBlock = await publicClient.getBlockNumber();

  // Get start block from state or use ~3 days back
  // Base produces ~2 blocks/second, so 3 days ≈ 518,400 blocks
  // Ensure we don't go below block 0 (for test environments or low block numbers)
  const threeDaysAgo = latestBlock > 520000n ? latestBlock - 520000n : 0n;
  let state = await getIndexerState();
  let currentBlock = state?.lastIndexedBlock || threeDaysAgo;

  indexerLogger.info(
    { startBlock: currentBlock.toString(), latestBlock: latestBlock.toString() },
    'Position indexer starting from block'
  );

  // Process in chunks
  const chunkSize = 10000n;
  let totalEvents = 0;

  while (currentBlock < latestBlock) {
    const toBlock = currentBlock + chunkSize > latestBlock ? latestBlock : currentBlock + chunkSize;

    try {
      const eventCount = await processTransferEvents(currentBlock, toBlock);
      totalEvents += eventCount;

      // Save progress
      await saveIndexerState(toBlock);
      currentBlock = toBlock + 1n;

      // Log progress every 100k blocks
      if ((toBlock - (state?.lastIndexedBlock || 0n)) % 100000n < chunkSize) {
        indexerLogger.info(
          { currentBlock: toBlock.toString(), latestBlock: latestBlock.toString(), totalEvents },
          'Indexer progress'
        );
      }
    } catch (error) {
      indexerLogger.error({ error, currentBlock: currentBlock.toString() }, 'Indexer error, retrying in 10s');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  indexerLogger.info({ totalEvents }, 'Initial indexing complete, switching to live mode');
}

// Live indexing - subscribe to new blocks
async function runLiveIndexer(): Promise<void> {
  if (!database.isDatabaseAvailable()) {
    return;
  }

  indexerLogger.info('Starting live position indexer');

  let lastProcessedBlock = await publicClient.getBlockNumber();

  // Poll for new blocks every 20 seconds
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
  }, 20000); // 20 seconds
}

// Start the position indexer
export async function startPositionIndexer(): Promise<void> {
  try {
    // First, catch up with historical events
    await runIndexer();

    // Then switch to live mode
    await runLiveIndexer();
  } catch (error) {
    indexerLogger.error({ error }, 'Failed to start position indexer');
  }
}
