import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useChainId } from 'wagmi';
import { getContracts } from '@/config/contracts';
import V4AutoRangeAbi from '@/abis/V4AutoRange.json';

export interface RangeConfig {
  enabled: boolean;
  lowerDelta: number; // int24 - Tick delta below current tick for new range
  upperDelta: number; // int24 - Tick delta above current tick for new range
  rebalanceThreshold: number; // uint32 - How many ticks out of range before rebalancing
  minRebalanceInterval: number; // uint32 - Minimum time between rebalances
  collectFeesOnRebalance: boolean;
  maxSwapSlippage: bigint;
}

export function useV4AutoRange() {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  /**
   * Configure auto-range for a position
   */
  const configureRange = async (params: {
    tokenId: bigint;
    config: RangeConfig;
  }) => {
    const configStruct = {
      enabled: params.config.enabled,
      lowerDelta: params.config.lowerDelta,
      upperDelta: params.config.upperDelta,
      rebalanceThreshold: params.config.rebalanceThreshold,
      minRebalanceInterval: params.config.minRebalanceInterval,
      collectFeesOnRebalance: params.config.collectFeesOnRebalance,
      maxSwapSlippage: params.config.maxSwapSlippage,
    };

    return writeContract({
      chainId,
      address: CONTRACTS.V4_AUTO_RANGE,
      abi: V4AutoRangeAbi,
      functionName: 'configureRange',
      args: [params.tokenId, configStruct],
      gas: 500000n,
    });
  };

  /**
   * Update range config for a position
   */
  const updateRangeConfig = async (params: {
    tokenId: bigint;
    config: RangeConfig;
  }) => {
    const configStruct = {
      enabled: params.config.enabled,
      lowerDelta: params.config.lowerDelta,
      upperDelta: params.config.upperDelta,
      rebalanceThreshold: params.config.rebalanceThreshold,
      minRebalanceInterval: params.config.minRebalanceInterval,
      collectFeesOnRebalance: params.config.collectFeesOnRebalance,
      maxSwapSlippage: params.config.maxSwapSlippage,
    };

    return writeContract({
      chainId,
      address: CONTRACTS.V4_AUTO_RANGE,
      abi: V4AutoRangeAbi,
      functionName: 'updateRangeConfig',
      args: [params.tokenId, configStruct],
      gas: 300000n,
    });
  };

  /**
   * Remove auto-range configuration from a position
   */
  const removeRange = async (tokenId: bigint) => {
    return writeContract({
      chainId,
      address: CONTRACTS.V4_AUTO_RANGE,
      abi: V4AutoRangeAbi,
      functionName: 'removeRange',
      args: [tokenId],
      gas: 300000n,
    });
  };

  /**
   * Execute rebalance on a position (called by bots/keepers or self)
   */
  const executeRebalance = async (tokenId: bigint) => {
    return writeContract({
      chainId,
      address: CONTRACTS.V4_AUTO_RANGE,
      abi: V4AutoRangeAbi,
      functionName: 'executeRebalance',
      args: [tokenId, '0x'], // No swap data
      gas: 5000000n,
    });
  };

  return {
    configureRange,
    updateRangeConfig,
    removeRange,
    executeRebalance,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

/**
 * Hook to read range config for a position
 */
export function useRangeConfig(tokenId: bigint | undefined) {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  return useReadContract({
    address: CONTRACTS.V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'getRangeConfig',
    args: tokenId ? [tokenId] : undefined,
    query: {
      enabled: !!tokenId,
    },
  });
}

/**
 * Hook to check if position needs rebalance
 */
export function useCheckRebalance(tokenId: bigint | undefined) {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  return useReadContract({
    address: CONTRACTS.V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'checkRebalance',
    args: tokenId ? [tokenId] : undefined,
    query: {
      enabled: !!tokenId,
    },
  });
}

/**
 * Hook to get position status (in range, current tick, etc)
 */
export function usePositionStatus(tokenId: bigint | undefined) {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  return useReadContract({
    address: CONTRACTS.V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'getPositionStatus',
    args: tokenId ? [tokenId] : undefined,
    query: {
      enabled: !!tokenId,
    },
  });
}

/**
 * Hook to calculate optimal range for a position
 */
export function useCalculateOptimalRange(tokenId: bigint | undefined) {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  return useReadContract({
    address: CONTRACTS.V4_AUTO_RANGE,
    abi: V4AutoRangeAbi,
    functionName: 'calculateOptimalRange',
    args: tokenId ? [tokenId] : undefined,
    query: {
      enabled: !!tokenId,
    },
  });
}
