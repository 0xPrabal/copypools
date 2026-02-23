/**
 * Price API endpoints
 * Provides token price information in USD via CoinGecko, DeFiLlama, Binance
 */

import { Router, Request, Response } from 'express';
import {
  getTokenPriceUSD,
  getBatchPrices,
  USDC_ADDRESSES,
  TOKEN_INFO,
} from '../../services/price.js';
import { logger } from '../../utils/logger.js';

const router = Router();
const priceLogger = logger.child({ route: 'prices' });

// Default chain ID
const DEFAULT_CHAIN_ID = 8453; // Base Mainnet

/**
 * Get single token price
 * GET /api/prices/:tokenAddress
 * Query params: chainId (optional, defaults to 8453)
 */
router.get('/:tokenAddress', async (req: Request, res: Response) => {
  try {
    const { tokenAddress } = req.params;
    const chainId = parseInt(req.query.chainId as string) || DEFAULT_CHAIN_ID;

    // Validate address format
    if (!tokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      res.status(400).json({
        error: 'Invalid token address format',
        expected: '0x followed by 40 hex characters',
      });
      return;
    }

    const price = await getTokenPriceUSD(tokenAddress, chainId);

    res.json(price);
  } catch (error) {
    priceLogger.error({ error, token: req.params.tokenAddress }, 'Failed to get token price');
    res.status(500).json({ error: 'Failed to fetch price' });
  }
});

/**
 * Get multiple token prices in batch
 * GET /api/prices
 * Query params:
 *   - tokens: comma-separated token addresses (required)
 *   - chainId: chain ID (optional, defaults to 8453)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const tokensParam = req.query.tokens as string;
    const chainId = parseInt(req.query.chainId as string) || DEFAULT_CHAIN_ID;

    if (!tokensParam) {
      res.status(400).json({
        error: 'Missing required query parameter: tokens',
        example: '/api/prices?tokens=0x123...,0x456...&chainId=8453',
      });
      return;
    }

    const tokenAddresses = tokensParam.split(',').map(t => t.trim()).filter(Boolean);

    // Validate addresses
    const invalidAddresses = tokenAddresses.filter(addr => !/^0x[a-fA-F0-9]{40}$/.test(addr));
    if (invalidAddresses.length > 0) {
      res.status(400).json({
        error: 'Invalid token address format',
        invalidAddresses,
      });
      return;
    }

    // Limit batch size
    if (tokenAddresses.length > 50) {
      res.status(400).json({
        error: 'Too many tokens requested',
        limit: 50,
        requested: tokenAddresses.length,
      });
      return;
    }

    const pricesMap = await getBatchPrices(tokenAddresses, chainId);

    // Convert Map to array
    const prices = Array.from(pricesMap.values());

    // Check if all prices are cached
    const allCached = prices.every(p => p.cached);

    res.json({
      chainId,
      count: prices.length,
      allCached,
      prices,
    });
  } catch (error) {
    priceLogger.error({ error }, 'Failed to get batch prices');
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

/**
 * Get known stablecoin addresses
 * GET /api/prices/stablecoins
 * Query params: chainId (optional, defaults to 8453)
 */
router.get('/info/stablecoins', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.query.chainId as string) || DEFAULT_CHAIN_ID;

    // Known stablecoins per chain
    const stablecoins: Record<number, string[]> = {
      8453: [
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
        '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // USDT
        '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
        '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
      ],
    };

    res.json({
      chainId,
      stablecoins: stablecoins[chainId] || [],
      usdcAddress: USDC_ADDRESSES[chainId] || null,
    });
  } catch (error) {
    priceLogger.error({ error }, 'Failed to get stablecoin info');
    res.status(500).json({ error: 'Failed to get stablecoin info' });
  }
});

/**
 * Get supported tokens with metadata
 * GET /api/prices/info/tokens
 * Query params: chainId (optional, defaults to 8453)
 */
router.get('/info/tokens', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.query.chainId as string) || DEFAULT_CHAIN_ID;

    const chainTokens = TOKEN_INFO[chainId] || TOKEN_INFO[DEFAULT_CHAIN_ID];

    // Convert to array format
    const tokens = Object.entries(chainTokens).map(([address, info]) => ({
      address,
      ...info,
    }));

    res.json({
      chainId,
      count: tokens.length,
      tokens,
    });
  } catch (error) {
    priceLogger.error({ error }, 'Failed to get token info');
    res.status(500).json({ error: 'Failed to get token info' });
  }
});

/**
 * Get supported chains
 * GET /api/prices/info/chains
 */
router.get('/info/chains', async (_req: Request, res: Response) => {
  try {
    res.json({
      chains: [
        {
          chainId: 8453,
          name: 'Base Mainnet',
          usdcAddress: USDC_ADDRESSES[8453],
          tokenCount: Object.keys(TOKEN_INFO[8453] || {}).length,
        },
      ],
    });
  } catch (error) {
    priceLogger.error({ error }, 'Failed to get chain info');
    res.status(500).json({ error: 'Failed to get chain info' });
  }
});

export { router as pricesRouter };
