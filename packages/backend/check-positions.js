const { createPublicClient, http } = require('viem');
const { sepolia } = require('viem/chains');

const V4_AUTO_RANGE = '0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD';

const abi = [
  { name: 'rangeConfigs', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'enabled', type: 'bool' }, { name: 'lowerDelta', type: 'int24' }, { name: 'upperDelta', type: 'int24' }, { name: 'rebalanceThreshold', type: 'uint24' }, { name: 'minRebalanceInterval', type: 'uint32' }, { name: 'collectFeesOnRebalance', type: 'bool' }, { name: 'maxSwapSlippage', type: 'uint256' }] },
  { name: 'getPositionStatus', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'inRange', type: 'bool' }, { name: 'currentTick', type: 'int24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }] },
  { name: 'checkRebalance', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'needsRebalance', type: 'bool' }, { name: 'reason', type: 'uint8' }] },
  { name: 'lastRebalanceTime', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'rebalancedTo', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
];

const client = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com')
});

async function checkPosition(tokenId) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Position #${tokenId}`);
  console.log('='.repeat(50));

  const config = await client.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'rangeConfigs',
    args: [BigInt(tokenId)]
  });

  console.log('\nConfig:');
  console.log('  enabled:', config[0]);
  console.log('  lowerDelta:', config[1]);
  console.log('  upperDelta:', config[2]);
  console.log('  rebalanceThreshold:', config[3]);
  console.log('  minRebalanceInterval:', config[4], 'seconds');

  const [inRange, currentTick, tickLower, tickUpper] = await client.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'getPositionStatus',
    args: [BigInt(tokenId)]
  });

  console.log('\nPosition Status:');
  console.log('  inRange:', inRange);
  console.log('  currentTick:', currentTick);
  console.log('  range:', tickLower, 'to', tickUpper);

  if (!inRange) {
    if (currentTick < tickLower) {
      console.log('  ** BELOW range by', tickLower - currentTick, 'ticks');
    } else {
      console.log('  ** ABOVE range by', currentTick - tickUpper, 'ticks');
    }
  }

  const [needsRebalance, reason] = await client.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'checkRebalance',
    args: [BigInt(tokenId)]
  });

  console.log('\nRebalance Check:');
  console.log('  needsRebalance:', needsRebalance);
  console.log('  reason:', reason, '(0=no, 1=below, 2=above)');

  const lastRebalance = await client.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'lastRebalanceTime',
    args: [BigInt(tokenId)]
  });

  const rebalancedTo = await client.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'rebalancedTo',
    args: [BigInt(tokenId)]
  });

  const now = Math.floor(Date.now() / 1000);
  const minInterval = Number(config[4]) || 3600;
  const cooldownEnds = Number(lastRebalance) + minInterval;
  const cooldownRemaining = Math.max(0, cooldownEnds - now);

  console.log('\nCooldown:');
  console.log('  lastRebalance:', Number(lastRebalance) > 0 ? new Date(Number(lastRebalance) * 1000).toISOString() : 'never');
  console.log('  cooldownRemaining:', cooldownRemaining, 'seconds');
  console.log('  rebalancedTo:', rebalancedTo.toString());

  // Bot decision
  console.log('\n--- BOT DECISION ---');
  if (config[0] === false) {
    console.log('SKIP: Auto-range not enabled');
  } else if (rebalancedTo > 0n) {
    console.log('SKIP: Already rebalanced to position', rebalancedTo.toString());
  } else if (inRange) {
    console.log('SKIP: Position is in range');
  } else if (cooldownRemaining > 0) {
    console.log('SKIP: Cooldown active,', Math.ceil(cooldownRemaining/60), 'minutes remaining');
  } else if (needsRebalance === false) {
    console.log('SKIP: checkRebalance() returned false - checking why...');
    // Check threshold
    const threshold = config[3];
    let ticksOutOfRange = 0;
    if (currentTick < tickLower) {
      ticksOutOfRange = tickLower - currentTick;
    } else if (currentTick >= tickUpper) {
      ticksOutOfRange = currentTick - tickUpper;
    }
    console.log('  Threshold:', threshold, 'ticks');
    console.log('  Ticks out of range:', ticksOutOfRange);
    if (ticksOutOfRange < threshold) {
      console.log('  -> Position is out of range but below threshold');
    }
  } else {
    console.log('*** SHOULD REBALANCE NOW! ***');
  }
}

async function main() {
  console.log('Checking positions with auto-range enabled that are out of range...\n');

  // Positions identified as auto-range enabled and out of range
  await checkPosition(21363);
  await checkPosition(21399);
  await checkPosition(21367);
  await checkPosition(21394);
}

main().catch(console.error);
