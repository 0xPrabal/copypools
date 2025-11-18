import { onchainTable, primaryKey } from "@ponder/core";

export const positions = onchainTable("positions", (t) => ({
  id: t.text().primaryKey(),
  positionId: t.text().notNull(),
  protocol: t.text().notNull(),
  dexTokenId: t.text().notNull(),
  owner: t.text().notNull(),
  token0: t.text().notNull(),
  token1: t.text().notNull(),
  active: t.boolean().notNull().default(true),
  tickLower: t.integer(),
  tickUpper: t.integer(),
  liquidity: t.text(),

  // Tracking
  createdAtBlock: t.bigint().notNull(),
  createdAtTimestamp: t.bigint().notNull(),
  lastUpdatedBlock: t.bigint().notNull(),
  lastUpdatedTimestamp: t.bigint().notNull(),
}));

export const events = onchainTable("ponder_events", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(),
  positionId: t.text(),
  txHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  blockTimestamp: t.bigint().notNull(),
  logIndex: t.integer().notNull(),
  eventData: t.json().notNull(),
}));

export const rangeMoves = onchainTable("range_moves", (t) => ({
  id: t.text().primaryKey(),
  oldPositionId: t.text().notNull(),
  newPositionId: t.text().notNull(),
  newTickLower: t.integer().notNull(),
  newTickUpper: t.integer().notNull(),
  txHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  blockTimestamp: t.bigint().notNull(),
}));

export const positionClosures = onchainTable("position_closures", (t) => ({
  id: t.text().primaryKey(),
  positionId: t.text().notNull(),
  amount0: t.text().notNull(),
  amount1: t.text().notNull(),
  txHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  blockTimestamp: t.bigint().notNull(),
}));
