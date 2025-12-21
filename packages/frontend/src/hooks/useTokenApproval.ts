import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useChainId, usePublicClient } from 'wagmi';
import ERC20Abi from '@/abis/ERC20.json';

// Gas estimation multiplier (120% of estimated gas)
const GAS_BUFFER_MULTIPLIER = 120n;

export function useTokenApproval(tokenAddress: `0x${string}` | undefined, spenderAddress: `0x${string}`) {
  const { address: userAddress } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const { writeContract, data: hash, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // Check if token is native ETH (no approval needed)
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const isNativeToken = !tokenAddress || tokenAddress.toLowerCase() === ZERO_ADDRESS;

  // Check current allowance (skip for native ETH)
  const { data: allowance, refetch } = useReadContract({
    address: tokenAddress,
    abi: ERC20Abi,
    functionName: 'allowance',
    args: tokenAddress && userAddress ? [userAddress, spenderAddress] : undefined,
    query: {
      enabled: !isNativeToken && !!tokenAddress && !!userAddress,
    },
  });

  const approve = async (amount: bigint) => {
    // Native ETH doesn't need approval
    if (isNativeToken) {
      return; // No-op for native ETH
    }

    if (!tokenAddress) {
      throw new Error('Token address not provided');
    }

    // Estimate gas dynamically with fallback
    let gasLimit = 100000n; // Fallback gas limit
    try {
      if (publicClient && userAddress) {
        const estimated = await publicClient.estimateContractGas({
          address: tokenAddress,
          abi: ERC20Abi,
          functionName: 'approve',
          args: [spenderAddress, amount],
          account: userAddress,
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit if estimation fails
    }

    return writeContract({
      chainId,
      address: tokenAddress,
      abi: ERC20Abi,
      functionName: 'approve',
      args: [spenderAddress, amount],
      gas: gasLimit,
    });
  };

  const isApproved = (requiredAmount: bigint) => {
    // Native ETH is always "approved" (no approval needed)
    if (isNativeToken) return true;
    if (!allowance) return false;
    return BigInt(allowance.toString()) >= requiredAmount;
  };

  return {
    approve,
    isApproved,
    allowance: allowance ? BigInt(allowance.toString()) : 0n,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    refetch,
  };
}
