import { useWriteContract, useWaitForTransactionReceipt, useReadContract, useAccount, useChainId, usePublicClient } from 'wagmi';
import { getContracts } from '@/config/contracts';

// Gas estimation multiplier (120% of estimated gas)
const GAS_BUFFER_MULTIPLIER = 120n;

// Minimal ERC721 ABI for approval functions
const ERC721_ABI = [
  {
    name: 'isApprovedForAll',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'setApprovalForAll',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    name: 'getApproved',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

/**
 * Hook to manage NFT (position) approval for V4Utils contract
 * This is needed because V4Utils requires NFT approval to interact with positions
 */
export function useNFTApproval(operatorAddress: `0x${string}`) {
  const { address: userAddress } = useAccount();
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const publicClient = usePublicClient({ chainId });
  const { writeContract, data: hash, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // Check if operator is approved for all positions
  const { data: isApprovedForAll, refetch } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: ERC721_ABI,
    functionName: 'isApprovedForAll',
    args: userAddress ? [userAddress, operatorAddress] : undefined,
    query: {
      enabled: !!userAddress,
    },
  });

  // Approve operator for all positions
  const approveAll = async () => {
    // Estimate gas dynamically with fallback
    let gasLimit = 100000n; // Fallback gas limit
    try {
      if (publicClient && userAddress) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.POSITION_MANAGER,
          abi: ERC721_ABI,
          functionName: 'setApprovalForAll',
          args: [operatorAddress, true],
          account: userAddress,
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit if estimation fails
    }

    return writeContract({
      chainId,
      address: CONTRACTS.POSITION_MANAGER,
      abi: ERC721_ABI,
      functionName: 'setApprovalForAll',
      args: [operatorAddress, true],
      gas: gasLimit,
    });
  };

  // Revoke approval for all positions
  const revokeAll = async () => {
    // Estimate gas dynamically with fallback
    let gasLimit = 100000n; // Fallback gas limit
    try {
      if (publicClient && userAddress) {
        const estimated = await publicClient.estimateContractGas({
          address: CONTRACTS.POSITION_MANAGER,
          abi: ERC721_ABI,
          functionName: 'setApprovalForAll',
          args: [operatorAddress, false],
          account: userAddress,
        });
        gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
      }
    } catch {
      // Use fallback gas limit if estimation fails
    }

    return writeContract({
      chainId,
      address: CONTRACTS.POSITION_MANAGER,
      abi: ERC721_ABI,
      functionName: 'setApprovalForAll',
      args: [operatorAddress, false],
      gas: gasLimit,
    });
  };

  return {
    approveAll,
    revokeAll,
    isApprovedForAll: !!isApprovedForAll,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    refetch,
  };
}

/**
 * Hook to check if a specific token is approved for an operator
 */
export function useTokenApprovalStatus(tokenId: bigint | undefined, operatorAddress: `0x${string}`) {
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const { data: approvedAddress } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER,
    abi: ERC721_ABI,
    functionName: 'getApproved',
    args: tokenId ? [tokenId] : undefined,
    query: {
      enabled: !!tokenId,
    },
  });

  return {
    isApproved: approvedAddress?.toLowerCase() === operatorAddress.toLowerCase(),
    approvedAddress,
  };
}
