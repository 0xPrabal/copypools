'use client';

import { useState } from 'react';
import { formatUnits } from 'viem';
import { useChainId } from 'wagmi';
import {
  Loader2,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Coins,
  Wallet,
  ArrowDownRight,
  Sparkles,
  Banknote
} from 'lucide-react';
import { useV4Utils } from '@/hooks/useV4Utils';
import { CHAIN_IDS } from '@/config/contracts';

type TargetToken = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  gradient: string;
  bgGradient: string;
};

// Common tokens for conversion per chain
const TARGET_TOKENS_BY_CHAIN: Record<number, TargetToken[]> = {
  [CHAIN_IDS.BASE]: [
    { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, gradient: 'from-blue-500 to-purple-500', bgGradient: 'from-blue-500/20 to-purple-500/20' },
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, gradient: 'from-indigo-500 to-blue-500', bgGradient: 'from-indigo-500/20 to-blue-500/20' },
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, gradient: 'from-blue-400 to-cyan-400', bgGradient: 'from-blue-400/20 to-cyan-400/20' },
    { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6, gradient: 'from-green-400 to-emerald-400', bgGradient: 'from-green-400/20 to-emerald-400/20' },
  ],
  [CHAIN_IDS.SEPOLIA]: [
    { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, gradient: 'from-blue-500 to-purple-500', bgGradient: 'from-blue-500/20 to-purple-500/20' },
    { symbol: 'WETH', address: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', decimals: 18, gradient: 'from-indigo-500 to-blue-500', bgGradient: 'from-indigo-500/20 to-blue-500/20' },
    { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6, gradient: 'from-blue-400 to-cyan-400', bgGradient: 'from-blue-400/20 to-cyan-400/20' },
    { symbol: 'USDT', address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', decimals: 6, gradient: 'from-green-400 to-emerald-400', bgGradient: 'from-green-400/20 to-emerald-400/20' },
  ],
};

interface FeeHarvesterProps {
  tokenId: bigint;
  pendingFees?: [bigint, bigint];
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  isNFTApproved: boolean;
}

export function FeeHarvester({
  tokenId,
  pendingFees,
  token0Symbol,
  token1Symbol,
  token0Decimals,
  token1Decimals,
  token0Address,
  token1Address,
  isNFTApproved,
}: FeeHarvesterProps) {
  const chainId = useChainId();
  const TARGET_TOKENS = TARGET_TOKENS_BY_CHAIN[chainId] || TARGET_TOKENS_BY_CHAIN[CHAIN_IDS.BASE];
  const [targetToken, setTargetToken] = useState<TargetToken | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const {
    collectFees,
    collectAndSwapFees,
    isPending,
    isConfirming,
    isSuccess,
    error,
  } = useV4Utils();

  const fee0 = pendingFees?.[0] || 0n;
  const fee1 = pendingFees?.[1] || 0n;
  const hasFees = fee0 > 0n || fee1 > 0n;

  const handleCollect = async () => {
    if (!tokenId) return;

    // Use the new collectFees function that returns both tokens (no swap)
    await collectFees({
      tokenId,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    });
  };

  const handleCollectAndConvert = async (target: TargetToken) => {
    if (!tokenId) return;
    setIsConverting(true);
    setTargetToken(target);

    // Use collectAndSwapFees to convert all fees to a single token
    await collectAndSwapFees({
      tokenId,
      targetCurrency: target.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    });

    setIsConverting(false);
  };

  const isProcessing = isPending || isConfirming;

  return (
    <div className="card-gradient animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
            <Coins className="text-green-400" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Fee Harvester</h3>
            <p className="text-xs text-gray-400">Collect and convert your earned fees</p>
          </div>
        </div>
        {hasFees && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30">
            <Sparkles size={12} className="text-green-400" />
            <span className="text-xs font-medium text-green-400">Fees Ready</span>
          </div>
        )}
      </div>

      {/* Current Fees Display */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900/80 to-gray-800/50 border border-gray-700/30 p-5 mb-5">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-green-500/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2" />

        <div className="flex items-center gap-2 mb-4">
          <Wallet size={14} className="text-gray-400" />
          <p className="text-sm font-medium text-gray-400">Unclaimed Fees</p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-400" />
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{token0Symbol}</p>
            </div>
            <p className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
              {formatUnits(fee0, token0Decimals).slice(0, 10)}
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-400 to-pink-400" />
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{token1Symbol}</p>
            </div>
            <p className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
              {formatUnits(fee1, token1Decimals).slice(0, 10)}
            </p>
          </div>
        </div>

        {/* Total Value Indicator */}
        {hasFees && (
          <div className="mt-4 pt-4 border-t border-gray-700/30">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Combined Value</span>
              <span className="text-green-400 font-medium">Ready to harvest</span>
            </div>
          </div>
        )}
      </div>

      {/* Transaction Status */}
      {(isPending || isConfirming || isSuccess || error) && (
        <div className={`mb-5 p-4 rounded-xl animate-scale-in ${
          error ? 'bg-gradient-to-r from-red-500/10 to-red-600/5 border border-red-500/20' :
          isSuccess ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/5 border border-green-500/20' :
          'bg-gradient-to-r from-blue-500/10 to-cyan-500/5 border border-blue-500/20'
        }`}>
          <div className="flex items-center gap-3">
            {(isPending || isConfirming) && (
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-400" size={16} />
              </div>
            )}
            {isSuccess && (
              <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="text-green-400" size={16} />
              </div>
            )}
            {error && (
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="text-red-400" size={16} />
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-white">
                {isPending && 'Awaiting wallet confirmation...'}
                {isConfirming && 'Harvesting your fees...'}
                {isSuccess && 'Fees collected successfully!'}
                {error && 'Collection failed'}
              </p>
              {error && <p className="text-xs text-red-400 mt-0.5">{error.message}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-4">
        {/* Standard Collect */}
        <button
          onClick={handleCollect}
          disabled={isProcessing || !hasFees || !isNFTApproved}
          className="w-full group relative overflow-hidden rounded-xl p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/5 border border-green-500/30 hover:border-green-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-green-500/0 to-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/30 to-emerald-500/30 flex items-center justify-center">
                <Banknote className="text-green-400" size={20} />
              </div>
              <div className="text-left">
                <p className="font-semibold text-white">
                  {!isNFTApproved ? 'Approve NFT First' : `Collect as ${token0Symbol} + ${token1Symbol}`}
                </p>
                <p className="text-xs text-gray-400">Keep original tokens</p>
              </div>
            </div>
            {isProcessing ? (
              <Loader2 className="animate-spin text-green-400" size={20} />
            ) : (
              <ArrowRight className="text-green-400 group-hover:translate-x-1 transition-transform" size={20} />
            )}
          </div>
        </button>

        {/* Collect & Convert Options */}
        {hasFees && isNFTApproved && (
          <>
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent" />
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <ArrowDownRight size={12} />
                <span>Or convert to</span>
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {TARGET_TOKENS.map((token) => (
                <button
                  key={token.symbol}
                  onClick={() => handleCollectAndConvert(token)}
                  disabled={isProcessing}
                  className="group relative overflow-hidden rounded-xl p-4 bg-gray-800/30 border border-gray-700/50 hover:border-gray-600/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className={`absolute inset-0 bg-gradient-to-r ${token.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity`} />
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${token.bgGradient} flex items-center justify-center`}>
                        <span className={`text-xs font-bold bg-gradient-to-r ${token.gradient} bg-clip-text text-transparent`}>
                          {token.symbol.charAt(0)}
                        </span>
                      </div>
                      <span className="font-semibold text-white">{token.symbol}</span>
                    </div>
                    <ArrowRight size={16} className="text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {!hasFees && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <div className="w-12 h-12 rounded-xl bg-gray-800/50 flex items-center justify-center mb-3">
              <Coins size={24} />
            </div>
            <p className="text-sm font-medium text-gray-300 mb-1">No fees to collect</p>
            <p className="text-xs text-gray-500 text-center">
              Fees accumulate as trades occur in your range
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
