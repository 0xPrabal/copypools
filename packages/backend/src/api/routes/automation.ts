import { Router, Request, Response } from 'express';
import * as subgraph from '../../services/subgraph.js';
import * as blockchain from '../../services/blockchain.js';
import { walletClient } from '../../services/blockchain.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { getKnownPositions, getLastScannedBlock, getRecentErrors, getPositionStatus } from '../../bots/auto-range-bot.js';

const router = Router();
const routeLogger = logger.child({ route: 'automation' });

// ========== Auto-Compound Endpoints ==========

// Get compound config for a position
router.get('/compound/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await subgraph.getPosition(tokenId);
    const position = (result as any).position;

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Get pending fees with fallback
    let pendingFees = { amount0: 0n, amount1: 0n };
    let profitable = false;
    let reward = 0n;

    try {
      pendingFees = await blockchain.getPendingFees(BigInt(tokenId));
    } catch (e) {
      routeLogger.debug({ tokenId, error: e }, 'Could not fetch pending fees on-chain');
    }

    try {
      const profitCheck = await blockchain.checkCompoundProfitable(BigInt(tokenId));
      profitable = profitCheck.profitable;
      reward = profitCheck.reward;
    } catch (e) {
      routeLogger.debug({ tokenId, error: e }, 'Could not check compound profitability on-chain');
    }

    if (res.headersSent) return;
    res.json({
      tokenId,
      config: position.compoundConfig || null,
      pendingFees: {
        amount0: pendingFees.amount0.toString(),
        amount1: pendingFees.amount1.toString(),
      },
      profitable,
      estimatedReward: reward.toString(),
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get compound config');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch compound config' });
  }
});

// Get all compoundable positions
router.get('/compound', async (req: Request, res: Response) => {
  try {
    const { limit = '100' } = req.query;
    const result = await subgraph.getCompoundablePositions('0', parseInt(limit as string));
    if (res.headersSent) return;
    res.json((result as any).compoundConfigs || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get compoundable positions');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch compoundable positions' });
  }
});

// ========== Auto-Exit Endpoints ==========

// Get exit config for a position
router.get('/exit/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await subgraph.getPosition(tokenId);
    const position = (result as any).position;

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Check exit condition
    let shouldExit = false;
    let exitType = 0;
    let currentPrice = '0';

    try {
      const exitCheck = await blockchain.checkExit(BigInt(tokenId));
      shouldExit = exitCheck.shouldExit;
      exitType = exitCheck.exitType;
    } catch (e) {
      routeLogger.debug({ tokenId, error: e }, 'Could not check exit condition on-chain');
    }

    // Get current price from pool if available, otherwise fetch on-chain
    if (position.pool?.sqrtPriceX96) {
      currentPrice = position.pool.sqrtPriceX96;
    } else {
      try {
        const positionInfo = await blockchain.getPositionInfo(BigInt(tokenId));
        if (positionInfo?.poolKey) {
          const slot0 = await blockchain.getPoolSlot0(positionInfo.poolKey);
          currentPrice = slot0.sqrtPriceX96.toString();
        }
      } catch (e) {
        routeLogger.debug({ tokenId }, 'Could not fetch price on-chain');
      }
    }

    if (res.headersSent) return;
    res.json({
      tokenId,
      config: position.exitConfig || null,
      currentPrice,
      shouldExit,
      exitType,
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get exit config');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch exit config' });
  }
});

// Get all exitable positions
router.get('/exit', async (req: Request, res: Response) => {
  try {
    const { limit = '100' } = req.query;
    const result = await subgraph.getExitablePositions(parseInt(limit as string));
    if (res.headersSent) return;
    res.json((result as any).exitConfigs || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get exitable positions');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch exitable positions' });
  }
});

// ========== Auto-Range Endpoints ==========

// Get range config for a position
router.get('/range/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const result = await subgraph.getPosition(tokenId);
    const position = (result as any).position;

    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // Check rebalance condition
    let needsRebalance = false;
    let reason = 0;
    let currentTick = 0;

    try {
      const rebalanceCheck = await blockchain.checkRebalance(BigInt(tokenId));
      needsRebalance = rebalanceCheck.needsRebalance;
      reason = rebalanceCheck.reason;
    } catch (e) {
      routeLogger.debug({ tokenId, error: e }, 'Could not check rebalance condition on-chain');
    }

    // Get current tick from pool if available, otherwise fetch on-chain
    if (position.pool?.tick !== undefined) {
      currentTick = position.pool.tick;
    } else {
      try {
        const positionInfo = await blockchain.getPositionInfo(BigInt(tokenId));
        if (positionInfo?.poolKey) {
          const slot0 = await blockchain.getPoolSlot0(positionInfo.poolKey);
          currentTick = slot0.tick;
        }
      } catch (e) {
        routeLogger.debug({ tokenId }, 'Could not fetch current tick on-chain');
      }
    }

    const tickLower = position.tickLower || 0;
    const tickUpper = position.tickUpper || 0;
    const inRange = currentTick >= tickLower && currentTick < tickUpper;

    if (res.headersSent) return;
    res.json({
      tokenId,
      config: position.rangeConfig || null,
      currentTick,
      tickLower,
      tickUpper,
      needsRebalance,
      reason,
      inRange,
    });
  } catch (error) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to get range config');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch range config' });
  }
});

// Get all rebalanceable positions
router.get('/range', async (req: Request, res: Response) => {
  try {
    const { limit = '100' } = req.query;
    const result = await subgraph.getRebalanceablePositions(parseInt(limit as string));
    if (res.headersSent) return;
    res.json((result as any).rangeConfigs || []);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get rebalanceable positions');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch rebalanceable positions' });
  }
});

// ========== Batch Status Endpoint ==========

// Get automation status for multiple positions
router.post('/batch-status', async (req: Request, res: Response) => {
  try {
    const { tokenIds } = req.body;

    if (!Array.isArray(tokenIds)) {
      return res.status(400).json({ error: 'tokenIds must be an array' });
    }

    const statuses = await Promise.all(
      tokenIds.map(async (tokenId: string) => {
        try {
          const [compoundCheck, exitCheck, rebalanceCheck] = await Promise.all([
            blockchain.checkCompoundProfitable(BigInt(tokenId)).catch(() => ({ profitable: false, reward: 0n })),
            blockchain.checkExit(BigInt(tokenId)).catch(() => ({ shouldExit: false, exitType: 0 })),
            blockchain.checkRebalance(BigInt(tokenId)).catch(() => ({ needsRebalance: false, reason: 0 })),
          ]);

          return {
            tokenId,
            compound: compoundCheck,
            exit: exitCheck,
            rebalance: rebalanceCheck,
          };
        } catch {
          return { tokenId, error: true };
        }
      })
    );

    if (res.headersSent) return;
    res.json(statuses);
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get batch status');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch batch status' });
  }
});

// ========== Bot Status Endpoint ==========

// Get bot and wallet status (for debugging)
router.get('/status', async (req: Request, res: Response) => {
  try {
    const walletConfigured = walletClient !== null;
    let walletAddress: string | null = null;
    let walletBalance: string | null = null;

    if (walletConfigured && walletClient?.account?.address) {
      walletAddress = walletClient.account.address;
      try {
        // Get wallet balance
        const balance = await blockchain.publicClient.getBalance({
          address: walletAddress as `0x${string}`,
        });
        walletBalance = (Number(balance) / 1e18).toFixed(6) + ' ETH';
      } catch (e) {
        walletBalance = 'Error fetching balance';
      }
    }

    // Get auto-range bot state
    let knownPositions: string[] = [];
    let lastScannedBlock = '0';
    try {
      knownPositions = getKnownPositions();
      lastScannedBlock = getLastScannedBlock();
    } catch (e) {
      // Bot might not be initialized yet
    }

    if (res.headersSent) return;
    res.json({
      botEnabled: config.BOT_ENABLED,
      walletConfigured,
      walletAddress: walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : null,
      walletAddressFull: walletAddress,
      walletBalance,
      chainId: config.CHAIN_ID,
      intervals: {
        compound: config.COMPOUND_INTERVAL_MS,
        autoRange: config.AUTO_RANGE_INTERVAL_MS,
        autoExit: config.AUTO_EXIT_INTERVAL_MS,
      },
      contracts: {
        v4Compoundor: blockchain.contracts.v4Compoundor ? 'configured' : 'not configured',
        v4AutoRange: blockchain.contracts.v4AutoRange ? 'configured' : 'not configured',
        v4AutoExit: blockchain.contracts.v4AutoExit ? 'configured' : 'not configured',
      },
      autoRangeBot: {
        knownPositionsCount: knownPositions.length,
        knownPositions: knownPositions,
        lastScannedBlock: lastScannedBlock,
        recentErrors: getRecentErrors(),
        processingLog: getPositionStatus(),
      },
    });
  } catch (error) {
    routeLogger.error({ error }, 'Failed to get bot status');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Failed to fetch bot status' });
  }
});

// ========== Manual Trigger Endpoint (for debugging) ==========

// Manually trigger rebalance check for a position
router.post('/range/:tokenId/trigger', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;

    // Check if position needs rebalance
    const rebalanceCheck = await blockchain.checkRebalance(BigInt(tokenId));

    if (!rebalanceCheck.needsRebalance) {
      return res.json({
        success: false,
        message: 'Position does not need rebalance',
        reason: rebalanceCheck.reason,
      });
    }

    // Try to execute rebalance
    try {
      const hash = await blockchain.executeRebalance(BigInt(tokenId), '0x');
      return res.json({
        success: true,
        message: 'Rebalance executed',
        txHash: hash,
      });
    } catch (execError: any) {
      return res.json({
        success: false,
        message: 'Rebalance execution failed',
        error: execError.message || String(execError),
      });
    }
  } catch (error: any) {
    routeLogger.error({ error, tokenId: req.params.tokenId }, 'Failed to trigger rebalance');
    if (res.headersSent) return;
    res.status(500).json({
      error: 'Failed to trigger rebalance',
      details: error.message || String(error),
    });
  }
});

export { router as automationRouter };
