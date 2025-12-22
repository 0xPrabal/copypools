'use client';

import { useState, ReactNode } from 'react';
import { useChainId, useSwitchChain } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { ChainSwitchModal } from './chain-switch-modal';
import { CHAIN_INFO, getChainName } from '@/hooks/useChainGuard';

interface ChainGuardButtonProps {
  /** The chain ID required for this action */
  requiredChainId: number;
  /** The action to execute when clicked (after chain is correct) */
  onClick: () => void | Promise<void>;
  /** Whether the underlying action is loading */
  isLoading?: boolean;
  /** Whether the button should be disabled */
  disabled?: boolean;
  /** Button content */
  children: ReactNode;
  /** Additional className for the button */
  className?: string;
}

/**
 * A button wrapper that ensures the user is on the correct chain before executing an action.
 * If on wrong chain, shows a modal prompting to switch.
 *
 * @example
 * ```tsx
 * <ChainGuardButton
 *   requiredChainId={CHAIN_IDS.BASE}
 *   onClick={() => writeContract({ ... })}
 *   isLoading={isPending}
 *   className="bg-blue-600 px-4 py-2 rounded"
 * >
 *   Execute Transaction
 * </ChainGuardButton>
 * ```
 */
export function ChainGuardButton({
  requiredChainId,
  onClick,
  isLoading = false,
  disabled = false,
  children,
  className = '',
}: ChainGuardButtonProps) {
  const currentChainId = useChainId();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [showModal, setShowModal] = useState(false);

  const isCorrectChain = currentChainId === requiredChainId;

  const currentChainInfo = CHAIN_INFO[currentChainId] || {
    id: currentChainId,
    name: getChainName(currentChainId),
  };

  const targetChainInfo = CHAIN_INFO[requiredChainId] || {
    id: requiredChainId,
    name: getChainName(requiredChainId),
  };

  const handleClick = async () => {
    if (!isCorrectChain) {
      setShowModal(true);
      return;
    }

    await onClick();
  };

  const handleSwitch = async (): Promise<boolean> => {
    try {
      await switchChainAsync({ chainId: requiredChainId as 8453 | 11155111 });
      return true;
    } catch (error) {
      console.error('Failed to switch chain:', error);
      return false;
    }
  };

  const handleSwitchSuccess = () => {
    // Execute the action after successful switch
    setShowModal(false);
    onClick();
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={disabled || isLoading || isSwitching}
        className={className}
      >
        {isLoading || isSwitching ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={16} />
            {isSwitching ? 'Switching...' : 'Loading...'}
          </span>
        ) : (
          children
        )}
      </button>

      <ChainSwitchModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        currentChainInfo={currentChainInfo}
        targetChainInfo={targetChainInfo}
        isSwitching={isSwitching}
        switchError={null}
        onSwitch={handleSwitch}
        onSwitchSuccess={handleSwitchSuccess}
      />
    </>
  );
}

/**
 * HOC to wrap any component with chain guard functionality
 */
export function withChainGuard<P extends { onClick?: () => void }>(
  WrappedComponent: React.ComponentType<P>,
  requiredChainId: number
) {
  return function ChainGuardedComponent(props: P) {
    const currentChainId = useChainId();
    const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
    const [showModal, setShowModal] = useState(false);

    const isCorrectChain = currentChainId === requiredChainId;

    const handleClick = () => {
      if (!isCorrectChain) {
        setShowModal(true);
        return;
      }
      props.onClick?.();
    };

    const handleSwitch = async (): Promise<boolean> => {
      try {
        await switchChainAsync({ chainId: requiredChainId as 8453 | 11155111 });
        return true;
      } catch {
        return false;
      }
    };

    const currentChainInfo = CHAIN_INFO[currentChainId] || {
      id: currentChainId,
      name: getChainName(currentChainId),
    };

    const targetChainInfo = CHAIN_INFO[requiredChainId] || {
      id: requiredChainId,
      name: getChainName(requiredChainId),
    };

    return (
      <>
        <WrappedComponent {...props} onClick={handleClick} />
        <ChainSwitchModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          currentChainInfo={currentChainInfo}
          targetChainInfo={targetChainInfo}
          isSwitching={isSwitching}
          switchError={null}
          onSwitch={handleSwitch}
          onSwitchSuccess={() => {
            setShowModal(false);
            props.onClick?.();
          }}
        />
      </>
    );
  };
}
