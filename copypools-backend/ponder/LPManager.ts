import { ponder } from "@/generated";
import { positions, events, rangeMoves, positionClosures } from "./schema";

// Index PositionOpened event
ponder.on("LPManager:PositionOpened", async ({ event, context }) => {
  const { positionId, owner, protocol } = event.args;

  await context.db.insert(positions).values({
    id: positionId.toString(),
    positionId: positionId.toString(),
    protocol: protocol,
    dexTokenId: "0", // Will be updated when we fetch position details
    owner: owner,
    token0: "0x0000000000000000000000000000000000000000", // Placeholder
    token1: "0x0000000000000000000000000000000000000000", // Placeholder
    active: true,
    createdAtBlock: event.block.number,
    createdAtTimestamp: event.block.timestamp,
    lastUpdatedBlock: event.block.number,
    lastUpdatedTimestamp: event.block.timestamp,
  });

  await context.db.insert(events).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    eventType: "POSITION_OPENED",
    positionId: positionId.toString(),
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    logIndex: event.log.logIndex,
    eventData: {
      owner,
      protocol,
    },
  });
});

// Index RangeMoved event
ponder.on("LPManager:RangeMoved", async ({ event, context }) => {
  const { oldPositionId, newPositionId, newTickLower, newTickUpper } = event.args;

  // Deactivate old position
  await context.db
    .update(positions, {
      id: oldPositionId.toString(),
    })
    .set({
      active: false,
      lastUpdatedBlock: event.block.number,
      lastUpdatedTimestamp: event.block.timestamp,
    });

  // Create new position entry
  await context.db.insert(positions).values({
    id: newPositionId.toString(),
    positionId: newPositionId.toString(),
    protocol: "uniswap-v4",
    dexTokenId: "0",
    owner: "0x0000000000000000000000000000000000000000", // Will be fetched
    token0: "0x0000000000000000000000000000000000000000",
    token1: "0x0000000000000000000000000000000000000000",
    active: true,
    tickLower: Number(newTickLower),
    tickUpper: Number(newTickUpper),
    createdAtBlock: event.block.number,
    createdAtTimestamp: event.block.timestamp,
    lastUpdatedBlock: event.block.number,
    lastUpdatedTimestamp: event.block.timestamp,
  });

  // Record the range move
  await context.db.insert(rangeMoves).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    oldPositionId: oldPositionId.toString(),
    newPositionId: newPositionId.toString(),
    newTickLower: Number(newTickLower),
    newTickUpper: Number(newTickUpper),
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
  });

  // Record event
  await context.db.insert(events).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    eventType: "RANGE_MOVED",
    positionId: newPositionId.toString(),
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    logIndex: event.log.logIndex,
    eventData: {
      oldPositionId: oldPositionId.toString(),
      newPositionId: newPositionId.toString(),
      newTickLower: Number(newTickLower),
      newTickUpper: Number(newTickUpper),
    },
  });
});

// Index PositionClosed event
ponder.on("LPManager:PositionClosed", async ({ event, context }) => {
  const { positionId, amount0, amount1 } = event.args;

  // Deactivate position
  await context.db
    .update(positions, {
      id: positionId.toString(),
    })
    .set({
      active: false,
      lastUpdatedBlock: event.block.number,
      lastUpdatedTimestamp: event.block.timestamp,
    });

  // Record closure details
  await context.db.insert(positionClosures).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    positionId: positionId.toString(),
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
  });

  // Record event
  await context.db.insert(events).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    eventType: "POSITION_CLOSED",
    positionId: positionId.toString(),
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    logIndex: event.log.logIndex,
    eventData: {
      positionId: positionId.toString(),
      amount0: amount0.toString(),
      amount1: amount1.toString(),
    },
  });
});

// Index LiquidityAdded event
ponder.on("LPManager:LiquidityAdded", async ({ event, context }) => {
  const { positionId, liquidity } = event.args;

  await context.db
    .update(positions, {
      id: positionId.toString(),
    })
    .set({
      liquidity: liquidity.toString(),
      lastUpdatedBlock: event.block.number,
      lastUpdatedTimestamp: event.block.timestamp,
    });

  await context.db.insert(events).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    eventType: "LIQUIDITY_ADDED",
    positionId: positionId.toString(),
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    logIndex: event.log.logIndex,
    eventData: {
      positionId: positionId.toString(),
      liquidity: liquidity.toString(),
    },
  });
});

// Index FeesCollected event
ponder.on("LPManager:FeesCollected", async ({ event, context }) => {
  const { positionId, amount0, amount1 } = event.args;

  await context.db.insert(events).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    eventType: "FEES_COLLECTED",
    positionId: positionId.toString(),
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    logIndex: event.log.logIndex,
    eventData: {
      positionId: positionId.toString(),
      amount0: amount0.toString(),
      amount1: amount1.toString(),
    },
  });
});
