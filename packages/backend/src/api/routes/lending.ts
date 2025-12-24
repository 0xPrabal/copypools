import { Router, Request, Response } from 'express';
import * as subgraph from '../../services/subgraph.js';
import * as blockchain from '../../services/blockchain.js';
import { logger } from '../../utils/logger.js';

const router = Router();
const routeLogger = logger.child({ route: 'lending' });

// Get loan info for a position
router.get('/loan/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await subgraph.getPosition(tokenId);
    const position = (result as any).position;

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    if (!position.loan) {
      return res.json({ tokenId, hasLoan: false });
    }

    // Get on-chain data with fallbacks
    let healthFactor = '0';
    let isLiquidatable = false;

    try {
      healthFactor = (await blockchain.getHealthFactor(BigInt(tokenId))).toString();
    } catch (e) {
      routeLogger.debug({ tokenId }, 'Could not fetch health factor on-chain');
    }

    try {
      isLiquidatable = await blockchain.checkLiquidatable(BigInt(tokenId));
    } catch (e) {
      routeLogger.debug({ tokenId }, 'Could not check liquidatable on-chain');
    }

    res.json({
      tokenId,
      hasLoan: true,
      loan: position.loan,
      healthFactor,
      isLiquidatable,
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get loan info');
    res.status(500).json({ error: 'Failed to fetch loan info' });
  }
});

// Get liquidatable loans
router.get('/liquidatable', async (req: Request, res: Response) => {
  try {
    const { limit = '100' } = req.query;
    const result = await subgraph.getLiquidatableLoans(parseInt(limit as string));
    res.json((result as any).loans || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get liquidatable loans');
    res.status(500).json({ error: 'Failed to fetch liquidatable loans' });
  }
});

// Get user loans
router.get('/user/:address/loans', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    // Query user loans from subgraph
    res.json([]);
  } catch (error) {
    routeLogger.error({ error, address: req.params.address }, 'Failed to get user loans');
    res.status(500).json({ error: 'Failed to fetch user loans' });
  }
});

// Get user supplies
router.get('/user/:address/supplies', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    // Query user supplies from subgraph
    res.json([]);
  } catch (error) {
    routeLogger.error({ error, address: req.params.address }, 'Failed to get user supplies');
    res.status(500).json({ error: 'Failed to fetch user supplies' });
  }
});

// Get vault info
router.get('/vault/:vaultAddress', async (req: Request, res: Response) => {
  try {
    const { vaultAddress } = req.params;
    // Query vault info from subgraph
    res.json({
      address: vaultAddress,
      totalSupplied: '0',
      totalBorrowed: '0',
      utilization: 0,
      supplyRate: 0,
      borrowRate: 0,
    });
  } catch (error) {
    routeLogger.error({ error, vaultAddress: req.params.vaultAddress }, 'Failed to get vault info');
    res.status(500).json({ error: 'Failed to fetch vault info' });
  }
});

// Calculate max borrow for a position
router.get('/max-borrow/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const { currency } = req.query;

    // This would query the vault contract
    res.json({
      tokenId,
      currency,
      maxBorrow: '0',
      collateralValue: '0',
      collateralFactor: 7500,
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to calculate max borrow');
    res.status(500).json({ error: 'Failed to calculate max borrow' });
  }
});

// Get lending stats
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // Get protocol stats from subgraph
    const protocolResult = await subgraph.getProtocolStats();
    const protocolStats = (protocolResult as any)?.protocolStats;

    const stats = {
      totalValueLocked: protocolStats?.totalSupplied || '0',
      totalBorrowed: protocolStats?.totalBorrowed || '0',
      totalLoans: protocolStats?.totalLoans || 0,
      activeLoans: protocolStats?.activeLoans || 0,
      totalLiquidations: 0, // Would need to track this separately
      avgHealthFactor: 0, // Would need to calculate from active loans
      // Include position data for context
      totalPositions: protocolStats?.totalPositions || 0,
      activePositions: protocolStats?.activePositions || 0,
    };
    res.json(stats);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get lending stats');
    res.status(500).json({ error: 'Failed to fetch lending stats' });
  }
});

export { router as lendingRouter };
