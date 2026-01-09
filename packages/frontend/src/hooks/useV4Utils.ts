import { useWriteContract, useWaitForTransactionReceipt, useChainId, usePublicClient } from 'wagmi';
import { getContracts } from '@/config/contracts';
import V4UtilsAbi from '@/abis/V4Utils.json';

// Default slippage tolerance in basis points (0.5% = 50 bps)
export const DEFAULT_SLIPPAGE_BPS = 50n;

// Calculate minimum amount with slippage protection
export function applySlippage(amount: bigint, slippageBps: bigint = DEFAULT_SLIPPAGE_BPS): bigint {
  if (amount === 0n) return 0n;
  return (amount * (10000n - slippageBps)) / 10000n;
}

// Calculate expected output with slippage (for UI display)
export function calculateMinimumOutput(expectedAmount: bigint, slippageBps: bigint = DEFAULT_SLIPPAGE_BPS): bigint {
  return applySlippage(expectedAmount, slippageBps);
}

// Validate input amount is positive and not zero
export function validateAmount(amount: string, decimals: number): { valid: boolean; parsed: bigint; error?: string } {
  if (!amount || amount.trim() === '') {
    return { valid: false, parsed: 0n, error: 'Amount is required' };
  }

  const parsed = parseFloat(amount);
  if (isNaN(parsed)) {
    return { valid: false, parsed: 0n, error: 'Invalid number format' };
  }

  if (parsed <= 0) {
    return { valid: false, parsed: 0n, error: 'Amount must be greater than 0' };
  }

  if (parsed > Number.MAX_SAFE_INTEGER) {
    return { valid: false, parsed: 0n, error: 'Amount is too large' };
  }

  try {
    // Use viem parseUnits for proper BigInt conversion
    const { parseUnits } = require('viem');
    const parsedBigInt = parseUnits(amount, decimals);
    return { valid: true, parsed: parsedBigInt };
  } catch {
    return { valid: false, parsed: 0n, error: 'Failed to parse amount' };
  }
}

// Gas estimation multiplier (120% of estimated gas)
const GAS_BUFFER_MULTIPLIER = 120n;

export function useV4Utils() {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const publicClient = usePublicClient({ chainId });
  const { writeContract, data: hash, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  /**
   * Mint a new position using swapAndMint
   */
  const mintPosition = async (params: {
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickLower: number;
    tickUpper: number;
    amount0Desired: bigint;
    amount1Desired: bigint;
    amount0Max: bigint;
    amount1Max: bigint;
    recipient: `0x${string}`;
    deadline: bigint;
  }) => {
    // PoolKey struct
    const poolKey = {
      currency0: params.currency0,
      currency1: params.currency1,
      fee: params.fee,
      tickSpacing: params.fee === 500 ? 10 : params.fee === 3000 ? 60 : 200, // Standard tick spacings
      hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`, // No hooks
    };

    // SwapAndMintParams struct
    const swapAndMintParams = {
      poolKey,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      amount0Desired: params.amount0Desired,
      amount1Desired: params.amount1Desired,
      amount0Max: params.amount0Max,
      amount1Max: params.amount1Max,
      recipient: params.recipient,
      deadline: params.deadline,
      swapSourceCurrency: '0x0000000000000000000000000000000000000000' as `0x${string}`, // No swap
      swapSourceAmount: 0n,
      swapData: '0x' as `0x${string}`,
      maxSwapSlippage: 0n,
    };

    // Calculate ETH value to send if either currency is native ETH (address 0x0)
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const currency0IsNative = params.currency0.toLowerCase() === ZERO_ADDRESS;
    const currency1IsNative = params.currency1.toLowerCase() === ZERO_ADDRESS;

    let ethValue = 0n;
    if (currency0IsNative) {
      ethValue = params.amount0Max; // Use max amount for ETH to ensure enough is sent
    } else if (currency1IsNative) {
      ethValue = params.amount1Max;
    }

    // Estimate gas dynamically with buffer
    let gasLimit = 5000000n; // Fallback gas limit
    try {
      if (publicClient) {
        console.log('[V4Utils] Estimating gas for swapAndMint...');
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'swapAndMint',
          args: [swapAndMintParams],
          value: ethValue,
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
        console.log('[V4Utils] Gas estimated:', estimated.toString(), '-> with buffer:', gasLimit.toString());
      }
    } catch (gasError) {
      // Log gas estimation error but continue with fallback
      console.warn('[V4Utils] Gas estimation failed, using fallback:', gasError);
    }

    console.log('[V4Utils] Calling writeContract for swapAndMint...');
    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'swapAndMint',
      args: [swapAndMintParams],
      value: ethValue,
      gas: gasLimit,
    });
  };

  /**
   * Increase liquidity using swapAndIncreaseLiquidity
   * This function adds more liquidity to an existing position
   */
  const increaseLiquidity = async (params: {
    tokenId: bigint;
    amount0Desired: bigint;
    amount1Desired: bigint;
    amount0Max: bigint;
    amount1Max: bigint;
    deadline: bigint;
    currency0?: `0x${string}`; // Optional: provide if pool has native ETH
    currency1?: `0x${string}`; // Optional: provide if pool has native ETH
  }) => {
    // SwapAndIncreaseParams struct
    const swapAndIncreaseParams = {
      tokenId: params.tokenId,
      amount0Desired: params.amount0Desired,
      amount1Desired: params.amount1Desired,
      amount0Max: params.amount0Max,
      amount1Max: params.amount1Max,
      deadline: params.deadline,
      swapSourceCurrency: '0x0000000000000000000000000000000000000000' as `0x${string}`, // No swap
      swapSourceAmount: 0n,
      swapData: '0x' as `0x${string}`,
      maxSwapSlippage: 0n,
    };

    // Calculate ETH value to send if either currency is native ETH (address 0x0)
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const currency0IsNative = params.currency0?.toLowerCase() === ZERO_ADDRESS;
    const currency1IsNative = params.currency1?.toLowerCase() === ZERO_ADDRESS;

    let ethValue = 0n;
    if (currency0IsNative) {
      ethValue = params.amount0Max; // Use max amount for ETH
    } else if (currency1IsNative) {
      ethValue = params.amount1Max;
    }

    // Estimate gas dynamically with buffer
    let gasLimit = 4000000n; // Fallback gas limit
    try {
      if (publicClient) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'swapAndIncreaseLiquidity',
          args: [swapAndIncreaseParams],
          value: ethValue,
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit if estimation fails
    }

    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'swapAndIncreaseLiquidity',
      args: [swapAndIncreaseParams],
      value: ethValue,
      gas: gasLimit,
    });
  };

  /**
   * Decrease liquidity and swap to a single token using decreaseAndSwap
   * Use this when you want all tokens converted to one currency
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   */
  const decreaseAndSwap = async (params: {
    tokenId: bigint;
    liquidity: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    deadline: bigint;
    targetCurrency: `0x${string}`;
    slippageBps?: bigint;
  }) => {
    const decreaseAndSwapParams = {
      tokenId: params.tokenId,
      liquidity: params.liquidity,
      amount0Min: applySlippage(params.amount0Min, params.slippageBps),
      amount1Min: applySlippage(params.amount1Min, params.slippageBps),
      deadline: params.deadline,
      targetCurrency: params.targetCurrency,
      swapData: '0x' as `0x${string}`,
      maxSwapSlippage: params.slippageBps || DEFAULT_SLIPPAGE_BPS,
    };

    // Estimate gas dynamically
    let gasLimit = 4000000n;
    try {
      if (publicClient) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'decreaseAndSwap',
          args: [decreaseAndSwapParams],
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit
    }

    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'decreaseAndSwap',
      args: [decreaseAndSwapParams],
      gas: gasLimit,
    });
  };

  /**
   * Decrease liquidity and receive BOTH tokens (no swap)
   * Use this when you want to receive both tokens from your position
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   */
  const decreaseLiquidity = async (params: {
    tokenId: bigint;
    liquidity: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    deadline: bigint;
    slippageBps?: bigint;
  }) => {
    const decreaseLiquidityParams = {
      tokenId: params.tokenId,
      liquidity: params.liquidity,
      amount0Min: applySlippage(params.amount0Min, params.slippageBps),
      amount1Min: applySlippage(params.amount1Min, params.slippageBps),
      deadline: params.deadline,
    };

    // Estimate gas dynamically
    let gasLimit = 4000000n;
    try {
      if (publicClient) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'decreaseLiquidity',
          args: [decreaseLiquidityParams],
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit
    }

    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'decreaseLiquidity',
      args: [decreaseLiquidityParams],
      gas: gasLimit,
    });
  };

  /**
   * Exit position to a stablecoin (USDC, USDT, or DAI)
   * Removes all liquidity and swaps both tokens to the target stablecoin
   * @param slippageBps - Slippage tolerance in basis points (default: 100 = 1%)
   */
  const exitToStablecoin = async (params: {
    tokenId: bigint;
    liquidity: bigint;
    targetStablecoin: `0x${string}`;
    minAmountOut: bigint;
    deadline: bigint;
    swapData0?: `0x${string}`;
    swapData1?: `0x${string}`;
    slippageBps?: bigint;
  }) => {
    const slippage = params.slippageBps || 100n; // Default 1% for stablecoin exits
    const exitParams = {
      tokenId: params.tokenId,
      liquidity: params.liquidity,
      targetStablecoin: params.targetStablecoin,
      minAmountOut: applySlippage(params.minAmountOut, slippage),
      deadline: params.deadline,
      swapData0: params.swapData0 || '0x' as `0x${string}`,
      swapData1: params.swapData1 || '0x' as `0x${string}`,
      maxSwapSlippage: slippage,
    };

    // Estimate gas dynamically
    let gasLimit = 5000000n;
    try {
      if (publicClient) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'exitToStablecoin',
          args: [exitParams],
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit
    }

    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'exitToStablecoin',
      args: [exitParams],
      gas: gasLimit,
    });
  };

  /**
   * Collect fees from a position and receive BOTH tokens (no swap)
   */
  const collectFees = async (params: {
    tokenId: bigint;
    deadline: bigint;
  }) => {
    const collectFeesParams = {
      tokenId: params.tokenId,
      deadline: params.deadline,
    };

    // Estimate gas dynamically
    let gasLimit = 3000000n;
    try {
      if (publicClient) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'collectFees',
          args: [collectFeesParams],
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit
    }

    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'collectFees',
      args: [collectFeesParams],
      gas: gasLimit,
    });
  };

  /**
   * Collect fees from a position and swap to a single target token
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   */
  const collectAndSwapFees = async (params: {
    tokenId: bigint;
    targetCurrency: `0x${string}`;
    deadline: bigint;
    slippageBps?: bigint;
  }) => {
    const collectAndSwapParams = {
      tokenId: params.tokenId,
      targetCurrency: params.targetCurrency,
      swapData: '0x' as `0x${string}`,
      maxSwapSlippage: params.slippageBps || DEFAULT_SLIPPAGE_BPS,
      deadline: params.deadline,
    };

    // Estimate gas dynamically
    let gasLimit = 3000000n;
    try {
      if (publicClient) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'collectAndSwap',
          args: [collectAndSwapParams],
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit
    }

    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'collectAndSwap',
      args: [collectAndSwapParams],
      gas: gasLimit,
    });
  };

  /**
   * Move a position to a new tick range
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   */
  const moveRange = async (params: {
    tokenId: bigint;
    newTickLower: number;
    newTickUpper: number;
    liquidityToMove: bigint;
    amount0Max: bigint;
    amount1Max: bigint;
    deadline: bigint;
    slippageBps?: bigint;
  }) => {
    const moveRangeParams = {
      tokenId: params.tokenId,
      newTickLower: params.newTickLower,
      newTickUpper: params.newTickUpper,
      liquidityToMove: params.liquidityToMove,
      amount0Max: params.amount0Max,
      amount1Max: params.amount1Max,
      deadline: params.deadline,
      swapData: '0x' as `0x${string}`,
      maxSwapSlippage: params.slippageBps || DEFAULT_SLIPPAGE_BPS,
    };

    // Estimate gas dynamically
    let gasLimit = 5000000n;
    try {
      if (publicClient) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'moveRange',
          args: [moveRangeParams],
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit
    }

    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'moveRange',
      args: [moveRangeParams],
      gas: gasLimit,
    });
  };

  /**
   * Sweep stuck tokens from the V4Utils contract to a recipient
   */
  const sweepToken = async (params: {
    currency: `0x${string}`;
    minAmount: bigint;
    recipient: `0x${string}`;
  }) => {
    // Estimate gas dynamically
    let gasLimit = 500000n;
    try {
      if (publicClient) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'sweepToken',
          args: [params.currency, params.minAmount, params.recipient],
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit
    }

    return writeContract({
      chainId,
      address: CONTRACTS.V4_UTILS,
      abi: V4UtilsAbi,
      functionName: 'sweepToken',
      args: [params.currency, params.minAmount, params.recipient],
      gas: gasLimit,
    });
  };

  return {
    mintPosition,
    increaseLiquidity,
    decreaseLiquidity,
    decreaseAndSwap,
    exitToStablecoin,
    collectFees,
    collectAndSwapFees,
    moveRange,
    sweepToken,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}
