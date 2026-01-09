'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

interface WalletConnectionState {
  // Combined connection state - true only when both Privy and Wagmi agree
  isFullyConnected: boolean;
  // Individual states for debugging
  isPrivyAuthenticated: boolean;
  isWagmiConnected: boolean;
  // Wallet address (only valid when fully connected)
  address: `0x${string}` | undefined;
  // Loading state
  isLoading: boolean;
  // Disconnect function that also clears cache
  disconnect: () => Promise<void>;
}

/**
 * Unified wallet connection hook that combines Privy and Wagmi states.
 *
 * This hook solves the state mismatch issue where:
 * - Privy's `authenticated` becomes false immediately on logout
 * - Wagmi's `isConnected` may still be true briefly
 *
 * By checking BOTH states, we ensure consistent behavior across all components.
 */
export function useWalletConnection(): WalletConnectionState {
  const { authenticated, ready, logout } = usePrivy();
  const { isConnected, address } = useAccount();
  const queryClient = useQueryClient();

  // Only consider fully connected when BOTH systems agree
  const isFullyConnected = ready && authenticated && isConnected && !!address;

  // Loading while Privy is initializing
  const isLoading = !ready;

  // Disconnect function that clears all cached data
  const disconnect = useCallback(async () => {
    // Clear React Query cache first to prevent stale data showing
    queryClient.clear();

    // Then logout from Privy (which will also disconnect wagmi)
    await logout();
  }, [queryClient, logout]);

  return {
    isFullyConnected,
    isPrivyAuthenticated: authenticated,
    isWagmiConnected: isConnected,
    address: isFullyConnected ? address : undefined,
    isLoading,
    disconnect,
  };
}
