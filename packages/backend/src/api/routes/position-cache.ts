import { Router, Request, Response } from 'express';
import * as database from '../../services/database.js';
import { logger } from '../../utils/logger.js';
import {
  validateAddress,
  validateChainId,
  validateTokenIds,
  writeRateLimiter,
} from '../middleware/production.js';

const router = Router();
const routeLogger = logger.child({ route: 'position-cache' });

// Check if database is available (must be before parametric routes)
router.get('/status', async (_req: Request, res: Response) => {
  const available = database.isDatabaseAvailable();
  res.json({ available });
});

// Trigger on-demand indexing for a specific address
// This allows users to populate their position cache without waiting for the background indexer
router.post('/index/:address/:chainId', validateAddress, validateChainId, async (req: Request, res: Response) => {
  try {
    const { address, chainId } = req.params;
    const chainIdNum = parseInt(chainId, 10);

    if (!address || isNaN(chainIdNum)) {
      return res.status(400).json({ error: 'Invalid address or chainId' });
    }

    routeLogger.info({ address, chainId: chainIdNum }, 'Starting on-demand position indexing');

    // Import blockchain service dynamically to get position token IDs
    const { getPositionTokenIds } = await import('../../services/blockchain.js');

    // This will use Alchemy NFT API or scan recent blocks and save to cache
    // Pass chainId so it uses the correct position manager address and cache
    const tokenIds = await getPositionTokenIds(address, chainIdNum);

    // If we found tokens, save them to the database cache
    if (tokenIds.length > 0) {
      const { createPublicClient, http } = await import('viem');
      const { base, sepolia } = await import('viem/chains');
      const { config } = await import('../../config/index.js');

      // Select chain based on chainIdNum
      const chain = chainIdNum === 8453 ? base : chainIdNum === 11155111 ? sepolia : base;

      const client = createPublicClient({
        chain,
        transport: http(config.RPC_URL),
      });
      const currentBlock = await client.getBlockNumber();

      await database.savePositionCache(
        address,
        chainIdNum,
        currentBlock.toString(),
        tokenIds.map(id => id.toString())
      );
    }

    routeLogger.info({ address, chainId: chainIdNum, tokenCount: tokenIds.length }, 'On-demand indexing complete');

    res.json({
      success: true,
      address,
      chainId: chainIdNum,
      tokenIds: tokenIds.map(id => id.toString()),
      message: `Found ${tokenIds.length} position(s) and cached successfully`,
    });
  } catch (error) {
    routeLogger.error({ error, params: req.params }, 'Failed to index positions on-demand');
    res.status(500).json({ error: 'Failed to index positions' });
  }
});

// Get position cache for an address and chain
router.get('/:address/:chainId', validateAddress, validateChainId, async (req: Request, res: Response) => {
  try {
    const { address, chainId } = req.params;
    const chainIdNum = parseInt(chainId, 10);

    if (!address || isNaN(chainIdNum)) {
      return res.status(400).json({ error: 'Invalid address or chainId' });
    }

    const cache = await database.getPositionCache(address, chainIdNum);

    if (!cache) {
      return res.status(404).json({ error: 'No cache found', address, chainId: chainIdNum });
    }

    res.json({
      address: cache.address,
      chainId: cache.chainId,
      lastScannedBlock: cache.lastScannedBlock,
      tokenIds: cache.tokenIds,
      updatedAt: cache.updatedAt.toISOString(),
    });
  } catch (error) {
    routeLogger.error({ error, params: req.params }, 'Failed to get position cache');
    res.status(500).json({ error: 'Failed to fetch position cache' });
  }
});

// Save/update position cache
router.post('/', writeRateLimiter, validateAddress, validateChainId, validateTokenIds, async (req: Request, res: Response) => {
  try {
    const { address, chainId, lastScannedBlock, tokenIds } = req.body;

    if (!address || typeof chainId !== 'number' || !lastScannedBlock || !Array.isArray(tokenIds)) {
      return res.status(400).json({
        error: 'Invalid request body',
        required: { address: 'string', chainId: 'number', lastScannedBlock: 'string', tokenIds: 'string[]' },
      });
    }

    await database.savePositionCache(address, chainId, lastScannedBlock, tokenIds);

    routeLogger.info(
      { address, chainId, tokenCount: tokenIds.length, lastScannedBlock },
      'Position cache saved'
    );

    res.json({ success: true, message: 'Cache saved successfully' });
  } catch (error) {
    routeLogger.error({ error, body: req.body }, 'Failed to save position cache');
    res.status(500).json({ error: 'Failed to save position cache' });
  }
});

// Add tokens to existing cache (incremental update)
router.patch('/add-tokens', writeRateLimiter, validateAddress, validateChainId, validateTokenIds, async (req: Request, res: Response) => {
  try {
    const { address, chainId, newTokenIds, lastScannedBlock } = req.body;

    if (!address || typeof chainId !== 'number' || !lastScannedBlock || !Array.isArray(newTokenIds)) {
      return res.status(400).json({
        error: 'Invalid request body',
        required: { address: 'string', chainId: 'number', newTokenIds: 'string[]', lastScannedBlock: 'string' },
      });
    }

    await database.addTokensToCache(address, chainId, newTokenIds, lastScannedBlock);

    routeLogger.info(
      { address, chainId, newTokenCount: newTokenIds.length, lastScannedBlock },
      'Tokens added to cache'
    );

    res.json({ success: true, message: 'Tokens added successfully' });
  } catch (error) {
    routeLogger.error({ error, body: req.body }, 'Failed to add tokens to cache');
    res.status(500).json({ error: 'Failed to add tokens to cache' });
  }
});

// Remove tokens from cache (when transferred out)
router.patch('/remove-tokens', writeRateLimiter, validateAddress, validateChainId, validateTokenIds, async (req: Request, res: Response) => {
  try {
    const { address, chainId, tokenIdsToRemove } = req.body;

    if (!address || typeof chainId !== 'number' || !Array.isArray(tokenIdsToRemove)) {
      return res.status(400).json({
        error: 'Invalid request body',
        required: { address: 'string', chainId: 'number', tokenIdsToRemove: 'string[]' },
      });
    }

    await database.removeTokensFromCache(address, chainId, tokenIdsToRemove);

    routeLogger.info(
      { address, chainId, removedCount: tokenIdsToRemove.length },
      'Tokens removed from cache'
    );

    res.json({ success: true, message: 'Tokens removed successfully' });
  } catch (error) {
    routeLogger.error({ error, body: req.body }, 'Failed to remove tokens from cache');
    res.status(500).json({ error: 'Failed to remove tokens from cache' });
  }
});

export { router as positionCacheRouter };
