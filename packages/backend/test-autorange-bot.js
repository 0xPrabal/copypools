const { createPublicClient, createWalletClient, http, parseAbiItem } = require('viem');
const { sepolia } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const V4_AUTO_RANGE = '0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD';

// Full ABI for V4AutoRange
const V4AutoRangeAbi = [
  { name: 'VERSION', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'getPositionStatus', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'inRange', type: 'bool' }, { name: 'currentTick', type: 'int24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }] },
  { name: 'checkRebalance', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'needsRebalance', type: 'bool' }, { name: 'reason', type: 'uint8' }] },
  { name: 'rangeConfigs', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'enabled', type: 'bool' }, { name: 'lowerDelta', type: 'int24' }, { name: 'upperDelta', type: 'int24' }, { name: 'rebalanceThreshold', type: 'uint24' }, { name: 'minRebalanceInterval', type: 'uint32' }, { name: 'collectFeesOnRebalance', type: 'bool' }, { name: 'maxSwapSlippage', type: 'uint256' }] },
  { name: 'calculateOptimalRange', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }] },
  { name: 'lastRebalanceTime', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'rebalancedTo', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'executeRebalance', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'swapData', type: 'bytes' }], outputs: [{ name: 'result', type: 'tuple', components: [{ name: 'newTokenId', type: 'uint256' }, { name: 'newTickLower', type: 'int24' }, { name: 'newTickUpper', type: 'int24' }, { name: 'liquidity', type: 'uint128' }, { name: 'fee0', type: 'uint256' }, { name: 'fee1', type: 'uint256' }] }] }
];

// Bot private key
const PRIVATE_KEY = '0xdfdf5d6fd6159c3c544119ddeaf5d675f3e365241f1e3f2c63b552cd1d659fd2';

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com')
});

const account = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http('https://ethereum-sepolia-rpc.publicnode.com')
});

// Track the position chain
async function getLatestPosition(startTokenId) {
  let tokenId = BigInt(startTokenId);
  let chain = [tokenId];

  while (true) {
    const rebalancedTo = await publicClient.readContract({
      address: V4_AUTO_RANGE,
      abi: V4AutoRangeAbi,
      functionName: 'rebalancedTo',
      args: [tokenId]
    });

    if (rebalancedTo === 0n) break;
    tokenId = rebalancedTo;
    chain.push(tokenId);
  }

  return { latestTokenId: tokenId, chain };
}

// Check position status
async function checkPositionStatus(tokenId) {
  const [inRange, currentTick, tickLower, tickUpper] = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'getPositionStatus',
    args: [tokenId]
  });

  return { inRange, currentTick, tickLower, tickUpper };
}

// Check config
async function getConfig(tokenId) {
  const config = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'rangeConfigs',
    args: [tokenId]
  });

  return {
    enabled: config[0],
    lowerDelta: config[1],
    upperDelta: config[2],
    rebalanceThreshold: config[3],
    minRebalanceInterval: config[4],
    collectFeesOnRebalance: config[5],
    maxSwapSlippage: config[6]
  };
}

// Check cooldown
async function checkCooldown(tokenId, minInterval) {
  const lastRebalance = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'lastRebalanceTime',
    args: [tokenId]
  });

  const now = Math.floor(Date.now() / 1000);
  const cooldownEnds = Number(lastRebalance) + Number(minInterval);
  const remaining = Math.max(0, cooldownEnds - now);

  return {
    lastRebalance: new Date(Number(lastRebalance) * 1000),
    cooldownEnds: new Date(cooldownEnds * 1000),
    remainingSeconds: remaining,
    canRebalance: remaining === 0
  };
}

// Check rebalance
async function checkRebalance(tokenId) {
  const [needsRebalance, reason] = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'checkRebalance',
    args: [tokenId]
  });

  const reasons = { 0: 'No (in range/not configured)', 1: 'Below range', 2: 'Above range' };
  return { needsRebalance, reason, reasonText: reasons[reason] || 'Unknown' };
}

// Execute rebalance
async function executeRebalance(tokenId) {
  console.log(`\nExecuting rebalance for token ${tokenId}...`);

  try {
    const { request } = await publicClient.simulateContract({
      address: V4_AUTO_RANGE,
      abi: V4AutoRangeAbi,
      functionName: 'executeRebalance',
      args: [tokenId, '0x'],
      account
    });

    console.log('Simulation passed! Sending transaction...');
    const hash = await walletClient.writeContract(request);
    console.log(`Transaction hash: ${hash}`);

    console.log('Waiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Status: ${receipt.status}`);

    return { success: receipt.status === 'success', hash };
  } catch (error) {
    console.error('Rebalance failed:', error.message);
    if (error.cause?.data) {
      console.error('Error data:', error.cause.data);
    }
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Auto-Range Bot Test');
  console.log('='.repeat(60));

  // Check contract version
  const version = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'VERSION'
  });
  console.log(`\nContract version: ${version}`);
  console.log(`Bot wallet: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Bot balance: ${(Number(balance) / 1e18).toFixed(6)} ETH`);

  // Find latest position in chain starting from 21386
  console.log('\n--- Position Chain ---');
  const { latestTokenId, chain } = await getLatestPosition(21386);
  console.log(`Position chain: ${chain.map(t => t.toString()).join(' -> ')}`);
  console.log(`Latest position: ${latestTokenId}`);

  // Check the latest position
  console.log('\n--- Position Status ---');
  const status = await checkPositionStatus(latestTokenId);
  console.log(`In range: ${status.inRange}`);
  console.log(`Current tick: ${status.currentTick}`);
  console.log(`Position range: ${status.tickLower} to ${status.tickUpper}`);

  if (!status.inRange) {
    if (status.currentTick < status.tickLower) {
      console.log(`Below range by ${status.tickLower - status.currentTick} ticks`);
    } else {
      console.log(`Above range by ${status.currentTick - status.tickUpper} ticks`);
    }
  }

  // Check config
  console.log('\n--- Range Config ---');
  const config = await getConfig(latestTokenId);
  console.log(`Enabled: ${config.enabled}`);
  console.log(`Lower delta: ${config.lowerDelta}`);
  console.log(`Upper delta: ${config.upperDelta}`);
  console.log(`Rebalance threshold: ${config.rebalanceThreshold}`);
  console.log(`Min interval: ${config.minRebalanceInterval}s`);

  if (!config.enabled) {
    console.log('\n*** Config not enabled - cannot rebalance ***');
    return;
  }

  // Check cooldown
  console.log('\n--- Cooldown Status ---');
  const cooldown = await checkCooldown(latestTokenId, config.minRebalanceInterval);
  console.log(`Last rebalance: ${cooldown.lastRebalance.toISOString()}`);
  console.log(`Cooldown ends: ${cooldown.cooldownEnds.toISOString()}`);
  console.log(`Remaining: ${cooldown.remainingSeconds} seconds (${Math.ceil(cooldown.remainingSeconds / 60)} minutes)`);
  console.log(`Can rebalance: ${cooldown.canRebalance}`);

  // Check rebalance condition
  console.log('\n--- Rebalance Check ---');
  const rebalanceCheck = await checkRebalance(latestTokenId);
  console.log(`Needs rebalance: ${rebalanceCheck.needsRebalance}`);
  console.log(`Reason: ${rebalanceCheck.reason} (${rebalanceCheck.reasonText})`);

  // Decision
  console.log('\n--- Bot Decision ---');
  if (!config.enabled) {
    console.log('SKIP: Config not enabled');
  } else if (!cooldown.canRebalance) {
    console.log(`SKIP: Cooldown active (${Math.ceil(cooldown.remainingSeconds / 60)} minutes remaining)`);
  } else if (!rebalanceCheck.needsRebalance) {
    console.log('SKIP: Rebalance not needed (position in range or other condition)');
  } else {
    console.log('EXECUTE: All conditions met, executing rebalance...');

    const result = await executeRebalance(latestTokenId);

    if (result.success) {
      console.log('\n--- Post-Rebalance Check ---');

      // Wait a moment for state to update
      await new Promise(r => setTimeout(r, 2000));

      // Find the new position
      const { latestTokenId: newTokenId, chain: newChain } = await getLatestPosition(21386);
      console.log(`New position chain: ${newChain.map(t => t.toString()).join(' -> ')}`);

      // Check new position status
      const newStatus = await checkPositionStatus(newTokenId);
      console.log(`\nNew position ${newTokenId}:`);
      console.log(`  In range: ${newStatus.inRange}`);
      console.log(`  Current tick: ${newStatus.currentTick}`);
      console.log(`  Position range: ${newStatus.tickLower} to ${newStatus.tickUpper}`);

      if (newStatus.inRange) {
        console.log('\n*** SUCCESS: New position is IN RANGE! ***');
      } else {
        console.log('\n*** WARNING: New position is still OUT OF RANGE ***');
        if (newStatus.currentTick < newStatus.tickLower) {
          console.log(`  Below by ${newStatus.tickLower - newStatus.currentTick} ticks`);
        } else {
          console.log(`  Above by ${newStatus.currentTick - newStatus.tickUpper} ticks`);
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
