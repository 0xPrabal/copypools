'use client';

import { useEffect } from 'react';
import { X, ArrowRight, AlertTriangle, Loader2 } from 'lucide-react';
import { ChainInfo } from '@/hooks/useChainGuard';

interface ChainSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentChainInfo: ChainInfo;
  targetChainInfo: ChainInfo;
  isSwitching: boolean;
  switchError: Error | null;
  onSwitch: () => Promise<boolean>;
  onSwitchSuccess?: () => void;
}

/**
 * Modal that prompts user to switch to the correct chain before a transaction.
 */
export function ChainSwitchModal({
  isOpen,
  onClose,
  currentChainInfo,
  targetChainInfo,
  isSwitching,
  switchError,
  onSwitch,
  onSwitchSuccess,
}: ChainSwitchModalProps) {
  // Close modal on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSwitching) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, isSwitching, onClose]);

  if (!isOpen) return null;

  const handleSwitch = async () => {
    const success = await onSwitch();
    if (success) {
      onSwitchSuccess?.();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={isSwitching ? undefined : onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <AlertTriangle className="text-yellow-500" size={20} />
            Wrong Network
          </h2>
          {!isSwitching && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          <p className="text-gray-300 text-sm mb-6">
            This action requires you to be on a different network. Please switch to continue.
          </p>

          {/* Chain Switch Visual */}
          <div className="flex items-center justify-center gap-4 py-6 bg-gray-800/50 rounded-lg mb-6">
            {/* Current Chain */}
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center mx-auto mb-2">
                <span className="text-lg font-bold text-gray-300">
                  {currentChainInfo.name.charAt(0)}
                </span>
              </div>
              <p className="text-sm text-gray-400">Current</p>
              <p className="text-sm font-medium text-white">{currentChainInfo.name}</p>
            </div>

            {/* Arrow */}
            <ArrowRight className="text-gray-500" size={24} />

            {/* Target Chain */}
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-blue-600/20 border-2 border-blue-500 flex items-center justify-center mx-auto mb-2">
                <span className="text-lg font-bold text-blue-400">
                  {targetChainInfo.name.charAt(0)}
                </span>
              </div>
              <p className="text-sm text-gray-400">Required</p>
              <p className="text-sm font-medium text-blue-400">{targetChainInfo.name}</p>
            </div>
          </div>

          {/* Error Message */}
          {switchError && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">
                Failed to switch network. Please try again or switch manually in your wallet.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isSwitching}
              className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSwitch}
              disabled={isSwitching}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isSwitching ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Switching...
                </>
              ) : (
                <>
                  Switch to {targetChainInfo.name}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline chain warning banner (alternative to modal)
 */
export function ChainWarningBanner({
  currentChainName,
  targetChainName,
  onSwitch,
  isSwitching,
}: {
  currentChainName: string;
  targetChainName: string;
  onSwitch: () => void;
  isSwitching: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
      <div className="flex items-center gap-2">
        <AlertTriangle className="text-yellow-500" size={18} />
        <p className="text-sm text-yellow-200">
          You&apos;re on <span className="font-medium">{currentChainName}</span>.
          Switch to <span className="font-medium">{targetChainName}</span> to continue.
        </p>
      </div>
      <button
        onClick={onSwitch}
        disabled={isSwitching}
        className="px-3 py-1.5 bg-yellow-500/20 hover:bg-yellow-500/30 disabled:opacity-50 text-yellow-200 text-sm font-medium rounded-md transition-colors flex items-center gap-1"
      >
        {isSwitching ? (
          <Loader2 className="animate-spin" size={14} />
        ) : (
          'Switch'
        )}
      </button>
    </div>
  );
}
