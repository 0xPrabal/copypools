'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useChainId, useSwitchChain } from 'wagmi';
import { CHAIN_IDS } from '@/config/contracts';

export type SupportedChainId = typeof CHAIN_IDS[keyof typeof CHAIN_IDS];

export interface ChainInfo {
  id: number;
  name: string;
  icon?: string;
}

export const CHAIN_INFO: Record<number, ChainInfo> = {
  [CHAIN_IDS.BASE]: {
    id: CHAIN_IDS.BASE,
    name: 'Base',
  },
  [CHAIN_IDS.SEPOLIA]: {
    id: CHAIN_IDS.SEPOLIA,
    name: 'Sepolia',
  },
  [CHAIN_IDS.MAINNET]: {
    id: CHAIN_IDS.MAINNET,
    name: 'Ethereum',
  },
};

export function getChainName(chainId: number): string {
  return CHAIN_INFO[chainId]?.name || `Chain ${chainId}`;
}

export interface UseChainGuardOptions {
  targetChainId: number;
  onChainMismatch?: () => void;
}

export interface UseChainGuardReturn {
  /** Current chain ID */
  currentChainId: number;
  /** Target chain ID for the operation */
  targetChainId: number;
  /** Whether the current chain matches the target */
  isCorrectChain: boolean;
  /** Whether a chain switch is in progress */
  isSwitching: boolean;
  /** Whether the switch modal is open */
  isModalOpen: boolean;
  /** Error from chain switch attempt */
  switchError: Error | null;
  /** Open the chain switch modal */
  openSwitchModal: () => void;
  /** Close the chain switch modal */
  closeSwitchModal: () => void;
  /** Switch to the target chain */
  switchToTargetChain: () => Promise<boolean>;
  /** Execute an operation with chain guard - prompts switch if needed */
  withChainGuard: <T>(operation: () => Promise<T>) => Promise<T | null>;
  /** Chain info for current chain */
  currentChainInfo: ChainInfo;
  /** Chain info for target chain */
  targetChainInfo: ChainInfo;
}

/**
 * Hook to guard operations that require a specific chain.
 * Provides modal state and switch functionality.
 *
 * @example
 * ```tsx
 * const { withChainGuard, isModalOpen, closeSwitchModal } = useChainGuard({
 *   targetChainId: CHAIN_IDS.BASE,
 * });
 *
 * const handleTransaction = async () => {
 *   const result = await withChainGuard(async () => {
 *     return writeContract({ ... });
 *   });
 * };
 *
 * return (
 *   <>
 *     <button onClick={handleTransaction}>Execute</button>
 *     <ChainSwitchModal
 *       isOpen={isModalOpen}
 *       onClose={closeSwitchModal}
 *       {...chainGuardProps}
 *     />
 *   </>
 * );
 * ```
 */
export function useChainGuard(options: UseChainGuardOptions): UseChainGuardReturn {
  const { targetChainId, onChainMismatch } = options;

  const currentChainId = useChainId();
  const { switchChainAsync, isPending: isSwitching, error: switchError } = useSwitchChain();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<(() => Promise<any>) | null>(null);

  const isCorrectChain = currentChainId === targetChainId;

  const currentChainInfo = CHAIN_INFO[currentChainId] || {
    id: currentChainId,
    name: `Chain ${currentChainId}`,
  };

  const targetChainInfo = CHAIN_INFO[targetChainId] || {
    id: targetChainId,
    name: `Chain ${targetChainId}`,
  };

  const openSwitchModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeSwitchModal = useCallback(() => {
    setIsModalOpen(false);
    setPendingOperation(null);
  }, []);

  const switchToTargetChain = useCallback(async (): Promise<boolean> => {
    if (isCorrectChain) return true;

    try {
      await switchChainAsync({ chainId: targetChainId as 8453 | 11155111 });
      return true;
    } catch (error) {
      console.error('Failed to switch chain:', error);
      return false;
    }
  }, [isCorrectChain, switchChainAsync, targetChainId]);

  /**
   * Execute an operation with chain guard.
   * If on wrong chain, opens modal to prompt switch.
   * Returns null if user cancels or switch fails.
   */
  const withChainGuard = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | null> => {
      // Already on correct chain - execute immediately
      if (isCorrectChain) {
        return operation();
      }

      // Wrong chain - open modal and store operation
      onChainMismatch?.();
      setPendingOperation(() => operation);
      setIsModalOpen(true);

      // Return null for now - operation will be executed after switch
      return null;
    },
    [isCorrectChain, onChainMismatch]
  );

  // Track if we were previously on wrong chain (to detect switch completion)
  const wasOnWrongChain = useRef(false);

  // Update ref when chain correctness changes
  useEffect(() => {
    if (!isCorrectChain) {
      wasOnWrongChain.current = true;
    }
  }, [isCorrectChain]);

  // Execute pending operation after successful chain switch
  useEffect(() => {
    const executePending = async () => {
      // Only execute if:
      // 1. We're now on correct chain
      // 2. We have a pending operation
      // 3. We were previously on wrong chain (to avoid running on initial mount)
      if (isCorrectChain && pendingOperation && wasOnWrongChain.current) {
        wasOnWrongChain.current = false;
        const operation = pendingOperation;
        setPendingOperation(null);
        setIsModalOpen(false);

        try {
          await operation();
        } catch (error) {
          console.error('Pending operation failed after chain switch:', error);
        }
      }
    };

    executePending();
  }, [isCorrectChain, pendingOperation]);

  return {
    currentChainId,
    targetChainId,
    isCorrectChain,
    isSwitching,
    isModalOpen,
    switchError: switchError as Error | null,
    openSwitchModal,
    closeSwitchModal,
    switchToTargetChain,
    withChainGuard,
    currentChainInfo,
    targetChainInfo,
  };
}

/**
 * Simplified hook that just checks if user is on correct chain
 * and provides switch functionality without modal state.
 */
export function useRequireChain(targetChainId: number) {
  const currentChainId = useChainId();
  const { switchChainAsync, isPending } = useSwitchChain();

  const isCorrectChain = currentChainId === targetChainId;

  const ensureChain = useCallback(async (): Promise<boolean> => {
    if (isCorrectChain) return true;

    try {
      await switchChainAsync({ chainId: targetChainId as 8453 | 11155111 });
      return true;
    } catch {
      return false;
    }
  }, [isCorrectChain, switchChainAsync, targetChainId]);

  return {
    currentChainId,
    targetChainId,
    isCorrectChain,
    isSwitching: isPending,
    ensureChain,
    currentChainName: getChainName(currentChainId),
    targetChainName: getChainName(targetChainId),
  };
}
