import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useChainId } from 'wagmi';
import { getContracts } from '@/config/contracts';
import V4CompoundorAbi from '@/abis/V4Compoundor.json';

export interface CompoundConfig {
  enabled: boolean;
  minCompoundInterval: number; // uint32
  minRewardAmount: bigint;
}

export function useV4Compoundor() {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  /**
   * Register a position for auto-compounding
   */
  const registerPosition = async (params: {
    tokenId: bigint;
    config: CompoundConfig;
  }) => {
    const configStruct = {
      enabled: params.config.enabled,
      minCompoundInterval: params.config.minCompoundInterval,
      minRewardAmount: params.config.minRewardAmount,
    };

    return writeContract({
      chainId,
      address: CONTRACTS.V4_COMPOUNDOR,
      abi: V4CompoundorAbi,
      functionName: 'registerPosition',
      args: [params.tokenId, configStruct],
      gas: 500000n,
    });
  };

  /**
   * Update compound config for a position
   */
  const updateConfig = async (params: {
    tokenId: bigint;
    config: CompoundConfig;
  }) => {
    const configStruct = {
      enabled: params.config.enabled,
      minCompoundInterval: params.config.minCompoundInterval,
      minRewardAmount: params.config.minRewardAmount,
    };

    return writeContract({
      chainId,
      address: CONTRACTS.V4_COMPOUNDOR,
      abi: V4CompoundorAbi,
      functionName: 'updateConfig',
      args: [params.tokenId, configStruct],
      gas: 300000n,
    });
  };

  /**
   * Unregister a position from auto-compounding
   */
  const unregisterPosition = async (tokenId: bigint) => {
    return writeContract({
      chainId,
      address: CONTRACTS.V4_COMPOUNDOR,
      abi: V4CompoundorAbi,
      functionName: 'unregisterPosition',
      args: [tokenId],
      gas: 300000n,
    });
  };

  /**
   * Execute auto-compound on a registered position (called by bots/keepers)
   */
  const autoCompound = async (tokenId: bigint) => {
    return writeContract({
      chainId,
      address: CONTRACTS.V4_COMPOUNDOR,
      abi: V4CompoundorAbi,
      functionName: 'autoCompound',
      args: [tokenId, '0x'], // No swap data
      gas: 4000000n,
    });
  };

  /**
   * Compound your own position (as position owner)
   */
  const selfCompound = async (tokenId: bigint) => {
    return writeContract({
      chainId,
      address: CONTRACTS.V4_COMPOUNDOR,
      abi: V4CompoundorAbi,
      functionName: 'selfCompound',
      args: [tokenId, '0x'], // No swap data
      gas: 4000000n,
    });
  };

  return {
    registerPosition,
    updateConfig,
    unregisterPosition,
    autoCompound,
    selfCompound,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    reset,
  };
}

/**
 * Hook to read compound config for a position
 */
export function useCompoundConfig(tokenId: bigint | undefined) {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  return useReadContract({
    address: CONTRACTS.V4_COMPOUNDOR,
    abi: V4CompoundorAbi,
    functionName: 'getConfig',
    args: tokenId ? [tokenId] : undefined,
    query: {
      enabled: !!tokenId,
    },
  });
}

/**
 * Hook to read pending fees for a position
 */
export function usePendingFees(tokenId: bigint | undefined) {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  return useReadContract({
    address: CONTRACTS.V4_COMPOUNDOR,
    abi: V4CompoundorAbi,
    functionName: 'getPendingFees',
    args: tokenId ? [tokenId] : undefined,
    query: {
      enabled: !!tokenId,
    },
  });
}

/**
 * Hook to check if compound is profitable
 */
export function useIsCompoundProfitable(tokenId: bigint | undefined) {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  return useReadContract({
    address: CONTRACTS.V4_COMPOUNDOR,
    abi: V4CompoundorAbi,
    functionName: 'isCompoundProfitable',
    args: tokenId ? [tokenId] : undefined,
    query: {
      enabled: !!tokenId,
    },
  });
}
