'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount, useReadContract, useBalance, useChainId } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import {
  Loader2,
  Zap,
  ArrowRight,
  AlertCircle,
  CheckCircle,
  Info,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { useZapLiquidity, ZapToken, ZapQuote } from '@/hooks/useZapLiquidity';
import { useTokenApproval } from '@/hooks/useTokenApproval';
import { useToast } from '@/components/common/toast';
import { getContracts, CHAIN_IDS } from '@/config/contracts';
import { TOKENS_BY_CHAIN } from '@/config/tokens';
import ERC20Abi from '@/abis/ERC20.json';

// Known 0x Exchange Proxy addresses
const ZEROX_EXCHANGE_PROXY: Record<number, `0x${string}`> = {
  [CHAIN_IDS.BASE]: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
  [CHAIN_IDS.SEPOLIA]: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
};

// Popular pool pairs
const POOL_PAIRS_BY_CHAIN: Record<number, Array<{ name: string; token0: ZapToken; token1: ZapToken; fee: number }>> = {
  [CHAIN_IDS.BASE]: [
    // High liquidity pairs
    {
      name: 'ETH/USDC',
      token0: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
      token1: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      fee: 3000,
    },
    {
      name: 'WETH/USDC',
      token0: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
      token1: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      fee: 500,
    },
    {
      name: 'ETH/DAI',
      token0: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
      token1: { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
      fee: 3000,
    },
    // LST pairs
    {
      name: 'cbETH/ETH',
      token0: { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', decimals: 18 },
      token1: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
      fee: 500,
    },
    {
      name: 'wstETH/ETH',
      token0: { symbol: 'wstETH', address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', decimals: 18 },
      token1: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
      fee: 500,
    },
    // Stablecoin pairs
    {
      name: 'USDC/USDbC',
      token0: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      token1: { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 },
      fee: 500,
    },
    {
      name: 'USDC/DAI',
      token0: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
      token1: { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
      fee: 500,
    },
    // Popular tokens
    {
      name: 'DEGEN/ETH',
      token0: { symbol: 'DEGEN', address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', decimals: 18 },
      token1: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
      fee: 10000,
    },
    {
      name: 'AERO/ETH',
      token0: { symbol: 'AERO', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18 },
      token1: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
      fee: 3000,
    },
  ],
  [CHAIN_IDS.SEPOLIA]: [
    {
      name: 'ETH/USDC',
      token0: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
      token1: { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
      fee: 3000,
    },
    {
      name: 'WETH/USDC',
      token0: { symbol: 'WETH', address: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', decimals: 18 },
      token1: { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
      fee: 500,
    },
    {
      name: 'WETH/DAI',
      token0: { symbol: 'WETH', address: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', decimals: 18 },
      token1: { symbol: 'DAI', address: '0x68194a729C2450ad26072b3D33ADaCbcef39D574', decimals: 18 },
      fee: 3000,
    },
    {
      name: 'ETH/DAI',
      token0: { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
      token1: { symbol: 'DAI', address: '0x68194a729C2450ad26072b3D33ADaCbcef39D574', decimals: 18 },
      fee: 3000,
    },
  ],
};

const FEE_TIERS = [
  { label: '0.05%', value: 500, description: 'Best for stable pairs' },
  { label: '0.30%', value: 3000, description: 'Most common' },
  { label: '1.00%', value: 10000, description: 'Best for volatile pairs' },
];

const RANGE_STRATEGIES = [
  { id: 'wide', label: 'Wide', description: '±50% around current price', color: 'from-blue-500 to-cyan-500' },
  { id: 'concentrated', label: 'Concentrated', description: '±10% around current price', color: 'from-purple-500 to-pink-500' },
  { id: 'full', label: 'Full Range', description: 'All possible prices', color: 'from-green-500 to-emerald-500' },
] as const;

interface OneClickMintProps {
  onSuccess?: () => void;
  preselectedToken0?: string;
  preselectedToken1?: string;
  preselectedFee?: number;
}

export function OneClickMint({ onSuccess, preselectedToken0, preselectedToken1, preselectedFee }: OneClickMintProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const { showToast } = useToast();

  // Get tokens and pairs for current chain
  const TOKENS = useMemo(() => TOKENS_BY_CHAIN[chainId] || TOKENS_BY_CHAIN[CHAIN_IDS.BASE], [chainId]);
  const POOL_PAIRS = useMemo(() => POOL_PAIRS_BY_CHAIN[chainId] || POOL_PAIRS_BY_CHAIN[CHAIN_IDS.BASE], [chainId]);

  // Check if we have a preselected pool from URL params
  const hasPreselectedPool = !!(preselectedToken0 && preselectedToken1 && preselectedFee);

  // Create pool object from preselected tokens
  const preselectedPool = useMemo(() => {
    if (!hasPreselectedPool) return null;

    // Find matching tokens from TOKENS list
    const token0 = TOKENS.find(t =>
      t.address.toLowerCase() === preselectedToken0!.toLowerCase()
    );
    const token1 = TOKENS.find(t =>
      t.address.toLowerCase() === preselectedToken1!.toLowerCase()
    );

    // If tokens aren't in our list, create minimal token objects
    const t0: ZapToken = token0 || {
      symbol: 'Token0',
      address: preselectedToken0! as `0x${string}`,
      decimals: 18,
    };
    const t1: ZapToken = token1 || {
      symbol: 'Token1',
      address: preselectedToken1! as `0x${string}`,
      decimals: 18,
    };

    return {
      name: `${t0.symbol}/${t1.symbol}`,
      token0: t0,
      token1: t1,
      fee: preselectedFee!,
    };
  }, [hasPreselectedPool, preselectedToken0, preselectedToken1, preselectedFee, TOKENS]);

  // Form state
  const [selectedPool, setSelectedPool] = useState(POOL_PAIRS[0]);

  // Initialize with preselected pool if available
  useEffect(() => {
    if (preselectedPool) {
      setSelectedPool(preselectedPool);
    }
  }, [preselectedPool]);

  const [inputToken, setInputToken] = useState<ZapToken>(TOKENS[0]);
  const [inputAmount, setInputAmount] = useState('');
  const [rangeStrategy, setRangeStrategy] = useState<'full' | 'wide' | 'concentrated'>('wide');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customFee, setCustomFee] = useState(3000);

  // Quote state
  const [quote, setQuote] = useState<ZapQuote | null>(null);

  // Hook for zap operations
  const {
    getZapQuote,
    executeZap,
    checkRouterApproved,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    quoteLoading,
  } = useZapLiquidity();

  // Router approval status
  const [routerApproved, setRouterApproved] = useState<boolean | null>(null);
  const [checkingRouter, setCheckingRouter] = useState(false);

  // Check router approval on mount and chain change
  useEffect(() => {
    const checkRouter = async () => {
      const proxy = ZEROX_EXCHANGE_PROXY[chainId];
      if (!proxy) {
        setRouterApproved(false);
        return;
      }
      setCheckingRouter(true);
      try {
        const approved = await checkRouterApproved(proxy);
        setRouterApproved(approved);
      } catch (err) {
        console.warn('Failed to check router approval:', err);
        setRouterApproved(null);
      }
      setCheckingRouter(false);
    };
    checkRouter();
  }, [chainId, checkRouterApproved]);

  // Check if input token is native ETH
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const isNativeInput = inputToken.address.toLowerCase() === ZERO_ADDRESS;

  // Read native ETH balance - with aggressive caching
  const { data: ethBalance } = useBalance({
    address: address,
    query: {
      enabled: !!address && isNativeInput,
      staleTime: 30_000, // Fresh for 30 seconds
      refetchInterval: false, // No auto-refresh
    },
  });

  // Read ERC20 token balance - with aggressive caching
  const { data: tokenBalance } = useReadContract({
    address: inputToken.address as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !isNativeInput,
      staleTime: 30_000, // Fresh for 30 seconds
      refetchInterval: false, // No auto-refresh
    },
  });

  const balance = isNativeInput ? ethBalance?.value : tokenBalance as bigint | undefined;

  // Token approval
  const {
    approve: approveToken,
    isApproved,
    isPending: isPendingApproval,
  } = useTokenApproval(inputToken.address as `0x${string}`, CONTRACTS.V4_UTILS);

  // Determine available input tokens for selected pool
  const availableInputTokens = useMemo(() => {
    if (!selectedPool) return TOKENS;
    return TOKENS.filter(t => {
      const addr = t.address.toLowerCase();
      const t0 = selectedPool.token0.address.toLowerCase();
      const t1 = selectedPool.token1.address.toLowerCase();
      // Also match WETH with ETH
      const weth = chainId === CHAIN_IDS.BASE
        ? '0x4200000000000000000000000000000000000006'
        : '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9';
      const matchesToken0 = addr === t0 || (t0 === ZERO_ADDRESS && addr === weth.toLowerCase());
      const matchesToken1 = addr === t1 || (t1 === ZERO_ADDRESS && addr === weth.toLowerCase());
      return matchesToken0 || matchesToken1 || addr === t0 || addr === t1;
    });
  }, [selectedPool, TOKENS, chainId]);

  // Update input token when pool changes
  useEffect(() => {
    if (selectedPool && availableInputTokens.length > 0) {
      // Default to ETH if available, otherwise first token
      const ethToken = availableInputTokens.find(t => t.isNative);
      setInputToken(ethToken || availableInputTokens[0]);
    }
  }, [selectedPool, availableInputTokens]);

  // Get quote when params change
  useEffect(() => {
    const fetchQuote = async () => {
      if (!inputAmount || parseFloat(inputAmount) <= 0 || !selectedPool || !address) {
        setQuote(null);
        return;
      }

      const zapQuote = await getZapQuote({
        inputToken,
        inputAmount,
        targetToken0: selectedPool.token0,
        targetToken1: selectedPool.token1,
        fee: showAdvanced ? customFee : selectedPool.fee,
        rangeStrategy,
        recipient: address,
      });

      setQuote(zapQuote);
    };

    const debounce = setTimeout(fetchQuote, 500);
    return () => clearTimeout(debounce);
  }, [inputAmount, inputToken, selectedPool, rangeStrategy, customFee, showAdvanced, address, getZapQuote]);

  // Handle transaction success
  useEffect(() => {
    if (isSuccess && hash) {
      showToast({
        type: 'success',
        message: 'Position created successfully!',
        txHash: hash,
        chainId,
      });
      setInputAmount('');
      setQuote(null);
      onSuccess?.();
    }
  }, [isSuccess, hash, showToast, chainId, onSuccess]);

  const handleApprove = async () => {
    if (!inputAmount) return;
    try {
      const amount = parseUnits(inputAmount, inputToken.decimals);
      await approveToken(amount);
      showToast({ type: 'success', message: `${inputToken.symbol} approved!` });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Approval failed' });
    }
  };

  const handleZap = async () => {
    if (!address || !selectedPool || !inputAmount) return;

    try {
      showToast({ type: 'info', message: 'Creating position...' });

      await executeZap({
        inputToken,
        inputAmount,
        targetToken0: selectedPool.token0,
        targetToken1: selectedPool.token1,
        fee: showAdvanced ? customFee : selectedPool.fee,
        rangeStrategy,
        recipient: address,
      });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Transaction failed' });
    }
  };

  const needsApproval = !isNativeInput && inputAmount && !isApproved(parseUnits(inputAmount || '0', inputToken.decimals));
  const isProcessing = isPending || isConfirming || isPendingApproval;

  if (!isConnected) {
    return (
      <div className="card-gradient text-center py-12">
        <Zap className="mx-auto mb-4 text-gray-600" size={48} />
        <p className="text-gray-400">Connect your wallet to create a position</p>
      </div>
    );
  }

  return (
    <div className="card-gradient animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
            <Zap className="text-purple-400" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">One-Click Position</h3>
            <p className="text-xs text-gray-400">Deposit single token, auto-swap to optimal ratio</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Sparkles size={12} />
          <span>Auto-Zap</span>
        </div>
      </div>

      {/* Transaction Status */}
      {(isProcessing || isSuccess || error) && (
        <div className={`mb-5 p-4 rounded-xl animate-scale-in ${
          error ? 'bg-gradient-to-r from-red-500/10 to-red-600/5 border border-red-500/20' :
          isSuccess ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/5 border border-green-500/20' :
          'bg-gradient-to-r from-blue-500/10 to-cyan-500/5 border border-blue-500/20'
        }`}>
          <div className="flex items-center gap-3">
            {isProcessing && (
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
                {isPendingApproval && 'Approving token...'}
                {isPending && 'Confirm in wallet...'}
                {isConfirming && 'Creating position...'}
                {isSuccess && 'Position created!'}
                {error && 'Transaction failed'}
              </p>
              {error && <p className="text-xs text-red-400 mt-0.5">{error.message}</p>}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-5">
        {/* Pool Selection - hide when preselected from pools page */}
        {hasPreselectedPool ? (
          <div className="bg-gray-800/50 rounded-xl p-4 border border-primary-500/30">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Selected Pool</label>
                <div className="font-semibold text-white text-lg">{selectedPool.name}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">Fee Tier</div>
                <div className="text-primary-400 font-medium">{(selectedPool.fee / 10000).toFixed(2)}%</div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Select Pool ({POOL_PAIRS.length} available)</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
              {POOL_PAIRS.map((pair) => (
                <button
                  key={pair.name}
                  onClick={() => setSelectedPool(pair)}
                  className={`p-3 rounded-xl border transition-all ${
                    selectedPool.name === pair.name
                      ? 'bg-primary-500/20 border-primary-500 text-white'
                      : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600 text-gray-300'
                  }`}
                >
                  <div className="font-medium text-sm">{pair.name}</div>
                  <div className="text-xs text-gray-400">{(pair.fee / 10000).toFixed(2)}% fee</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Token & Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Deposit Amount</label>
          <div className="relative">
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-4 pr-32 bg-gray-800/50 border border-gray-700/50 rounded-xl focus:outline-none focus:border-primary-500 text-lg"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <select
                value={inputToken.address}
                onChange={(e) => {
                  const token = availableInputTokens.find(t => t.address === e.target.value);
                  if (token) setInputToken(token);
                }}
                className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm font-medium appearance-none cursor-pointer pr-8"
              >
                {availableInputTokens.map((token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" size={14} />
            </div>
          </div>
          {balance !== undefined && (
            <div className="flex justify-between mt-2 text-xs">
              <span className="text-gray-400">
                Balance: {parseFloat(formatUnits(balance, inputToken.decimals)).toFixed(4)} {inputToken.symbol}
              </span>
              <button
                onClick={() => setInputAmount(formatUnits(balance, inputToken.decimals))}
                className="text-primary-400 hover:text-primary-300"
              >
                Max
              </button>
            </div>
          )}
        </div>

        {/* Range Strategy */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Range Strategy</label>
          <div className="grid grid-cols-3 gap-2">
            {RANGE_STRATEGIES.map((strategy) => (
              <button
                key={strategy.id}
                onClick={() => setRangeStrategy(strategy.id)}
                className={`p-3 rounded-xl border transition-all ${
                  rangeStrategy === strategy.id
                    ? 'bg-primary-500/20 border-primary-500 text-white'
                    : 'bg-gray-800/50 border-gray-700/50 hover:border-gray-600 text-gray-300'
                }`}
              >
                <div className="font-medium text-sm">{strategy.label}</div>
                <div className="text-xs text-gray-400">{strategy.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Quote Preview */}
        {quote && (
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
            <div className="flex items-center gap-2 mb-3">
              <Info size={14} className="text-blue-400" />
              <span className="text-sm font-medium text-gray-300">Position Preview</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Swap Amount</span>
                <span className="text-white">
                  {formatUnits(quote.swapAmount, quote.swapFromToken.decimals).slice(0, 10)} {quote.swapFromToken.symbol}
                  <ArrowRight className="inline mx-1" size={12} />
                  {quote.swapToToken.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Expected {selectedPool.token0.symbol}</span>
                <span className="text-white">
                  {formatUnits(quote.expectedAmount0, selectedPool.token0.decimals).slice(0, 10)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Expected {selectedPool.token1.symbol}</span>
                <span className="text-white">
                  {formatUnits(quote.expectedAmount1, selectedPool.token1.decimals).slice(0, 10)}
                </span>
              </div>
              {quote.priceImpact > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Price Impact</span>
                  <span className={quote.priceImpact > 1 ? 'text-yellow-400' : 'text-green-400'}>
                    {quote.priceImpact.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {quoteLoading && (
          <div className="flex items-center justify-center gap-2 py-4 text-gray-400">
            <Loader2 className="animate-spin" size={16} />
            <span className="text-sm">Getting quote...</span>
          </div>
        )}

        {/* Advanced Options */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ChevronDown className={`transform transition-transform ${showAdvanced ? 'rotate-180' : ''}`} size={14} />
          Advanced Options
        </button>

        {showAdvanced && (
          <div className="space-y-3 p-4 bg-gray-800/30 rounded-xl border border-gray-700/30">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Custom Fee Tier</label>
              <div className="grid grid-cols-3 gap-2">
                {FEE_TIERS.map((tier) => (
                  <button
                    key={tier.value}
                    onClick={() => setCustomFee(tier.value)}
                    className={`p-2 rounded-lg text-sm transition-all ${
                      customFee === tier.value
                        ? 'bg-primary-500/20 border border-primary-500 text-white'
                        : 'bg-gray-700/50 border border-gray-600/50 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          {needsApproval ? (
            <button
              onClick={handleApprove}
              disabled={isProcessing || !inputAmount}
              className="btn-primary w-full py-4 flex items-center justify-center gap-2"
            >
              {isPendingApproval ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Approving...
                </>
              ) : (
                <>Approve {inputToken.symbol}</>
              )}
            </button>
          ) : (
            <button
              onClick={handleZap}
              disabled={isProcessing || !inputAmount || !quote || routerApproved === false}
              className="btn-primary w-full py-4 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  {isPending ? 'Confirm in Wallet...' : 'Creating Position...'}
                </>
              ) : checkingRouter ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Checking Router...
                </>
              ) : routerApproved === false ? (
                <>
                  <AlertCircle size={18} />
                  Router Not Approved
                </>
              ) : (
                <>
                  <Zap size={18} />
                  Create Position
                </>
              )}
            </button>
          )}
        </div>

        {/* Router Warning */}
        {routerApproved === false && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
            <AlertCircle className="text-yellow-400 mt-0.5 flex-shrink-0" size={18} />
            <div>
              <p className="text-sm font-medium text-yellow-300 mb-1">
                Swap Router Not Approved
              </p>
              <p className="text-xs text-yellow-200/80">
                One-Click Zap requires the 0x Exchange Proxy to be approved on the V4Utils contract.
                The contract owner needs to call <code className="bg-yellow-500/20 px-1 rounded">setRouterApproval({ZEROX_EXCHANGE_PROXY[chainId]?.slice(0, 10)}..., true)</code> to enable this feature.
              </p>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 flex items-start gap-2">
          <Info className="text-blue-400 mt-0.5 flex-shrink-0" size={14} />
          <p className="text-xs text-blue-200">
            One-click zap automatically swaps a portion of your deposit to create a balanced position.
            The swap uses 0x aggregator for best prices with 1% slippage protection.
          </p>
        </div>
      </div>
    </div>
  );
}
