import { onchainTable, index } from "@ponder/core";

export const position = onchainTable("ponder_position", (t) => ({
  id: t.text().primaryKey(), // Position ID as string
  protocol: t.text().notNull(),
  dexTokenId: t.text().notNull(),
  owner: t.text().notNull(),
  token0: t.text().notNull(),
  token1: t.text().notNull(),
  active: t.boolean().notNull().default(true),
  tickLower: t.integer(),
  tickUpper: t.integer(),
  liquidity: t.text(),
  createdAt: t.bigint().notNull(),
  createdTxHash: t.text().notNull(),
  createdBlockNumber: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}), (table) => ({
  ownerIdx: index().on(table.owner),
  activeIdx: index().on(table.active),
}));

export const rangeMoveEvent = onchainTable("ponder_range_move_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  oldPositionId: t.text().notNull(),
  newPositionId: t.text().notNull(),
  newTickLower: t.integer().notNull(),
  newTickUpper: t.integer().notNull(),
  txHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  oldPositionIdx: index().on(table.oldPositionId),
  newPositionIdx: index().on(table.newPositionId),
}));

export const closeEvent = onchainTable("ponder_close_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  positionId: t.text().notNull(),
  amount0: t.text().notNull(),
  amount1: t.text().notNull(),
  txHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  positionIdx: index().on(table.positionId),
}));

export const compoundEvent = onchainTable("ponder_compound_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  positionId: t.text().notNull(),
  addedLiquidity: t.text().notNull(),
  txHash: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  positionIdx: index().on(table.positionId),
}));
