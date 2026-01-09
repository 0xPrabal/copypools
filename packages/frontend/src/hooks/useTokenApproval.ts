import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useChainId, usePublicClient, useSwitchChain } from 'wagmi';
import ERC20Abi from '@/abis/ERC20.json';

// Gas estimation multiplier (120% of estimated gas)
const GAS_BUFFER_MULTIPLIER = 120n;

export function useTokenApproval(tokenAddress: `0x${string}` | undefined, spenderAddress: `0x${string}`, requiredChainId?: number) {
  const { address: userAddress, connector, chainId: walletChainId } = useAccount();
  const defaultChainId = useChainId();
  const chainId = requiredChainId ?? defaultChainId;
  const publicClient = usePublicClient({ chainId: chainId as 8453 | 11155111 });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, data: hash, isPending } = useWriteContract();

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
      staleTime: 60_000, // Fresh for 1 minute
      refetchInterval: false, // No auto-refresh
    },
  });

  const approve = async (amount: bigint) => {
    console.log('[TokenApproval] approve() called with amount:', amount.toString());
    console.log('[TokenApproval] tokenAddress:', tokenAddress);
    console.log('[TokenApproval] spenderAddress:', spenderAddress);
    console.log('[TokenApproval] isNativeToken:', isNativeToken);
    console.log('[TokenApproval] walletChainId:', walletChainId, 'requiredChainId:', chainId);

    // Native ETH doesn't need approval
    if (isNativeToken) {
      console.log('[TokenApproval] Skipping - native token');
      return; // No-op for native ETH
    }

    if (!tokenAddress) {
      console.error('[TokenApproval] No token address provided');
      throw new Error('Token address not provided');
    }

    // Switch chain if needed
    if (walletChainId !== chainId) {
      console.log('[TokenApproval] Switching chain from', walletChainId, 'to', chainId);
      try {
        await switchChainAsync({ chainId: chainId as 8453 | 11155111 });
        console.log('[TokenApproval] Chain switched successfully');
      } catch (switchError) {
        console.error('[TokenApproval] Chain switch failed:', switchError);
        throw new Error(`Please switch to the correct network (Chain ID: ${chainId})`);
      }
    }

    // Estimate gas dynamically with fallback
    let gasLimit = 100000n; // Fallback gas limit
    try {
      if (publicClient && userAddress) {
        console.log('[TokenApproval] Estimating gas...');
        const estimated = await publicClient.estimateContractGas({
          address: tokenAddress,
          abi: ERC20Abi,
          functionName: 'approve',
          args: [spenderAddress, amount],
          account: userAddress,
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
        console.log('[TokenApproval] Gas estimated:', gasLimit.toString());
      }
    } catch (gasError) {
      console.warn('[TokenApproval] Gas estimation failed:', gasError);
      // Use fallback gas limit if estimation fails
    }

    // Simulate transaction before executing
    console.log('[TokenApproval] Simulating approve...');
    try {
      await publicClient?.simulateContract({
        account: userAddress,
        address: tokenAddress,
        abi: ERC20Abi,
        functionName: 'approve',
        args: [spenderAddress, amount],
      });
      console.log('[TokenApproval] Simulation successful');
    } catch (simError: any) {
      console.error('[TokenApproval] Simulation failed:', simError);
      const errorMsg = simError.message || 'Approval simulation failed';
      throw new Error(`Approval would fail: ${errorMsg}`);
    }

    console.log('[TokenApproval] Calling writeContractAsync...');
    console.log('[TokenApproval] userAddress:', userAddress);
    console.log('[TokenApproval] connector:', connector?.name);

    try {
      // Use writeContractAsync with explicit account for Privy compatibility
      const txHash = await writeContractAsync({
        chainId: chainId as 8453 | 11155111,
        address: tokenAddress,
        abi: ERC20Abi,
        functionName: 'approve',
        args: [spenderAddress, amount],
        gas: gasLimit,
        account: userAddress, // Explicitly pass account for Privy/MetaMask
      });
      console.log('[TokenApproval] Transaction hash:', txHash);
      return txHash;
    } catch (writeError) {
      console.error('[TokenApproval] writeContractAsync error:', writeError);
      throw writeError;
    }
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
