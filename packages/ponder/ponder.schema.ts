import { onchainTable, onchainEnum } from "ponder";

// ============ Enums ============
export const exitTypeEnum = onchainEnum("exit_type", [
  "NONE",
  "STOP_LOSS",
  "TAKE_PROFIT",
  "RANGE_EXIT",
]);

// ============ Core Entities (Simplified - No Foreign Keys for PGLite) ============

export const token = onchainTable("token", (t) => ({
  id: t.text().primaryKey(),
  symbol: t.text().notNull(),
  name: t.text().notNull(),
  decimals: t.integer().notNull(),
  priceUSD: t.text().notNull().default("0"),
  totalSupply: t.text().notNull().default("0"),
  totalValueLocked: t.text().notNull().default("0"),
  totalValueLockedUSD: t.text().notNull().default("0"),
  volume: t.text().notNull().default("0"),
  volumeUSD: t.text().notNull().default("0"),
}));

export const pool = onchainTable("pool", (t) => ({
  id: t.text().primaryKey(),
  token0Id: t.text().notNull(),
  token1Id: t.text().notNull(),
  fee: t.integer().notNull(),
  tickSpacing: t.integer().notNull(),
  hooks: t.text().notNull(),
  sqrtPriceX96: t.text().notNull(),
  tick: t.integer().notNull(),
  liquidity: t.text().notNull(),
  totalValueLockedToken0: t.text().notNull().default("0"),
  totalValueLockedToken1: t.text().notNull().default("0"),
  totalValueLockedUSD: t.text().notNull().default("0"),
  volumeToken0: t.text().notNull().default("0"),
  volumeToken1: t.text().notNull().default("0"),
  volumeUSD: t.text().notNull().default("0"),
  feesUSD: t.text().notNull().default("0"),
}));

export const position = onchainTable("position", (t) => ({
  id: t.text().primaryKey(),
  tokenId: t.text().notNull(),
  owner: t.text().notNull(),
  poolId: t.text().notNull(),
  tickLower: t.integer().notNull(),
  tickUpper: t.integer().notNull(),
  liquidity: t.text().notNull(),
  depositedToken0: t.text().notNull().default("0"),
  depositedToken1: t.text().notNull().default("0"),
  withdrawnToken0: t.text().notNull().default("0"),
  withdrawnToken1: t.text().notNull().default("0"),
  collectedFeesToken0: t.text().notNull().default("0"),
  collectedFeesToken1: t.text().notNull().default("0"),
  createdAtTimestamp: t.text().notNull(),
  createdAtBlockNumber: t.text().notNull(),
  closedAtTimestamp: t.text(),
}));

// ============ Position Snapshots ============

export const positionSnapshot = onchainTable("position_snapshot", (t) => ({
  id: t.text().primaryKey(),
  positionId: t.text().notNull(),
  timestamp: t.text().notNull(),
  blockNumber: t.text().notNull(),
  liquidity: t.text().notNull(),
  token0Amount: t.text().notNull(),
  token1Amount: t.text().notNull(),
  token0ValueUSD: t.text().notNull(),
  token1ValueUSD: t.text().notNull(),
  totalValueUSD: t.text().notNull(),
  collectedFeesToken0: t.text().notNull(),
  collectedFeesToken1: t.text().notNull(),
  sqrtPriceX96: t.text().notNull(),
  tick: t.integer().notNull(),
}));

// ============ Automation Configs ============

export const compoundConfig = onchainTable("compound_config", (t) => ({
  id: t.text().primaryKey(),
  positionId: t.text().notNull(),
  enabled: t.boolean().notNull(),
  minCompoundInterval: t.integer().notNull(),
  minRewardAmount: t.text().notNull(),
  totalCompounds: t.integer().notNull().default(0),
  totalCompoundedToken0: t.text().notNull().default("0"),
  totalCompoundedToken1: t.text().notNull().default("0"),
  totalFeesPaidToken0: t.text().notNull().default("0"),
  totalFeesPaidToken1: t.text().notNull().default("0"),
  lastCompoundTimestamp: t.text(),
}));

export const compoundEvent = onchainTable("compound_event", (t) => ({
  id: t.text().primaryKey(),
  configId: t.text().notNull(),
  positionId: t.text().notNull(),
  caller: t.text().notNull(),
  timestamp: t.text().notNull(),
  blockNumber: t.text().notNull(),
  transactionHash: t.text().notNull(),
  amount0Compounded: t.text().notNull(),
  amount1Compounded: t.text().notNull(),
  fee0: t.text().notNull(),
  fee1: t.text().notNull(),
  liquidityAdded: t.text().notNull(),
}));

export const exitConfig = onchainTable("exit_config", (t) => ({
  id: t.text().primaryKey(),
  positionId: t.text().notNull(),
  exitType: t.integer().notNull(),
  triggerSqrtPriceX96: t.text().notNull(),
  targetCurrency: t.text().notNull(),
  maxPriceImpact: t.text().notNull(),
  swapToSingleAsset: t.boolean().notNull(),
  deadline: t.text().notNull(),
  executed: t.boolean().notNull().default(false),
  executedAt: t.text(),
}));

export const exitEvent = onchainTable("exit_event", (t) => ({
  id: t.text().primaryKey(),
  configId: t.text().notNull(),
  positionId: t.text().notNull(),
  owner: t.text().notNull(),
  timestamp: t.text().notNull(),
  blockNumber: t.text().notNull(),
  transactionHash: t.text().notNull(),
  exitType: t.integer().notNull(),
  amount0Received: t.text().notNull(),
  amount1Received: t.text().notNull(),
  totalValueReceived: t.text().notNull(),
}));

export const rangeConfig = onchainTable("range_config", (t) => ({
  id: t.text().primaryKey(),
  positionId: t.text().notNull(),
  enabled: t.boolean().notNull(),
  lowerDelta: t.integer().notNull(),
  upperDelta: t.integer().notNull(),
  rebalanceThreshold: t.integer().notNull(),
  minRebalanceInterval: t.integer().notNull(),
  collectFeesOnRebalance: t.boolean().notNull(),
  maxSwapSlippage: t.text().notNull(),
  totalRebalances: t.integer().notNull().default(0),
  lastRebalanceTimestamp: t.text(),
}));

export const rebalanceEvent = onchainTable("rebalance_event", (t) => ({
  id: t.text().primaryKey(),
  configId: t.text().notNull(),
  oldPositionId: t.text().notNull(),
  newPositionId: t.text().notNull(),
  timestamp: t.text().notNull(),
  blockNumber: t.text().notNull(),
  transactionHash: t.text().notNull(),
  newTickLower: t.integer().notNull(),
  newTickUpper: t.integer().notNull(),
  liquidity: t.text().notNull(),
  fee0: t.text().notNull(),
  fee1: t.text().notNull(),
}));

// ============ Lending/Vault Entities ============

export const vault = onchainTable("vault", (t) => ({
  id: t.text().primaryKey(),
  assetId: t.text().notNull(),
  totalSupplied: t.text().notNull().default("0"),
  totalSupplyShares: t.text().notNull().default("0"),
  totalBorrowed: t.text().notNull().default("0"),
  totalBorrowShares: t.text().notNull().default("0"),
  supplyRate: t.text().notNull().default("0"),
  borrowRate: t.text().notNull().default("0"),
  utilization: t.text().notNull().default("0"),
  totalLoans: t.integer().notNull().default(0),
  activeLoans: t.integer().notNull().default(0),
  totalLiquidations: t.integer().notNull().default(0),
  lastAccrueTime: t.text().notNull(),
}));

export const loan = onchainTable("loan", (t) => ({
  id: t.text().primaryKey(),
  positionId: t.text().notNull(),
  borrower: t.text().notNull(),
  vaultId: t.text().notNull(),
  borrowedCurrency: t.text().notNull(),
  borrowedAmount: t.text().notNull(),
  borrowedShares: t.text().notNull(),
  healthFactor: t.text().notNull(),
  isLiquidatable: t.boolean().notNull().default(false),
  liquidated: t.boolean().notNull().default(false),
  createdAtTimestamp: t.text().notNull(),
  lastUpdatedTimestamp: t.text().notNull(),
  repaidAt: t.text(),
}));

export const loanEvent = onchainTable("loan_event", (t) => ({
  id: t.text().primaryKey(),
  loanId: t.text().notNull(),
  eventType: t.text().notNull(), // BORROW, REPAY, LIQUIDATE
  timestamp: t.text().notNull(),
  blockNumber: t.text().notNull(),
  transactionHash: t.text().notNull(),
  amount: t.text().notNull(),
  shares: t.text().notNull(),
  liquidator: t.text(),
  collateralValue: t.text(),
}));

export const supply = onchainTable("supply", (t) => ({
  id: t.text().primaryKey(),
  vaultId: t.text().notNull(),
  supplier: t.text().notNull(),
  shares: t.text().notNull(),
  depositedAmount: t.text().notNull(),
  withdrawnAmount: t.text().notNull().default("0"),
  createdAtTimestamp: t.text().notNull(),
  lastUpdatedTimestamp: t.text().notNull(),
}));

// ============ Protocol Stats ============

export const protocolStats = onchainTable("protocol_stats", (t) => ({
  id: t.text().primaryKey(),
  totalPositions: t.integer().notNull().default(0),
  activePositions: t.integer().notNull().default(0),
  totalCompoundConfigs: t.integer().notNull().default(0),
  totalExitConfigs: t.integer().notNull().default(0),
  totalRangeConfigs: t.integer().notNull().default(0),
  totalVaults: t.integer().notNull().default(0),
  totalLoans: t.integer().notNull().default(0),
  activeLoans: t.integer().notNull().default(0),
  totalSupplied: t.text().notNull().default("0"),
  totalBorrowed: t.text().notNull().default("0"),
  totalVolumeUSD: t.text().notNull().default("0"),
  totalFeesUSD: t.text().notNull().default("0"),
  lastUpdateTimestamp: t.text().notNull(),
  lastUpdateBlockNumber: t.text().notNull(),
}));

export const dailyStats = onchainTable("daily_stats", (t) => ({
  id: t.text().primaryKey(),
  date: t.integer().notNull(),
  positionsCreated: t.integer().notNull().default(0),
  positionsClosed: t.integer().notNull().default(0),
  compoundsExecuted: t.integer().notNull().default(0),
  exitsExecuted: t.integer().notNull().default(0),
  rebalancesExecuted: t.integer().notNull().default(0),
  borrowsExecuted: t.integer().notNull().default(0),
  repaysExecuted: t.integer().notNull().default(0),
  liquidationsExecuted: t.integer().notNull().default(0),
  volumeUSD: t.text().notNull().default("0"),
  feesUSD: t.text().notNull().default("0"),
  tvlUSD: t.text().notNull().default("0"),
}));

// ============ Account/User Stats ============

export const account = onchainTable("account", (t) => ({
  id: t.text().primaryKey(),
  totalPositions: t.integer().notNull().default(0),
  compoundConfigsActive: t.integer().notNull().default(0),
  exitConfigsActive: t.integer().notNull().default(0),
  rangeConfigsActive: t.integer().notNull().default(0),
  totalBorrowed: t.text().notNull().default("0"),
  totalSupplied: t.text().notNull().default("0"),
  totalFeesEarned: t.text().notNull().default("0"),
  totalVolumeUSD: t.text().notNull().default("0"),
  firstActiveTimestamp: t.text().notNull(),
  lastActiveTimestamp: t.text().notNull(),
}));
