const { createPublicClient, createWalletClient, http } = require('viem');
const { sepolia } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');

const V4_AUTO_RANGE = '0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD';
const TOKEN_ID = 21386n;

const V4AutoRangeAbi = [
  {
    name: 'executeRebalance',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'swapData', type: 'bytes' }
    ],
    outputs: [{
      name: 'result',
      type: 'tuple',
      components: [
        { name: 'newTokenId', type: 'uint256' },
        { name: 'newTickLower', type: 'int24' },
        { name: 'newTickUpper', type: 'int24' },
        { name: 'liquidity', type: 'uint128' },
        { name: 'fee0', type: 'uint256' },
        { name: 'fee1', type: 'uint256' }
      ]
    }]
  },
  {
    name: 'checkRebalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'needsRebalance', type: 'bool' },
      { name: 'reason', type: 'uint8' }
    ]
  },
  {
    name: 'getPositionStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'inRange', type: 'bool' },
      { name: 'currentTick', type: 'int24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' }
    ]
  },
  {
    name: 'calculateOptimalRange',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' }
    ]
  },
  {
    name: 'VERSION',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }]
  }
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

async function main() {
  console.log('Testing V4AutoRange rebalance...\n');
  console.log('Bot wallet:', account.address);

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('Bot balance:', (Number(balance) / 1e18).toFixed(6), 'ETH');

  // Check contract version
  try {
    const version = await publicClient.readContract({
      address: V4_AUTO_RANGE,
      abi: V4AutoRangeAbi,
      functionName: 'VERSION'
    });
    console.log(`Contract version: ${version}`);

    if (version !== '1.1.0') {
      console.log('\n⚠️  Contract needs upgrade to v1.1.0 for internal swap support');
      console.log('The current deployed contract does not have auto-swap functionality.');
      console.log('Please deploy the upgraded contract first.');
    }
  } catch (e) {
    console.log('Could not get version (may be old contract)');
  }

  // Get position status
  console.log(`\nGetting position status for token ${TOKEN_ID}...`);
  const [inRange, currentTick, tickLower, tickUpper] = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'getPositionStatus',
    args: [TOKEN_ID]
  });
  console.log(`In range: ${inRange}`);
  console.log(`Current tick: ${currentTick}`);
  console.log(`Position range: ${tickLower} to ${tickUpper}`);

  // Get optimal new range
  const [newTickLower, newTickUpper] = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'calculateOptimalRange',
    args: [TOKEN_ID]
  });
  console.log(`New optimal range: ${newTickLower} to ${newTickUpper}`);

  // Check if new range spans current tick
  const newRangeSpansCurrentTick = currentTick >= newTickLower && currentTick < newTickUpper;
  console.log(`New range spans current tick: ${newRangeSpansCurrentTick}`);
  if (newRangeSpansCurrentTick) {
    console.log('  -> Position will need both tokens - internal swap should be triggered');
  }

  // Check if rebalance is needed
  console.log(`\nChecking rebalance for token ${TOKEN_ID}...`);
  const [needsRebalance, reason] = await publicClient.readContract({
    address: V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'checkRebalance',
    args: [TOKEN_ID]
  });

  console.log(`Needs rebalance: ${needsRebalance}, reason: ${reason} (1=below range, 2=above range)`);

  if (!needsRebalance) {
    console.log('No rebalance needed');
    return;
  }

  // Execute rebalance with empty swap data (contract should handle internal swap)
  console.log('\nExecuting rebalance with empty swap data (contract will auto-swap)...');
  try {
    const { request } = await publicClient.simulateContract({
      address: V4_AUTO_RANGE,
      abi: V4AutoRangeAbi,
      functionName: 'executeRebalance',
      args: [TOKEN_ID, '0x'],
      account: account
    });

    console.log('Simulation passed! Sending transaction...');
    const hash = await walletClient.writeContract(request);
    console.log(`Transaction hash: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Transaction status: ${receipt.status}`);

    if (receipt.status === 'success') {
      console.log('\n✅ Rebalance succeeded!');
    }
  } catch (error) {
    console.error('\n❌ Rebalance failed:', error.message);
    if (error.cause?.data) {
      console.error('Error data:', error.cause.data);
    }

    // Decode common error signatures
    const errorData = error.cause?.data || error.data;
    const errorSig = errorData?.slice(0, 10);
    if (errorSig === '0xaefeb924') {
      console.error('\nError: CannotUpdateEmptyPosition');
      console.error('This means the new liquidity calculated to 0.');
      console.error('The contract needs to be upgraded to v1.1.0 for internal swap support.');
    } else if (errorSig) {
      console.error(`\nError signature: ${errorSig}`);
    }
  }
}

main().catch(console.error);
