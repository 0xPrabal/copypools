const { createPublicClient, createWalletClient, http, parseAbiItem } = require('viem');
const { sepolia } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const V4_AUTO_RANGE = '0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD';
const PRIVATE_KEY = '0xdfdf5d6fd6159c3c544119ddeaf5d675f3e365241f1e3f2c63b552cd1d659fd2';

const abi = [
  { name: 'VERSION', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'rangeConfigs', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'enabled', type: 'bool' }, { name: 'lowerDelta', type: 'int24' }, { name: 'upperDelta', type: 'int24' }, { name: 'rebalanceThreshold', type: 'uint24' }, { name: 'minRebalanceInterval', type: 'uint32' }, { name: 'collectFeesOnRebalance', type: 'bool' }, { name: 'maxSwapSlippage', type: 'uint256' }] },
  { name: 'getPositionStatus', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'inRange', type: 'bool' }, { name: 'currentTick', type: 'int24' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }] },
  { name: 'checkRebalance', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'needsRebalance', type: 'bool' }, { name: 'reason', type: 'uint8' }] },
  { name: 'lastRebalanceTime', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'rebalancedTo', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { name: 'executeRebalance', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'swapData', type: 'bytes' }], outputs: [{ name: 'result', type: 'tuple', components: [{ name: 'newTokenId', type: 'uint256' }, { name: 'newTickLower', type: 'int24' }, { name: 'newTickUpper', type: 'int24' }, { name: 'liquidity', type: 'uint128' }, { name: 'fee0', type: 'uint256' }, { name: 'fee1', type: 'uint256' }] }] }
];

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

// Known positions with auto-range enabled
const KNOWN_POSITIONS = ['21363', '21367', '21386', '21394', '21399'];

async function checkPosition(tokenId) {
  const tokenIdBigInt = BigInt(tokenId);

  // Get config
  const config = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'rangeConfigs',
    args: [tokenIdBigInt]
  });

  if (!config[0]) {
    return { tokenId, enabled: false };
  }

  // Get position status
  const [inRange, currentTick, tickLower, tickUpper] = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'getPositionStatus',
    args: [tokenIdBigInt]
  });

  // Check rebalance
  const [needsRebalance, reason] = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'checkRebalance',
    args: [tokenIdBigInt]
  });

  // Check if already rebalanced
  const rebalancedTo = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'rebalancedTo',
    args: [tokenIdBigInt]
  });

  // Check cooldown
  const lastRebalance = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'lastRebalanceTime',
    args: [tokenIdBigInt]
  });

  const now = Math.floor(Date.now() / 1000);
  const minInterval = Number(config[4]) || 3600;
  const cooldownRemaining = Math.max(0, Number(lastRebalance) + minInterval - now);

  return {
    tokenId,
    enabled: true,
    inRange,
    currentTick,
    tickLower,
    tickUpper,
    needsRebalance,
    reason,
    rebalancedTo: rebalancedTo.toString(),
    cooldownRemaining,
    shouldRebalance: needsRebalance && rebalancedTo === 0n && cooldownRemaining === 0
  };
}

async function executeRebalance(tokenId) {
  console.log(`\nExecuting rebalance for #${tokenId}...`);

  try {
    const { request } = await publicClient.simulateContract({
      address: V4_AUTO_RANGE,
      abi,
      functionName: 'executeRebalance',
      args: [BigInt(tokenId), '0x'],
      account
    });

    console.log('Simulation passed! Sending tx...');
    const hash = await walletClient.writeContract(request);
    console.log(`Tx: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Status: ${receipt.status}`);

    return { success: receipt.status === 'success', hash };
  } catch (e) {
    console.error(`Failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('  AUTO-RANGE BOT FULL TEST');
  console.log('='.repeat(70));

  // Check version
  const version = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi,
    functionName: 'VERSION'
  });
  console.log(`\nContract: ${V4_AUTO_RANGE}`);
  console.log(`Version: ${version}`);
  console.log(`Bot wallet: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${(Number(balance) / 1e18).toFixed(6)} ETH`);

  // Check all known positions
  console.log('\n' + '='.repeat(70));
  console.log('  SCANNING POSITIONS');
  console.log('='.repeat(70));

  const positions = [];
  const toRebalance = [];

  for (const tokenId of KNOWN_POSITIONS) {
    const pos = await checkPosition(tokenId);
    positions.push(pos);

    if (!pos.enabled) {
      console.log(`\n#${tokenId}: [disabled]`);
      continue;
    }

    const status = pos.inRange ? 'IN RANGE' : 'OUT OF RANGE';
    console.log(`\n#${tokenId}: ${status}`);
    console.log(`  Tick: ${pos.currentTick}, Range: ${pos.tickLower} to ${pos.tickUpper}`);

    if (!pos.inRange) {
      const diff = pos.currentTick < pos.tickLower
        ? `Below by ${pos.tickLower - pos.currentTick} ticks`
        : `Above by ${pos.currentTick - pos.tickUpper} ticks`;
      console.log(`  ${diff}`);
    }

    console.log(`  needsRebalance: ${pos.needsRebalance}, reason: ${pos.reason}`);
    console.log(`  rebalancedTo: ${pos.rebalancedTo}`);
    console.log(`  cooldown: ${pos.cooldownRemaining > 0 ? pos.cooldownRemaining + 's remaining' : 'ready'}`);

    if (pos.shouldRebalance) {
      console.log(`  -> *** SHOULD REBALANCE NOW ***`);
      toRebalance.push(pos);
    } else if (pos.rebalancedTo !== '0') {
      console.log(`  -> Skipped: Already rebalanced to #${pos.rebalancedTo}`);
    } else if (pos.cooldownRemaining > 0) {
      console.log(`  -> Skipped: Cooldown (${Math.ceil(pos.cooldownRemaining/60)} min)`);
    } else if (pos.inRange) {
      console.log(`  -> Skipped: In range`);
    } else if (!pos.needsRebalance) {
      console.log(`  -> Skipped: checkRebalance=false (below threshold?)`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  SUMMARY');
  console.log('='.repeat(70));

  const enabled = positions.filter(p => p.enabled);
  const outOfRange = enabled.filter(p => !p.inRange);

  console.log(`\nTotal positions checked: ${KNOWN_POSITIONS.length}`);
  console.log(`Enabled for auto-range: ${enabled.length}`);
  console.log(`Currently out of range: ${outOfRange.length}`);
  console.log(`Ready to rebalance NOW: ${toRebalance.length}`);

  // Execute rebalances
  if (toRebalance.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('  EXECUTING REBALANCES');
    console.log('='.repeat(70));

    for (const pos of toRebalance) {
      const result = await executeRebalance(pos.tokenId);

      if (result.success) {
        // Verify new position is in range
        await new Promise(r => setTimeout(r, 2000));

        // Find new position
        const newRebalancedTo = await publicClient.readContract({
          address: V4_AUTO_RANGE,
          abi,
          functionName: 'rebalancedTo',
          args: [BigInt(pos.tokenId)]
        });

        if (newRebalancedTo > 0n) {
          const newPos = await checkPosition(newRebalancedTo.toString());
          console.log(`\nNew position #${newRebalancedTo}:`);
          console.log(`  In range: ${newPos.inRange}`);
          console.log(`  Range: ${newPos.tickLower} to ${newPos.tickUpper}`);
          console.log(`  Current tick: ${newPos.currentTick}`);

          if (newPos.inRange) {
            console.log(`  *** SUCCESS: Position is now IN RANGE ***`);
          } else {
            console.log(`  *** WARNING: Position still OUT OF RANGE ***`);
          }
        }
      }
    }
  } else {
    console.log('\nNo positions need rebalancing right now.');
  }

  console.log('\n' + '='.repeat(70));
}

main().catch(console.error);
