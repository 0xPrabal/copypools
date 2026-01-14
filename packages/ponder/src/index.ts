import { ponder } from "ponder:registry";
import {
  position,
  pool,
  token,
  compoundConfig,
  compoundEvent,
  rangeConfig,
  rebalanceEvent,
  account,
  protocolStats,
  dailyStats
} from "ponder:schema";

// Known token metadata (fallback for unknown tokens)
const KNOWN_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
  "0x0000000000000000000000000000000000000000": { symbol: "ETH", name: "Ether", decimals: 18 },
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", name: "USD Coin", decimals: 6 },
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": { symbol: "USDbC", name: "Bridged USD Coin", decimals: 6 },
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
};

// Helper to get or create token (with upsert pattern to avoid race conditions)
async function getOrCreateToken(context: any, address: string) {
  const tokenId = address.toLowerCase();
  const existingToken = await context.db.find(token, { id: tokenId });
  if (existingToken) {
    return existingToken;
  }

  // Get known token metadata or use defaults
  const metadata = KNOWN_TOKENS[tokenId] || {
    symbol: `TKN-${tokenId.slice(0, 8)}`,
    name: `Unknown Token ${tokenId.slice(0, 8)}`,
    decimals: 18,
  };

  try {
    await context.db.insert(token).values({
      id: tokenId,
      symbol: metadata.symbol,
      name: metadata.name,
      decimals: metadata.decimals,
      priceUSD: "0",
      totalSupply: "0",
      totalValueLocked: "0",
      totalValueLockedUSD: "0",
      volume: "0",
      volumeUSD: "0",
    });
  } catch (err: any) {
    // Handle race condition - if insert fails due to duplicate, fetch existing
    if (err.message?.includes("duplicate") || err.message?.includes("UNIQUE constraint")) {
      return await context.db.find(token, { id: tokenId });
    }
    throw err;
  }

  return await context.db.find(token, { id: tokenId });
}

// Helper to get or create pool (with upsert pattern to avoid race conditions)
async function getOrCreatePool(
  context: any,
  poolId: string,
  currency0: string,
  currency1: string,
  fee: number,
  tickSpacing: number,
  hooks: string
) {
  const existingPool = await context.db.find(pool, { id: poolId });
  if (existingPool) {
    return existingPool;
  }

  try {
    await context.db.insert(pool).values({
      id: poolId,
      token0Id: currency0.toLowerCase(),
      token1Id: currency1.toLowerCase(),
      fee: fee,
      tickSpacing: tickSpacing,
      hooks: hooks.toLowerCase(),
      sqrtPriceX96: "0",
      tick: 0,
      liquidity: "0",
      totalValueLockedToken0: "0",
      totalValueLockedToken1: "0",
      totalValueLockedUSD: "0",
      volumeToken0: "0",
      volumeToken1: "0",
      volumeUSD: "0",
      feesUSD: "0",
    });
  } catch (err: any) {
    // Handle race condition - if insert fails due to duplicate, fetch existing
    if (err.message?.includes("duplicate") || err.message?.includes("UNIQUE constraint")) {
      return await context.db.find(pool, { id: poolId });
    }
    throw err;
  }

  return await context.db.find(pool, { id: poolId });
}

// Helper to get or create account (with upsert pattern to avoid race conditions)
async function getOrCreateAccount(context: any, address: string, timestamp: string) {
  const accountId = address.toLowerCase();
  const existingAccount = await context.db.find(account, { id: accountId });
  if (existingAccount) {
    return existingAccount;
  }

  try {
    await context.db.insert(account).values({
      id: accountId,
      totalPositions: 0,
      compoundConfigsActive: 0,
      exitConfigsActive: 0,
      rangeConfigsActive: 0,
      totalBorrowed: "0",
      totalSupplied: "0",
      totalFeesEarned: "0",
      totalVolumeUSD: "0",
      firstActiveTimestamp: timestamp,
      lastActiveTimestamp: timestamp,
    });
  } catch (err: any) {
    // Handle race condition - if insert fails due to duplicate, fetch existing
    if (err.message?.includes("duplicate") || err.message?.includes("UNIQUE constraint")) {
      return await context.db.find(account, { id: accountId });
    }
    throw err;
  }

  return await context.db.find(account, { id: accountId });
}

// Helper to get or create protocol stats (with upsert pattern to avoid race conditions)
async function getOrCreateProtocolStats(context: any, timestamp: string, blockNumber: string) {
  const stats = await context.db.find(protocolStats, { id: "1" });
  if (stats) {
    return stats;
  }

  try {
    await context.db.insert(protocolStats).values({
      id: "1",
      totalPositions: 0,
      activePositions: 0,
      totalCompoundConfigs: 0,
      totalExitConfigs: 0,
      totalRangeConfigs: 0,
      totalVaults: 0,
      totalLoans: 0,
      activeLoans: 0,
      totalSupplied: "0",
      totalBorrowed: "0",
      totalVolumeUSD: "0",
      totalFeesUSD: "0",
      lastUpdateTimestamp: timestamp,
      lastUpdateBlockNumber: blockNumber,
    });
  } catch (err: any) {
    // Handle race condition - if insert fails due to duplicate, fetch existing
    if (err.message?.includes("duplicate") || err.message?.includes("UNIQUE constraint")) {
      return await context.db.find(protocolStats, { id: "1" });
    }
    throw err;
  }

  return await context.db.find(protocolStats, { id: "1" });
}

// Helper to get daily stats ID
function getDailyStatsId(timestamp: bigint): string {
  const date = Math.floor(Number(timestamp) / 86400);
  return `day-${date}`;
}

// Helper to get or create daily stats (with upsert pattern to avoid race conditions)
async function getOrCreateDailyStats(context: any, timestamp: bigint) {
  const id = getDailyStatsId(timestamp);
  const date = Math.floor(Number(timestamp) / 86400);

  const stats = await context.db.find(dailyStats, { id });
  if (stats) {
    return stats;
  }

  try {
    await context.db.insert(dailyStats).values({
      id,
      date,
      positionsCreated: 0,
      positionsClosed: 0,
      compoundsExecuted: 0,
      exitsExecuted: 0,
      rebalancesExecuted: 0,
      borrowsExecuted: 0,
      repaysExecuted: 0,
      liquidationsExecuted: 0,
      volumeUSD: "0",
      feesUSD: "0",
      tvlUSD: "0",
    });
  } catch (err: any) {
    // Handle race condition - if insert fails due to duplicate, fetch existing
    if (err.message?.includes("duplicate") || err.message?.includes("UNIQUE constraint")) {
      return await context.db.find(dailyStats, { id });
    }
    throw err;
  }

  return await context.db.find(dailyStats, { id });
}

// ============ V4Utils Event Handlers ============

// Handle position minting from V4Utils
// Event: PositionMinted(uint256 indexed tokenId, address indexed owner, PoolKey poolKey, int24 tickLower, int24 tickUpper, uint128 liquidity)
ponder.on("V4Utils:PositionMinted", async ({ event, context }) => {
  try {
    const { tokenId, owner, poolKey, tickLower, tickUpper, liquidity } = event.args;

    // Extract pool info from poolKey tuple
    const currency0 = poolKey.currency0;
    const currency1 = poolKey.currency1;
    const fee = poolKey.fee;
    const tickSpacing = poolKey.tickSpacing;
    const hooks = poolKey.hooks;

    const poolId = `${currency0.toLowerCase()}-${currency1.toLowerCase()}-${fee}`;
    const positionId = tokenId.toString();
    const timestamp = event.block.timestamp.toString();
    const blockNumber = event.block.number.toString();

    // Create token entities first (to avoid orphaned references)
    await getOrCreateToken(context, currency0);
    await getOrCreateToken(context, currency1);

    // Create pool entity
    await getOrCreatePool(
      context,
      poolId,
      currency0,
      currency1,
      Number(fee),
      Number(tickSpacing),
      hooks
    );

    // Create position
    try {
      await context.db.insert(position).values({
        id: positionId,
        tokenId: positionId,
        owner: owner.toLowerCase(),
        poolId: poolId,
        tickLower: Number(tickLower),
        tickUpper: Number(tickUpper),
        liquidity: liquidity.toString(),
        depositedToken0: "0",
        depositedToken1: "0",
        withdrawnToken0: "0",
        withdrawnToken1: "0",
        collectedFeesToken0: "0",
        collectedFeesToken1: "0",
        createdAtTimestamp: timestamp,
        createdAtBlockNumber: blockNumber,
      });
    } catch (err: any) {
      // Handle duplicate position (race condition)
      if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
        throw err;
      }
    }

    // Update account stats
    const acc = await getOrCreateAccount(context, owner, timestamp);
    if (acc) {
      await context.db.update(account, { id: owner.toLowerCase() }).set({
        totalPositions: acc.totalPositions + 1,
        lastActiveTimestamp: timestamp,
      });
    }

    // Update protocol stats
    const stats = await getOrCreateProtocolStats(context, timestamp, blockNumber);
    if (stats) {
      await context.db.update(protocolStats, { id: "1" }).set({
        totalPositions: stats.totalPositions + 1,
        activePositions: stats.activePositions + 1,
        lastUpdateTimestamp: timestamp,
        lastUpdateBlockNumber: blockNumber,
      });
    }

    // Update daily stats
    const daily = await getOrCreateDailyStats(context, event.block.timestamp);
    if (daily) {
      await context.db.update(dailyStats, { id: daily.id }).set({
        positionsCreated: daily.positionsCreated + 1,
      });
    }
  } catch (error) {
    console.error(`Error handling V4Utils:PositionMinted for tokenId ${event.args.tokenId}:`, error);
    throw error; // Re-throw to ensure Ponder retries
  }
});

// Handle liquidity increase
// Event: LiquidityIncreased(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
ponder.on("V4Utils:LiquidityIncreased", async ({ event, context }) => {
  try {
    const { tokenId, liquidity, amount0, amount1 } = event.args;

    const positionId = tokenId.toString();
    const existingPosition = await context.db.find(position, { id: positionId });

    if (existingPosition) {
      const newLiquidity = BigInt(existingPosition.liquidity) + BigInt(liquidity);
      const newDeposited0 = BigInt(existingPosition.depositedToken0) + BigInt(amount0);
      const newDeposited1 = BigInt(existingPosition.depositedToken1) + BigInt(amount1);

      await context.db.update(position, { id: positionId }).set({
        liquidity: newLiquidity.toString(),
        depositedToken0: newDeposited0.toString(),
        depositedToken1: newDeposited1.toString(),
      });
    }
  } catch (error) {
    console.error(`Error handling V4Utils:LiquidityIncreased for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});

// Handle liquidity decrease
// Event: LiquidityDecreased(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
ponder.on("V4Utils:LiquidityDecreased", async ({ event, context }) => {
  try {
    const { tokenId, liquidity, amount0, amount1 } = event.args;

    const positionId = tokenId.toString();
    const existingPosition = await context.db.find(position, { id: positionId });

    if (existingPosition) {
      const currentLiquidity = BigInt(existingPosition.liquidity);
      const decreasedLiquidity = BigInt(liquidity);
      const newLiquidity = currentLiquidity > decreasedLiquidity
        ? currentLiquidity - decreasedLiquidity
        : 0n;

      const newWithdrawn0 = BigInt(existingPosition.withdrawnToken0) + BigInt(amount0);
      const newWithdrawn1 = BigInt(existingPosition.withdrawnToken1) + BigInt(amount1);

      await context.db.update(position, { id: positionId }).set({
        liquidity: newLiquidity.toString(),
        withdrawnToken0: newWithdrawn0.toString(),
        withdrawnToken1: newWithdrawn1.toString(),
        closedAtTimestamp: newLiquidity === 0n ? event.block.timestamp.toString() : existingPosition.closedAtTimestamp,
      });

      // Update protocol stats if position closed
      if (newLiquidity === 0n && currentLiquidity > 0n) {
        const stats = await context.db.find(protocolStats, { id: "1" });
        if (stats) {
          await context.db.update(protocolStats, { id: "1" }).set({
            activePositions: Math.max(0, stats.activePositions - 1),
            lastUpdateTimestamp: event.block.timestamp.toString(),
            lastUpdateBlockNumber: event.block.number.toString(),
          });
        }

        const daily = await getOrCreateDailyStats(context, event.block.timestamp);
        if (daily) {
          await context.db.update(dailyStats, { id: daily.id }).set({
            positionsClosed: daily.positionsClosed + 1,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error handling V4Utils:LiquidityDecreased for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});

// Handle fees collected
// Event: FeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1)
ponder.on("V4Utils:FeesCollected", async ({ event, context }) => {
  try {
    const { tokenId, amount0, amount1 } = event.args;

    const positionId = tokenId.toString();
    const existingPosition = await context.db.find(position, { id: positionId });

    if (existingPosition) {
      const newFees0 = BigInt(existingPosition.collectedFeesToken0) + BigInt(amount0);
      const newFees1 = BigInt(existingPosition.collectedFeesToken1) + BigInt(amount1);

      await context.db.update(position, { id: positionId }).set({
        collectedFeesToken0: newFees0.toString(),
        collectedFeesToken1: newFees1.toString(),
      });

      // Update account fees earned
      const acc = await context.db.find(account, { id: existingPosition.owner });
      if (acc) {
        const totalFeesEarned = BigInt(acc.totalFeesEarned) + BigInt(amount0) + BigInt(amount1);
        await context.db.update(account, { id: existingPosition.owner }).set({
          totalFeesEarned: totalFeesEarned.toString(),
          lastActiveTimestamp: event.block.timestamp.toString(),
        });
      }
    }
  } catch (error) {
    console.error(`Error handling V4Utils:FeesCollected for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});

// Handle Quick Rebalance (range move) via V4Utils
// Event: RangeMoved(uint256 indexed oldTokenId, uint256 indexed newTokenId, int24 newTickLower, int24 newTickUpper)
ponder.on("V4Utils:RangeMoved", async ({ event, context }) => {
  try {
    const { oldTokenId, newTokenId, newTickLower, newTickUpper } = event.args;
    const timestamp = event.block.timestamp.toString();
    const blockNumber = event.block.number.toString();

    console.log(`V4Utils:RangeMoved - Old: ${oldTokenId}, New: ${newTokenId}, Range: [${newTickLower}, ${newTickUpper}]`);

    const oldPosId = oldTokenId.toString();
    const newPosId = newTokenId.toString();

    // Fetch NEW position info from on-chain (this has the actual liquidity)
    let newLiquidity = "0";
    let poolId = "unknown";
    let owner = event.transaction.from.toLowerCase();

    try {
      // Read position info from PositionManager
      const POSITION_MANAGER = "0x7C5f5A4bBd8fD63184577525326123B519429bDc";

      // Get liquidity
      const liquidityResult = await context.client.readContract({
        address: POSITION_MANAGER as `0x${string}`,
        abi: [{
          name: "getPositionLiquidity",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [{ name: "", type: "uint128" }]
        }] as const,
        functionName: "getPositionLiquidity",
        args: [newTokenId],
      });
      newLiquidity = String(liquidityResult);
      console.log(`Fetched on-chain liquidity for ${newPosId}: ${newLiquidity}`);

      // Get owner
      const ownerResult = await context.client.readContract({
        address: POSITION_MANAGER as `0x${string}`,
        abi: [{
          name: "ownerOf",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [{ name: "", type: "address" }]
        }] as const,
        functionName: "ownerOf",
        args: [newTokenId],
      });
      owner = String(ownerResult).toLowerCase();

      // Get pool info from V4Utils
      const V4_UTILS = "0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1";
      const positionInfo = await context.client.readContract({
        address: V4_UTILS as `0x${string}`,
        abi: [{
          name: "getPositionInfo",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [
            { name: "poolKey", type: "tuple", components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" }
            ]},
            { name: "tickLower", type: "int24" },
            { name: "tickUpper", type: "int24" },
            { name: "liquidity", type: "uint128" }
          ]
        }] as const,
        functionName: "getPositionInfo",
        args: [newTokenId],
      });

      const positionData = positionInfo as any;
      const poolKey = positionData[0];
      poolId = `${String(poolKey.currency0).toLowerCase()}-${String(poolKey.currency1).toLowerCase()}-${poolKey.fee}`;
      console.log(`Fetched pool info for ${newPosId}: ${poolId}`);
    } catch (fetchError) {
      console.error(`Failed to fetch on-chain data for position ${newPosId}:`, fetchError);
      // Fall back to old position data if available
      const oldPos = await context.db.find(position, { id: oldPosId });
      if (oldPos) {
        poolId = oldPos.poolId;
        owner = oldPos.owner;
      }
    }

    // Update old position to show 0 liquidity and mark as closed
    const oldPos = await context.db.find(position, { id: oldPosId });
    if (oldPos) {
      await context.db.update(position, { id: oldPosId }).set({
        liquidity: "0",
        closedAtTimestamp: timestamp,
      });
      console.log(`Updated old position ${oldPosId} liquidity to 0`);
    }

    // Create or update new position record with ON-CHAIN liquidity
    const existingNewPos = await context.db.find(position, { id: newPosId });

    if (existingNewPos) {
      // Update existing position with new tick range AND liquidity from on-chain
      await context.db.update(position, { id: newPosId }).set({
        tickLower: Number(newTickLower),
        tickUpper: Number(newTickUpper),
        liquidity: newLiquidity,
        poolId: poolId !== "unknown" ? poolId : existingNewPos.poolId,
      });
      console.log(`Updated new position ${newPosId} with on-chain liquidity: ${newLiquidity}`);
    } else {
      // Create new position record with on-chain data
      try {
        await context.db.insert(position).values({
          id: newPosId,
          tokenId: newTokenId.toString(),
          owner: owner,
          poolId: poolId,
          tickLower: Number(newTickLower),
          tickUpper: Number(newTickUpper),
          liquidity: newLiquidity,
          createdAtTimestamp: timestamp,
          createdAtBlockNumber: blockNumber,
        });
        console.log(`Created new position ${newPosId} with on-chain liquidity: ${newLiquidity}`);
      } catch (err: any) {
        if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
          throw err;
        }
      }
    }

    // Transfer any automation configs from old to new position
    // Transfer range config if exists
    const oldRangeConfig = await context.db.find(rangeConfig, { id: `range-${oldPosId}` });
    if (oldRangeConfig && oldRangeConfig.enabled) {
      const newConfigId = `range-${newPosId}`;
      const existingNewConfig = await context.db.find(rangeConfig, { id: newConfigId });

      if (!existingNewConfig) {
        try {
          await context.db.insert(rangeConfig).values({
            id: newConfigId,
            positionId: newPosId,
            enabled: true,
            lowerDelta: oldRangeConfig.lowerDelta,
            upperDelta: oldRangeConfig.upperDelta,
            rebalanceThreshold: oldRangeConfig.rebalanceThreshold,
            minRebalanceInterval: oldRangeConfig.minRebalanceInterval,
            collectFeesOnRebalance: oldRangeConfig.collectFeesOnRebalance,
            maxSwapSlippage: oldRangeConfig.maxSwapSlippage,
            totalRebalances: 0,
            lastRebalanceTimestamp: timestamp,
          });
          console.log(`Transferred range config from ${oldPosId} to ${newPosId}`);
        } catch (err: any) {
          if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
            throw err;
          }
        }
      }

      // Disable old range config
      await context.db.update(rangeConfig, { id: `range-${oldPosId}` }).set({
        enabled: false,
      });
    }

    // Transfer compound config if exists
    const oldCompoundConfig = await context.db.find(compoundConfig, { id: `compound-${oldPosId}` });
    if (oldCompoundConfig && oldCompoundConfig.enabled) {
      const newCompoundId = `compound-${newPosId}`;
      const existingNewCompound = await context.db.find(compoundConfig, { id: newCompoundId });

      if (!existingNewCompound) {
        try {
          await context.db.insert(compoundConfig).values({
            id: newCompoundId,
            positionId: newPosId,
            enabled: true,
            minCompoundInterval: oldCompoundConfig.minCompoundInterval,
            minRewardAmount: oldCompoundConfig.minRewardAmount,
            totalCompounds: 0,
            lastCompoundTimestamp: timestamp,
          });
          console.log(`Transferred compound config from ${oldPosId} to ${newPosId}`);
        } catch (err: any) {
          if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
            throw err;
          }
        }
      }

      // Disable old compound config
      await context.db.update(compoundConfig, { id: `compound-${oldPosId}` }).set({
        enabled: false,
      });
    }

    // Update daily stats
    const daily = await getOrCreateDailyStats(context, event.block.timestamp);
    if (daily) {
      await context.db.update(dailyStats, { id: daily.id }).set({
        rebalancesExecuted: daily.rebalancesExecuted + 1,
      });
    }

  } catch (error) {
    console.error(`Error handling V4Utils:RangeMoved for oldTokenId ${event.args.oldTokenId}:`, error);
    throw error;
  }
});

// ============ V4Compoundor Event Handlers ============

// Handle position registration for compounding
// Event: PositionRegistered(uint256 indexed tokenId, address indexed owner)
ponder.on("V4Compoundor:PositionRegistered", async ({ event, context }) => {
  try {
    const { tokenId, owner } = event.args;

    const configId = `compound-${tokenId}`;
    const timestamp = event.block.timestamp.toString();

    // Check if config already exists (upsert pattern)
    const existingConfig = await context.db.find(compoundConfig, { id: configId });

    if (existingConfig) {
      // Re-enable if it was disabled
      if (!existingConfig.enabled) {
        await context.db.update(compoundConfig, { id: configId }).set({
          enabled: true,
        });

        // Update account stats
        const acc = await context.db.find(account, { id: owner.toLowerCase() });
        if (acc) {
          await context.db.update(account, { id: owner.toLowerCase() }).set({
            compoundConfigsActive: acc.compoundConfigsActive + 1,
            lastActiveTimestamp: timestamp,
          });
        }

        // Update protocol stats
        const stats = await context.db.find(protocolStats, { id: "1" });
        if (stats) {
          await context.db.update(protocolStats, { id: "1" }).set({
            totalCompoundConfigs: stats.totalCompoundConfigs + 1,
            lastUpdateTimestamp: timestamp,
            lastUpdateBlockNumber: event.block.number.toString(),
          });
        }
      }
    } else {
      // Create new config with race condition handling
      try {
        await context.db.insert(compoundConfig).values({
          id: configId,
          positionId: tokenId.toString(),
          enabled: true,
          minCompoundInterval: 3600, // Default 1 hour
          minRewardAmount: "0", // Will be set from on-chain if needed
          totalCompounds: 0,
          totalCompoundedToken0: "0",
          totalCompoundedToken1: "0",
          totalFeesPaidToken0: "0",
          totalFeesPaidToken1: "0",
        });
      } catch (err: any) {
        // Handle race condition - config may have been created by another handler
        if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
          throw err;
        }
      }

      // Update account stats
      const acc = await getOrCreateAccount(context, owner, timestamp);
      if (acc) {
        await context.db.update(account, { id: owner.toLowerCase() }).set({
          compoundConfigsActive: acc.compoundConfigsActive + 1,
          lastActiveTimestamp: timestamp,
        });
      }

      // Update protocol stats
      const stats = await getOrCreateProtocolStats(context, timestamp, event.block.number.toString());
      if (stats) {
        await context.db.update(protocolStats, { id: "1" }).set({
          totalCompoundConfigs: stats.totalCompoundConfigs + 1,
          lastUpdateTimestamp: timestamp,
          lastUpdateBlockNumber: event.block.number.toString(),
        });
      }
    }
  } catch (error) {
    console.error(`Error handling V4Compoundor:PositionRegistered for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});

// Handle position unregistration
// Event: PositionUnregistered(uint256 indexed tokenId, address indexed owner)
ponder.on("V4Compoundor:PositionUnregistered", async ({ event, context }) => {
  try {
    const { tokenId, owner } = event.args;

    const configId = `compound-${tokenId}`;
    const timestamp = event.block.timestamp.toString();

    const existingConfig = await context.db.find(compoundConfig, { id: configId });

    if (existingConfig && existingConfig.enabled) {
      await context.db.update(compoundConfig, { id: configId }).set({
        enabled: false,
      });

      // Update account stats
      const acc = await context.db.find(account, { id: owner.toLowerCase() });
      if (acc && acc.compoundConfigsActive > 0) {
        await context.db.update(account, { id: owner.toLowerCase() }).set({
          compoundConfigsActive: acc.compoundConfigsActive - 1,
          lastActiveTimestamp: timestamp,
        });
      }

      // Update protocol stats
      const stats = await context.db.find(protocolStats, { id: "1" });
      if (stats && stats.totalCompoundConfigs > 0) {
        await context.db.update(protocolStats, { id: "1" }).set({
          totalCompoundConfigs: stats.totalCompoundConfigs - 1,
          lastUpdateTimestamp: timestamp,
          lastUpdateBlockNumber: event.block.number.toString(),
        });
      }
    }
  } catch (error) {
    console.error(`Error handling V4Compoundor:PositionUnregistered for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});

// Handle auto compound execution
// Event: AutoCompounded(uint256 indexed tokenId, address indexed caller, uint256 amount0Compounded, uint256 amount1Compounded, uint256 fee0, uint256 fee1, uint128 liquidityAdded)
ponder.on("V4Compoundor:AutoCompounded", async ({ event, context }) => {
  try {
    const { tokenId, caller, amount0Compounded, amount1Compounded, fee0, fee1, liquidityAdded } = event.args;

    const configId = `compound-${tokenId}`;
    const eventId = `${event.transaction.hash}-${event.log.logIndex}`;
    const timestamp = event.block.timestamp.toString();
    const blockNumber = event.block.number.toString();

    // Update config
    const existingConfig = await context.db.find(compoundConfig, { id: configId });
    if (existingConfig) {
      await context.db.update(compoundConfig, { id: configId }).set({
        totalCompounds: existingConfig.totalCompounds + 1,
        totalCompoundedToken0: (BigInt(existingConfig.totalCompoundedToken0) + BigInt(amount0Compounded)).toString(),
        totalCompoundedToken1: (BigInt(existingConfig.totalCompoundedToken1) + BigInt(amount1Compounded)).toString(),
        totalFeesPaidToken0: (BigInt(existingConfig.totalFeesPaidToken0) + BigInt(fee0)).toString(),
        totalFeesPaidToken1: (BigInt(existingConfig.totalFeesPaidToken1) + BigInt(fee1)).toString(),
        lastCompoundTimestamp: timestamp,
      });
    }

    // Create event record with race condition handling
    try {
      await context.db.insert(compoundEvent).values({
        id: eventId,
        configId: configId,
        positionId: tokenId.toString(),
        caller: caller.toLowerCase(),
        timestamp: timestamp,
        blockNumber: blockNumber,
        transactionHash: event.transaction.hash,
        amount0Compounded: amount0Compounded.toString(),
        amount1Compounded: amount1Compounded.toString(),
        fee0: fee0.toString(),
        fee1: fee1.toString(),
        liquidityAdded: liquidityAdded.toString(),
      });
    } catch (err: any) {
      if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
        throw err;
      }
    }

    // Update daily stats
    const daily = await getOrCreateDailyStats(context, event.block.timestamp);
    if (daily) {
      await context.db.update(dailyStats, { id: daily.id }).set({
        compoundsExecuted: daily.compoundsExecuted + 1,
      });
    }
  } catch (error) {
    console.error(`Error handling V4Compoundor:AutoCompounded for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});

// ============ V4AutoRange Event Handlers ============

// Handle range configuration
// Event: RangeConfigured(uint256 indexed tokenId, address indexed owner, int24 lowerDelta, int24 upperDelta, uint32 rebalanceThreshold)
ponder.on("V4AutoRange:RangeConfigured", async ({ event, context }) => {
  try {
    const { tokenId, owner, lowerDelta, upperDelta, rebalanceThreshold } = event.args;

    const configId = `range-${tokenId}`;
    const timestamp = event.block.timestamp.toString();

    // Check if config already exists
    const existingConfig = await context.db.find(rangeConfig, { id: configId });

    if (existingConfig) {
      // Update existing config
      await context.db.update(rangeConfig, { id: configId }).set({
        enabled: true,
        lowerDelta: Number(lowerDelta),
        upperDelta: Number(upperDelta),
        rebalanceThreshold: Number(rebalanceThreshold),
      });

      // Update stats only if it was disabled before
      if (!existingConfig.enabled) {
        const acc = await context.db.find(account, { id: owner.toLowerCase() });
        if (acc) {
          await context.db.update(account, { id: owner.toLowerCase() }).set({
            rangeConfigsActive: acc.rangeConfigsActive + 1,
            lastActiveTimestamp: timestamp,
          });
        }

        const stats = await context.db.find(protocolStats, { id: "1" });
        if (stats) {
          await context.db.update(protocolStats, { id: "1" }).set({
            totalRangeConfigs: stats.totalRangeConfigs + 1,
            lastUpdateTimestamp: timestamp,
            lastUpdateBlockNumber: event.block.number.toString(),
          });
        }
      }
    } else {
      // Create new config with race condition handling
      try {
        await context.db.insert(rangeConfig).values({
          id: configId,
          positionId: tokenId.toString(),
          enabled: true,
          lowerDelta: Number(lowerDelta),
          upperDelta: Number(upperDelta),
          rebalanceThreshold: Number(rebalanceThreshold),
          minRebalanceInterval: 3600, // Default 1 hour
          collectFeesOnRebalance: true,
          maxSwapSlippage: "500", // 5% default (in basis points)
          totalRebalances: 0,
        });
      } catch (err: any) {
        if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
          throw err;
        }
      }

      // Update account stats
      const acc = await getOrCreateAccount(context, owner, timestamp);
      if (acc) {
        await context.db.update(account, { id: owner.toLowerCase() }).set({
          rangeConfigsActive: acc.rangeConfigsActive + 1,
          lastActiveTimestamp: timestamp,
        });
      }

      // Update protocol stats
      const stats = await getOrCreateProtocolStats(context, timestamp, event.block.number.toString());
      if (stats) {
        await context.db.update(protocolStats, { id: "1" }).set({
          totalRangeConfigs: stats.totalRangeConfigs + 1,
          lastUpdateTimestamp: timestamp,
          lastUpdateBlockNumber: event.block.number.toString(),
        });
      }
    }
  } catch (error) {
    console.error(`Error handling V4AutoRange:RangeConfigured for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});

// Handle range removal
// Event: RangeRemoved(uint256 indexed tokenId)
ponder.on("V4AutoRange:RangeRemoved", async ({ event, context }) => {
  try {
    const { tokenId } = event.args;

    const configId = `range-${tokenId}`;
    const timestamp = event.block.timestamp.toString();

    const existingConfig = await context.db.find(rangeConfig, { id: configId });

    if (existingConfig && existingConfig.enabled) {
      await context.db.update(rangeConfig, { id: configId }).set({
        enabled: false,
      });

      // Find position owner
      const pos = await context.db.find(position, { id: tokenId.toString() });
      if (pos) {
        const acc = await context.db.find(account, { id: pos.owner });
        if (acc && acc.rangeConfigsActive > 0) {
          await context.db.update(account, { id: pos.owner }).set({
            rangeConfigsActive: acc.rangeConfigsActive - 1,
            lastActiveTimestamp: timestamp,
          });
        }
      }

      // Update protocol stats
      const stats = await context.db.find(protocolStats, { id: "1" });
      if (stats && stats.totalRangeConfigs > 0) {
        await context.db.update(protocolStats, { id: "1" }).set({
          totalRangeConfigs: stats.totalRangeConfigs - 1,
          lastUpdateTimestamp: timestamp,
          lastUpdateBlockNumber: event.block.number.toString(),
        });
      }
    }
  } catch (error) {
    console.error(`Error handling V4AutoRange:RangeRemoved for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});

// Handle rebalance execution
// Event: Rebalanced(uint256 indexed oldTokenId, uint256 indexed newTokenId, int24 newTickLower, int24 newTickUpper, uint128 liquidity, uint256 fee0, uint256 fee1)
ponder.on("V4AutoRange:Rebalanced", async ({ event, context }) => {
  try {
    const { oldTokenId, newTokenId, newTickLower, newTickUpper, liquidity, fee0, fee1 } = event.args;

    const configId = `range-${oldTokenId}`;
    const eventId = `${event.transaction.hash}-${event.log.logIndex}`;
    const timestamp = event.block.timestamp.toString();
    const blockNumber = event.block.number.toString();

    // Update config
    const existingConfig = await context.db.find(rangeConfig, { id: configId });
    if (existingConfig) {
      await context.db.update(rangeConfig, { id: configId }).set({
        totalRebalances: existingConfig.totalRebalances + 1,
        lastRebalanceTimestamp: timestamp,
      });

      // If new token ID is different, create a new range config for it
      if (oldTokenId.toString() !== newTokenId.toString()) {
        const newConfigId = `range-${newTokenId}`;
        const newConfig = await context.db.find(rangeConfig, { id: newConfigId });

        if (!newConfig) {
          try {
            await context.db.insert(rangeConfig).values({
              id: newConfigId,
              positionId: newTokenId.toString(),
              enabled: existingConfig.enabled,
              lowerDelta: existingConfig.lowerDelta,
              upperDelta: existingConfig.upperDelta,
              rebalanceThreshold: existingConfig.rebalanceThreshold,
              minRebalanceInterval: existingConfig.minRebalanceInterval,
              collectFeesOnRebalance: existingConfig.collectFeesOnRebalance,
              maxSwapSlippage: existingConfig.maxSwapSlippage,
              totalRebalances: 0,
            });
          } catch (err: any) {
            if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
              throw err;
            }
          }
        }

        // Disable old config
        await context.db.update(rangeConfig, { id: configId }).set({
          enabled: false,
        });
      }
    }

    // Create event record with race condition handling
    try {
      await context.db.insert(rebalanceEvent).values({
        id: eventId,
        configId: configId,
        oldPositionId: oldTokenId.toString(),
        newPositionId: newTokenId.toString(),
        timestamp: timestamp,
        blockNumber: blockNumber,
        transactionHash: event.transaction.hash,
        newTickLower: Number(newTickLower),
        newTickUpper: Number(newTickUpper),
        liquidity: liquidity.toString(),
        fee0: fee0.toString(),
        fee1: fee1.toString(),
      });
    } catch (err: any) {
      if (!err.message?.includes("duplicate") && !err.message?.includes("UNIQUE constraint")) {
        throw err;
      }
    }

    // Update daily stats
    const daily = await getOrCreateDailyStats(context, event.block.timestamp);
    if (daily) {
      await context.db.update(dailyStats, { id: daily.id }).set({
        rebalancesExecuted: daily.rebalancesExecuted + 1,
      });
    }
  } catch (error) {
    console.error(`Error handling V4AutoRange:Rebalanced for oldTokenId ${event.args.oldTokenId}:`, error);
    throw error;
  }
});

// ============ PositionManager Event Handlers ============
// Index ERC721 Transfer events to track ALL position ownership

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Handle PositionManager Transfer events for comprehensive position tracking
// This catches: mints (from = 0x0), transfers, and burns (to = 0x0)
ponder.on("PositionManager:Transfer", async ({ event, context }) => {
  try {
    const { from, to, tokenId } = event.args;
    const positionId = tokenId.toString();
    const timestamp = event.block.timestamp.toString();
    const blockNumber = event.block.number.toString();

    // MINT: from = 0x0 (position created)
    if (from.toLowerCase() === ZERO_ADDRESS) {
      // Check if position already exists (from V4Utils:PositionMinted)
      const existing = await context.db.find(position, { id: positionId });

      if (!existing) {
        // Create minimal position record - pool info may be enriched by V4Utils:PositionMinted
        // if both events fire in same transaction
        let inserted = false;
        try {
          await context.db.insert(position).values({
            id: positionId,
            tokenId: positionId,
            owner: to.toLowerCase(),
            poolId: "unknown", // Will be updated by V4Utils:PositionMinted or on-chain fetch
            tickLower: 0,
            tickUpper: 0,
            liquidity: "0",
            depositedToken0: "0",
            depositedToken1: "0",
            withdrawnToken0: "0",
            withdrawnToken1: "0",
            collectedFeesToken0: "0",
            collectedFeesToken1: "0",
            createdAtTimestamp: timestamp,
            createdAtBlockNumber: blockNumber,
          });
          inserted = true;
        } catch (err: any) {
          // Handle race condition with V4Utils:PositionMinted - position already exists
          // Return early to avoid double-counting stats (V4Utils handler already updated them)
          if (err.message?.includes("duplicate") || err.message?.includes("UNIQUE constraint")) {
            return;
          }
          throw err;
        }

        // Only update stats if we actually inserted a new position
        if (!inserted) return;

        // Update protocol stats for new position
        const stats = await getOrCreateProtocolStats(context, timestamp, blockNumber);
        if (stats) {
          await context.db.update(protocolStats, { id: "1" }).set({
            totalPositions: stats.totalPositions + 1,
            activePositions: stats.activePositions + 1,
            lastUpdateTimestamp: timestamp,
            lastUpdateBlockNumber: blockNumber,
          });
        }

        // Update daily stats
        const daily = await getOrCreateDailyStats(context, event.block.timestamp);
        if (daily) {
          await context.db.update(dailyStats, { id: daily.id }).set({
            positionsCreated: daily.positionsCreated + 1,
          });
        }

        // Create or update account for new owner
        const acc = await getOrCreateAccount(context, to, timestamp);
        if (acc) {
          await context.db.update(account, { id: to.toLowerCase() }).set({
            totalPositions: acc.totalPositions + 1,
            lastActiveTimestamp: timestamp,
          });
        }
      }
      return;
    }

    // BURN: to = 0x0 (position destroyed)
    if (to.toLowerCase() === ZERO_ADDRESS) {
      const existing = await context.db.find(position, { id: positionId });
      if (existing) {
        await context.db.update(position, { id: positionId }).set({
          closedAtTimestamp: timestamp,
          liquidity: "0",
        });

        // Update protocol stats
        const stats = await context.db.find(protocolStats, { id: "1" });
        if (stats && stats.activePositions > 0) {
          await context.db.update(protocolStats, { id: "1" }).set({
            activePositions: stats.activePositions - 1,
            lastUpdateTimestamp: timestamp,
            lastUpdateBlockNumber: blockNumber,
          });
        }

        // Update daily stats
        const daily = await getOrCreateDailyStats(context, event.block.timestamp);
        if (daily) {
          await context.db.update(dailyStats, { id: daily.id }).set({
            positionsClosed: daily.positionsClosed + 1,
          });
        }

        // Update account stats
        if (existing.owner) {
          const acc = await context.db.find(account, { id: existing.owner });
          if (acc && acc.totalPositions > 0) {
            await context.db.update(account, { id: existing.owner }).set({
              totalPositions: acc.totalPositions - 1,
              lastActiveTimestamp: timestamp,
            });
          }
        }
      }
      return;
    }

    // TRANSFER: ownership change (neither mint nor burn)
    const existing = await context.db.find(position, { id: positionId });
    if (existing) {
      const previousOwner = existing.owner;

      // Update position owner
      await context.db.update(position, { id: positionId }).set({
        owner: to.toLowerCase(),
      });

      // Update old owner's position count
      if (previousOwner) {
        const oldAcc = await context.db.find(account, { id: previousOwner });
        if (oldAcc && oldAcc.totalPositions > 0) {
          await context.db.update(account, { id: previousOwner }).set({
            totalPositions: oldAcc.totalPositions - 1,
            lastActiveTimestamp: timestamp,
          });
        }
      }

      // Update new owner's position count
      const newAcc = await getOrCreateAccount(context, to, timestamp);
      if (newAcc) {
        await context.db.update(account, { id: to.toLowerCase() }).set({
          totalPositions: newAcc.totalPositions + 1,
          lastActiveTimestamp: timestamp,
        });
      }
    }
  } catch (error) {
    console.error(`Error handling PositionManager:Transfer for tokenId ${event.args.tokenId}:`, error);
    throw error;
  }
});
