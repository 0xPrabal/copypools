import { ponder } from "@/generated";
import { position, rangeMoveEvent, closeEvent, compoundEvent } from "../ponder.schema";
import AdapterABI from "../abis/UniswapV4AdapterProduction.json";

// PositionOpened event handler
ponder.on("LPManager:PositionOpened", async ({ event, context }) => {
  const { positionId, owner, protocol, dexTokenId } = event.args;

  // Fetch real position data from LPManager contract (positions mapping)
  const lpManagerPosition = await context.client.readContract({
    abi: context.contracts.LPManager.abi,
    address: context.contracts.LPManager.address,
    functionName: "positions",
    args: [positionId],
  });

  // Try to fetch adapter position data using the new getPosition() function
  // Note: Old positions from previous adapter won't exist in new adapter
  let tickLower = 0;
  let tickUpper = 0;
  let liquidity = BigInt(0);

  try {
    const adapterPosition = await context.client.readContract({
      abi: AdapterABI.abi,
      address: process.env.ADAPTER_ADDRESS as `0x${string}`,
      functionName: "getPosition",
      args: [dexTokenId],
    });

    // getPosition returns: [PoolKey, owner, tickLower, tickUpper, liquidity]
    const posData = adapterPosition as readonly [any, string, number, number, bigint];
    tickLower = posData[2];
    tickUpper = posData[3];
    liquidity = posData[4];
  } catch (error) {
    // Position doesn't exist in new adapter (likely from old adapter)
    console.log(`⚠️  Position ${positionId} (dexTokenId ${dexTokenId}) not found in NEW adapter - SKIPPING`);
    return; // Skip positions that don't exist in the new adapter
  }

  // Skip positions with no liquidity (from old adapters)
  if (liquidity === BigInt(0)) {
    console.log(`⚠️  Position ${positionId} has zero liquidity in NEW adapter - SKIPPING`);
    return;
  }

  // Use upsert to handle reorgs and duplicate position IDs gracefully
  await context.db.insert(position).values({
    id: positionId.toString(),
    protocol,
    dexTokenId: dexTokenId.toString(),
    owner,
    token0: lpManagerPosition[3], // token0 is index 3 in the positions mapping
    token1: lpManagerPosition[4], // token1 is index 4
    active: lpManagerPosition[5], // active is index 5
    tickLower: Number(tickLower),
    tickUpper: Number(tickUpper),
    liquidity: liquidity.toString(),
    createdAt: BigInt(event.block.timestamp),
    createdTxHash: event.transaction.hash,
    createdBlockNumber: BigInt(event.block.number),
    updatedAt: BigInt(event.block.timestamp),
  }).onConflictDoUpdate({ tickLower: Number(tickLower), tickUpper: Number(tickUpper), liquidity: liquidity.toString(), updatedAt: BigInt(event.block.timestamp) });
});

// RangeMoved event handler
ponder.on("LPManager:RangeMoved", async ({ event, context }) => {
  const { oldPositionId, newPositionId, newTickLower, newTickUpper } = event.args;

  // Mark old position as inactive
  await context.db
    .update(position, { id: oldPositionId.toString() })
    .set({
      active: false,
      updatedAt: BigInt(event.block.timestamp),
    });

  // Get old position data to copy to new position
  const oldPosition = await context.db
    .find(position, { id: oldPositionId.toString() });

  if (oldPosition) {
    // Create new position entry (use upsert to handle reorgs)
    await context.db.insert(position).values({
      id: newPositionId.toString(),
      protocol: oldPosition.protocol,
      dexTokenId: newPositionId.toString(),
      owner: oldPosition.owner,
      token0: oldPosition.token0,
      token1: oldPosition.token1,
      active: true,
      tickLower: Number(newTickLower),
      tickUpper: Number(newTickUpper),
      liquidity: oldPosition.liquidity,
      createdAt: BigInt(event.block.timestamp),
      createdTxHash: event.transaction.hash,
      createdBlockNumber: BigInt(event.block.number),
      updatedAt: BigInt(event.block.timestamp),
    }).onConflictDoUpdate({ tickLower: Number(newTickLower), tickUpper: Number(newTickUpper), updatedAt: BigInt(event.block.timestamp) });
  }

  // Record the range move event (use upsert to handle reorgs)
  await context.db.insert(rangeMoveEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    oldPositionId: oldPositionId.toString(),
    newPositionId: newPositionId.toString(),
    newTickLower: Number(newTickLower),
    newTickUpper: Number(newTickUpper),
    txHash: event.transaction.hash,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
  }).onConflictDoNothing();
});

// PositionClosed event handler
ponder.on("LPManager:PositionClosed", async ({ event, context }) => {
  const { positionId, amount0, amount1 } = event.args;

  // Check if position exists before updating
  const existingPosition = await context.db.find(position, { id: positionId.toString() });

  if (existingPosition) {
    // Mark position as inactive
    await context.db
      .update(position, { id: positionId.toString() })
      .set({
        active: false,
        liquidity: "0",
        updatedAt: BigInt(event.block.timestamp),
      });
  }

  // Record the close event (use upsert to handle reorgs)
  await context.db.insert(closeEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    positionId: positionId.toString(),
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    txHash: event.transaction.hash,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
  }).onConflictDoNothing();
});

// Compounded event handler
ponder.on("LPManager:Compounded", async ({ event, context }) => {
  const { positionId, addedLiquidity } = event.args;

  // Update position liquidity
  const currentPosition = await context.db
    .find(position, { id: positionId.toString() });

  if (currentPosition) {
    const newLiquidity = BigInt(currentPosition.liquidity || "0") + addedLiquidity;

    await context.db
      .update(position, { id: positionId.toString() })
      .set({
        liquidity: newLiquidity.toString(),
        updatedAt: BigInt(event.block.timestamp),
      });
  }

  // Record the compound event
  await context.db.insert(compoundEvent).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    positionId: positionId.toString(),
    addedLiquidity: addedLiquidity.toString(),
    txHash: event.transaction.hash,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
  });
});
