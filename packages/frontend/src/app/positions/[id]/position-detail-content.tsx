'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAccount, useChainId } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Minus,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Loader2,
  CheckCircle,
  AlertCircle,
  Zap,
  Settings,
  Info,
  Lock,
} from 'lucide-react';
import { useV4Utils } from '@/hooks/useV4Utils';
import { useV4Compoundor, usePendingFees } from '@/hooks/useV4Compoundor';
import { useV4AutoRange, useCheckRebalance } from '@/hooks/useV4AutoRange';
import { useZapLiquidity, ZapToken } from '@/hooks/useZapLiquidity';
import { useTokenApproval } from '@/hooks/useTokenApproval';
import { useNFTApproval } from '@/hooks/useNFTApproval';
import { usePositions } from '@/hooks/usePonderData';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import { SLIPPAGE_PRESETS } from '@/lib/slippage';
import { getContracts } from '@/config/contracts';
import { tickToPrice, tickToPercentage, formatPercentage, formatTickPrice, getPositionValueUsd, isFullRangePosition } from '@/utils/tickMath';
import { ProfitabilityCalculator } from '@/components/position/profitability-calculator';
import { FeeHarvester } from '@/components/position/fee-harvester';
import { RangeStrategyBuilder } from '@/components/position/range-strategy-builder';
import { OneClickActions } from '@/components/position/one-click-actions';

type ActionTab = 'increase' | 'decrease' | 'collect' | 'compound' | 'range' | 'quick' | 'strategy';

export default function PositionDetailContent() {
  const params = useParams();
  const { address } = useAccount();
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const tokenId = params.id ? BigInt(params.id as string) : undefined;

  const [activeTab, setActiveTab] = useState<ActionTab>('quick');
  const [slippage, setSlippage] = useState<number>(SLIPPAGE_PRESETS.MEDIUM);

  // Get position data
  const { data: positions, isLoading: positionsLoading, refetch: refetchPositions } = usePositions();
  const position = positions?.find(p => p.tokenId === params.id);

  // Contract hooks
  const {
    increaseLiquidity,
    decreaseLiquidity,
    decreaseAndSwap,
    collectFees,
    isPending: utilsPending,
    isConfirming: utilsConfirming,
    isSuccess: utilsSuccess,
    error: utilsError,
  } = useV4Utils();

  const {
    registerPosition: registerCompound,
    selfCompound,
    unregisterPosition: unregisterCompound,
    isPending: compoundPending,
    isConfirming: compoundConfirming,
    isSuccess: compoundSuccess,
    error: compoundError,
  } = useV4Compoundor();

  const {
    configureRange,
    removeRange,
    executeRebalance,
    isPending: rangePending,
    isConfirming: rangeConfirming,
    isSuccess: rangeSuccess,
    error: rangeError,
  } = useV4AutoRange();

  // Zap liquidity hook for single token deposits
  const {
    executeZap,
    isPending: zapPending,
    isConfirming: zapConfirming,
    isSuccess: zapSuccess,
  } = useZapLiquidity();

  // Read contract data - get pending fees from V4Compoundor (now fixed!)
  const { data: pendingFeesData } = usePendingFees(tokenId);
  const pendingFees = pendingFeesData as [bigint, bigint] | undefined;

  // Read contract data for rebalance status
  const { data: rebalanceStatusData } = useCheckRebalance(tokenId);
  const rebalanceStatus = rebalanceStatusData as [boolean] | undefined;

  // Token approval hooks - need to approve V4_UTILS to spend tokens
  const token0Address = position?.pool.token0.address as `0x${string}` | undefined;
  const token1Address = position?.pool.token1.address as `0x${string}` | undefined;

  // Get real token prices for accurate position value calculation
  const { token0Price, token1Price, isLoading: pricesLoading } = useTokenPrices(token0Address, token1Address, chainId);

  const {
    approve: approveToken0,
    isApproved: isToken0Approved,
    isPending: approval0Pending,
    isConfirming: approval0Confirming,
  } = useTokenApproval(token0Address, CONTRACTS.V4_UTILS);

  const {
    approve: approveToken1,
    isApproved: isToken1Approved,
    isPending: approval1Pending,
    isConfirming: approval1Confirming,
  } = useTokenApproval(token1Address, CONTRACTS.V4_UTILS);

  // NFT approval hook - V4Utils needs to be approved as operator on PositionManager
  const {
    approveAll: approveNFTForUtils,
    isApprovedForAll: isNFTApprovedForUtils,
    isPending: nftApprovalUtilsPending,
    isConfirming: nftApprovalUtilsConfirming,
    refetch: refetchNFTApprovalUtils,
  } = useNFTApproval(CONTRACTS.V4_UTILS);

  // NFT approval for V4Compoundor - needed for auto-compound to work
  const {
    approveAll: approveNFTForCompoundor,
    isApprovedForAll: isNFTApprovedForCompoundor,
    isPending: nftApprovalCompoundorPending,
    isConfirming: nftApprovalCompoundorConfirming,
    refetch: refetchNFTApprovalCompoundor,
  } = useNFTApproval(CONTRACTS.V4_COMPOUNDOR);

  // Combined NFT approval state for UI
  const isNFTApproved = isNFTApprovedForUtils;
  const approveNFT = approveNFTForUtils;
  const nftApprovalPending = nftApprovalUtilsPending || nftApprovalCompoundorPending;
  const nftApprovalConfirming = nftApprovalUtilsConfirming || nftApprovalCompoundorConfirming;
  const refetchNFTApproval = () => {
    refetchNFTApprovalUtils();
    refetchNFTApprovalCompoundor();
  };

  // Form states
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [activeInput, setActiveInput] = useState<'amount0' | 'amount1' | null>(null);
  const [decreasePercent, setDecreasePercent] = useState(50);

  // Single token deposit mode for increase liquidity
  const [increaseDepositMode, setIncreaseDepositMode] = useState<'single' | 'both'>('both');
  const [singleTokenAddress, setSingleTokenAddress] = useState<string>('');
  const [singleTokenAmount, setSingleTokenAmount] = useState('');

  // Calculate paired amount based on pool ratio (for increase liquidity)
  const calculatePairedAmount = useMemo(() => {
    if (!position) return null;

    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;
    const currentTick = position.currentTick;
    const sqrtPriceX96 = BigInt(position.sqrtPriceX96 || '0');

    if (sqrtPriceX96 === 0n) return null;

    // Calculate sqrt prices for ticks
    const sqrtPriceCurrent = Number(sqrtPriceX96) / (2 ** 96);
    const sqrtPriceLower = Math.sqrt(1.0001 ** tickLower);
    const sqrtPriceUpper = Math.sqrt(1.0001 ** tickUpper);

    const token0Decimals = position.pool.token0.decimals;
    const token1Decimals = position.pool.token1.decimals;

    return {
      fromAmount0ToAmount1: (inputAmount0: string): string => {
        if (!inputAmount0 || parseFloat(inputAmount0) === 0) return '';

        const amount0Wei = parseFloat(inputAmount0);

        // If current tick is below range, only token0 is needed
        if (currentTick <= tickLower) return '0';
        // If current tick is above range, only token1 is needed
        if (currentTick >= tickUpper) return '';

        // Within range: calculate ratio based on liquidity math
        const numerator = sqrtPriceCurrent - sqrtPriceLower;
        const denominator = (1 / sqrtPriceCurrent) - (1 / sqrtPriceUpper);

        if (denominator === 0) return '';

        const ratio = numerator / denominator;
        const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
        const amount1 = amount0Wei * ratio * decimalAdjustment;

        return amount1.toFixed(6);
      },
      fromAmount1ToAmount0: (inputAmount1: string): string => {
        if (!inputAmount1 || parseFloat(inputAmount1) === 0) return '';

        const amount1Wei = parseFloat(inputAmount1);

        // If current tick is below range, only token0 is needed
        if (currentTick <= tickLower) return '';
        // If current tick is above range, only token1 is needed
        if (currentTick >= tickUpper) return '0';

        // Within range: calculate ratio
        const numerator = sqrtPriceCurrent - sqrtPriceLower;
        const denominator = (1 / sqrtPriceCurrent) - (1 / sqrtPriceUpper);

        if (numerator === 0) return '';

        const ratio = numerator / denominator;
        const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
        const amount0 = amount1Wei / ratio / decimalAdjustment;

        return amount0.toFixed(6);
      },
    };
  }, [position]);

  // Auto-calculate paired token amount when user types
  const isAutoCalculating = useMemo(() => ({ current: false }), []);

  useEffect(() => {
    if (!calculatePairedAmount || !activeInput || isAutoCalculating.current) return;

    isAutoCalculating.current = true;

    if (activeInput === 'amount0' && amount0) {
      const calculatedAmount1 = calculatePairedAmount.fromAmount0ToAmount1(amount0);
      if (calculatedAmount1 !== '' && calculatedAmount1 !== amount1) {
        const trimmed = parseFloat(calculatedAmount1).toString();
        setAmount1(trimmed);
      }
    } else if (activeInput === 'amount1' && amount1) {
      const calculatedAmount0 = calculatePairedAmount.fromAmount1ToAmount0(amount1);
      if (calculatedAmount0 !== '' && calculatedAmount0 !== amount0) {
        const trimmed = parseFloat(calculatedAmount0).toString();
        setAmount0(trimmed);
      }
    }

    setTimeout(() => {
      isAutoCalculating.current = false;
    }, 100);
  }, [amount0, amount1, activeInput, calculatePairedAmount, isAutoCalculating]);

  // Compound config form
  const [minCompoundInterval, setMinCompoundInterval] = useState(3600);
  const [minRewardAmount, setMinRewardAmount] = useState('0.001');

  // Range config form
  const [lowerDelta, setLowerDelta] = useState(600);
  const [upperDelta, setUpperDelta] = useState(600);
  const [rebalanceThreshold, setRebalanceThreshold] = useState(100);

  const isPending = utilsPending || compoundPending || rangePending || zapPending || approval0Pending || approval1Pending || nftApprovalPending;
  const isConfirming = utilsConfirming || compoundConfirming || rangeConfirming || zapConfirming || approval0Confirming || approval1Confirming || nftApprovalConfirming;
  const isSuccess = utilsSuccess || compoundSuccess || rangeSuccess || zapSuccess;
  const error = utilsError || compoundError || rangeError;

  // Refetch position data after successful transaction (Bug fix: position value not updating)
  useEffect(() => {
    if (isSuccess) {
      // Delay refetch slightly to allow blockchain state to update
      const timer = setTimeout(() => {
        refetchPositions();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, refetchPositions]);

  if (positionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-primary-500" size={48} />
      </div>
    );
  }

  if (!position) {
    return (
      <div className="space-y-6">
        <Link href="/positions" className="flex items-center gap-2 text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
          Back to Positions
        </Link>
        <div className="card text-center py-12">
          <AlertCircle className="mx-auto mb-4 text-yellow-400" size={48} />
          <h2 className="text-xl font-semibold mb-2">Position Not Found</h2>
          <p className="text-gray-400">Position #{params.id} could not be found.</p>
        </div>
      </div>
    );
  }

  const handleIncreaseLiquidity = async () => {
    if (!tokenId || !amount0 || !amount1) return;

    const amount0Desired = parseUnits(amount0, position.pool.token0.decimals);
    const amount1Desired = parseUnits(amount1, position.pool.token1.decimals);
    const slippageMultiplier = BigInt(10000 + slippage);
    const amount0Max = (amount0Desired * slippageMultiplier) / BigInt(10000);
    const amount1Max = (amount1Desired * slippageMultiplier) / BigInt(10000);

    await increaseLiquidity({
      tokenId,
      amount0Desired,
      amount1Desired,
      amount0Max,
      amount1Max,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
      // Pass currency addresses to detect if native ETH is involved
      currency0: position.pool.token0.address as `0x${string}`,
      currency1: position.pool.token1.address as `0x${string}`,
    });
  };

  // Handle single token increase using zap
  const handleSingleTokenIncrease = async () => {
    if (!address || !singleTokenAddress || !singleTokenAmount || !position) return;

    const isToken0 = singleTokenAddress.toLowerCase() === position.pool.token0.address.toLowerCase();
    const inputTokenData = isToken0 ? position.pool.token0 : position.pool.token1;

    const inputToken: ZapToken = {
      symbol: inputTokenData.symbol,
      address: inputTokenData.address as `0x${string}`,
      decimals: inputTokenData.decimals,
      isNative: inputTokenData.address === '0x0000000000000000000000000000000000000000',
    };

    const targetToken0: ZapToken = {
      symbol: position.pool.token0.symbol,
      address: position.pool.token0.address as `0x${string}`,
      decimals: position.pool.token0.decimals,
      isNative: position.pool.token0.address === '0x0000000000000000000000000000000000000000',
    };

    const targetToken1: ZapToken = {
      symbol: position.pool.token1.symbol,
      address: position.pool.token1.address as `0x${string}`,
      decimals: position.pool.token1.decimals,
      isNative: position.pool.token1.address === '0x0000000000000000000000000000000000000000',
    };

    await executeZap({
      inputToken,
      inputAmount: singleTokenAmount,
      targetToken0,
      targetToken1,
      fee: position.pool.fee,
      rangeStrategy: 'wide', // Use existing position's range logic
      recipient: address,
    });
  };

  const handleDecreaseLiquidity = async () => {
    if (!tokenId || !position.liquidity) return;

    const liquidityToRemove = (BigInt(position.liquidity) * BigInt(decreasePercent)) / BigInt(100);

    // Use the new decreaseLiquidity function that returns BOTH tokens
    await decreaseLiquidity({
      tokenId,
      liquidity: liquidityToRemove,
      amount0Min: BigInt(0),
      amount1Min: BigInt(0),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    });
  };

  const handleCollectFees = async () => {
    if (!tokenId) return;

    await collectFees({
      tokenId,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    });
  };

  const handleEnableCompound = async () => {
    if (!tokenId) return;

    // First check if V4Compoundor is approved for the NFT
    if (!isNFTApprovedForCompoundor) {
      await approveNFTForCompoundor();
      return; // User needs to click again after approval
    }

    await registerCompound({
      tokenId,
      config: {
        enabled: true,
        minCompoundInterval,
        minRewardAmount: parseUnits(minRewardAmount, 18),
      },
    });
  };

  const handleSelfCompound = async () => {
    if (!tokenId) return;

    // First check if V4Compoundor is approved for the NFT
    if (!isNFTApprovedForCompoundor) {
      await approveNFTForCompoundor();
      return; // User needs to click again after approval
    }

    await selfCompound(tokenId);
  };

  const handleDisableCompound = async () => {
    if (!tokenId) return;
    await unregisterCompound(tokenId);
  };

  const handleEnableAutoRange = async () => {
    if (!tokenId) return;

    await configureRange({
      tokenId,
      config: {
        enabled: true,
        lowerDelta,
        upperDelta,
        rebalanceThreshold,
        minRebalanceInterval: 3600,
        collectFeesOnRebalance: true,
        maxSwapSlippage: BigInt(100),
      },
    });
  };

  const handleExecuteRebalance = async () => {
    if (!tokenId) return;
    await executeRebalance(tokenId);
  };

  const handleDisableAutoRange = async () => {
    if (!tokenId) return;
    await removeRange(tokenId);
  };

  const feeTier = (position.pool.fee / 10000).toFixed(2);
  const pairName = `${position.pool.token0.symbol}/${position.pool.token1.symbol}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/positions" className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <div className="flex -space-x-2">
                <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-sm font-bold border-2 border-gray-900">
                  {position.pool.token0.symbol.slice(0, 2)}
                </div>
                <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center text-sm font-bold border-2 border-gray-900">
                  {position.pool.token1.symbol.slice(0, 2)}
                </div>
              </div>
              {pairName}
              <span className="text-sm text-gray-400 bg-gray-800 px-2 py-1 rounded">{feeTier}%</span>
            </h1>
            <p className="text-gray-400">Position ID: #{position.tokenId}</p>
          </div>
        </div>
        <span className={`badge-${position.inRange ? 'success' : 'warning'} text-sm px-3 py-1`}>
          {position.inRange ? 'In Range' : 'Out of Range'}
        </span>
      </div>

      {/* Position Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-gray-400 text-sm">Position Value (Est. USD)</p>
          <p className="text-xl font-semibold">
            ${(() => {
              // Calculate actual position value using LiquidityAmounts math
              const liquidityBigInt = BigInt(position.liquidity || '0');
              const sqrtPriceX96 = BigInt(position.sqrtPriceX96 || '0');

              if (sqrtPriceX96 === 0n || liquidityBigInt === 0n) {
                return '0.00';
              }

              // Use real token prices from API, fallback to 0 to derive from pool price
              const t0Price = token0Price ?? 0;
              const t1Price = token1Price ?? 0;

              const { valueUsd } = getPositionValueUsd(
                liquidityBigInt,
                sqrtPriceX96,
                position.tickLower,
                position.tickUpper,
                position.pool.token0.decimals,
                position.pool.token1.decimals,
                t0Price,
                t1Price
              );

              return valueUsd > 1000 ? valueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })
                : valueUsd > 1 ? valueUsd.toFixed(2)
                : valueUsd > 0.01 ? valueUsd.toFixed(4)
                : '< 0.01';
            })()}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {(() => {
              const liquidityBigInt = BigInt(position.liquidity || '0');
              const sqrtPriceX96 = BigInt(position.sqrtPriceX96 || '0');

              if (sqrtPriceX96 === 0n || liquidityBigInt === 0n) {
                return '0 / 0';
              }

              // Use real token prices from API
              const t0Price = token0Price ?? 0;
              const t1Price = token1Price ?? 0;

              const { amount0, amount1 } = getPositionValueUsd(
                liquidityBigInt,
                sqrtPriceX96,
                position.tickLower,
                position.tickUpper,
                position.pool.token0.decimals,
                position.pool.token1.decimals,
                t0Price,
                t1Price
              );

              const fmt0 = amount0 > 0.001 ? amount0.toFixed(4) : amount0.toExponential(2);
              const fmt1 = amount1 > 0.001 ? amount1.toFixed(2) : amount1.toExponential(2);
              return `${fmt0} ${position.pool.token0.symbol} / ${fmt1} ${position.pool.token1.symbol}`;
            })()}
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Min Price ({position.pool.token1.symbol}/{position.pool.token0.symbol})</p>
          {isFullRangePosition(position.tickLower, position.tickUpper, position.pool.tickSpacing) ? (
            <>
              <p className="text-xl font-semibold text-blue-400">Full Range</p>
              <p className="text-xs text-gray-500">0 (min possible)</p>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold">
                {formatPercentage(tickToPercentage(position.tickLower, position.currentTick, position.pool.token0.decimals, position.pool.token1.decimals))}
              </p>
              <p className="text-xs text-gray-500">
                {formatTickPrice(position.tickLower, position.pool.token0.decimals, position.pool.token1.decimals)}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Max Price ({position.pool.token1.symbol}/{position.pool.token0.symbol})</p>
          {isFullRangePosition(position.tickLower, position.tickUpper, position.pool.tickSpacing) ? (
            <>
              <p className="text-xl font-semibold text-blue-400">Full Range</p>
              <p className="text-xs text-gray-500">∞ (max possible)</p>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold">
                {formatPercentage(tickToPercentage(position.tickUpper, position.currentTick, position.pool.token0.decimals, position.pool.token1.decimals))}
              </p>
              <p className="text-xs text-gray-500">
                {formatTickPrice(position.tickUpper, position.pool.token0.decimals, position.pool.token1.decimals)}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Unclaimed Fees</p>
          <p className="text-xl font-semibold text-green-400">
            {pendingFees ? `${formatUnits(pendingFees[0] || BigInt(0), position.pool.token0.decimals).slice(0, 8)} / ${formatUnits(pendingFees[1] || BigInt(0), position.pool.token1.decimals).slice(0, 8)}` : '0 / 0'}
          </p>
        </div>
      </div>

      {/* NFT Approval Banner */}
      {!isNFTApproved && (
        <div className="card bg-yellow-500/10 border border-yellow-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="text-yellow-400" size={24} />
              <div>
                <p className="font-semibold text-yellow-400">NFT Approval Required</p>
                <p className="text-sm text-gray-400">
                  V4Utils needs permission to manage your positions. This is a one-time approval for all positions.
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                await approveNFT();
                refetchNFTApproval();
              }}
              disabled={isPending || isConfirming}
              className="btn-primary bg-yellow-500 hover:bg-yellow-600 whitespace-nowrap"
            >
              {nftApprovalPending || nftApprovalConfirming ? 'Approving...' : 'Approve V4Utils'}
            </button>
          </div>
        </div>
      )}

      {/* Action Tabs */}
      <div className="card">
        <div className="flex border-b border-gray-800 mb-6 overflow-x-auto">
          {[
            { id: 'quick' as ActionTab, label: 'Quick Actions', icon: Zap },
            { id: 'increase' as ActionTab, label: 'Increase', icon: Plus },
            { id: 'decrease' as ActionTab, label: 'Decrease', icon: Minus },
            { id: 'collect' as ActionTab, label: 'Collect Fees', icon: DollarSign },
            { id: 'compound' as ActionTab, label: 'Auto-Compound', icon: RefreshCw },
            { id: 'range' as ActionTab, label: 'Auto-Range', icon: TrendingUp },
            { id: 'strategy' as ActionTab, label: 'Strategy', icon: Settings },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Transaction Status */}
        {(isPending || isConfirming || isSuccess || error) && (
          <div className={`mb-6 p-4 rounded-lg ${
            error ? 'bg-red-500/10 border border-red-500/20' :
            isSuccess ? 'bg-green-500/10 border border-green-500/20' :
            'bg-blue-500/10 border border-blue-500/20'
          }`}>
            <div className="flex items-center gap-3">
              {isPending && <Loader2 className="animate-spin text-blue-400" size={20} />}
              {isConfirming && <Loader2 className="animate-spin text-blue-400" size={20} />}
              {isSuccess && <CheckCircle className="text-green-400" size={20} />}
              {error && <AlertCircle className="text-red-400" size={20} />}
              <span>
                {isPending && 'Waiting for wallet confirmation...'}
                {isConfirming && 'Transaction confirming...'}
                {isSuccess && 'Transaction successful!'}
                {error && `Error: ${error.message}`}
              </span>
            </div>
          </div>
        )}

        {/* Quick Actions Tab */}
        {activeTab === 'quick' && position && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <OneClickActions
              tokenId={tokenId!}
              liquidity={position.liquidity}
              tickLower={position.tickLower}
              tickUpper={position.tickUpper}
              tickSpacing={position.pool.tickSpacing}
              token0Symbol={position.pool.token0.symbol}
              token1Symbol={position.pool.token1.symbol}
              token0Address={position.pool.token0.address as `0x${string}`}
              token1Address={position.pool.token1.address as `0x${string}`}
              token0Decimals={position.pool.token0.decimals}
              token1Decimals={position.pool.token1.decimals}
              fee={position.pool.fee}
              hooks={position.pool.hooks as `0x${string}`}
              pendingFees={pendingFees}
              isNFTApproved={isNFTApproved}
            />
            <div className="space-y-6">
              <FeeHarvester
                tokenId={tokenId!}
                pendingFees={pendingFees}
                token0Symbol={position.pool.token0.symbol}
                token1Symbol={position.pool.token1.symbol}
                token0Decimals={position.pool.token0.decimals}
                token1Decimals={position.pool.token1.decimals}
                token0Address={position.pool.token0.address as `0x${string}`}
                token1Address={position.pool.token1.address as `0x${string}`}
                isNFTApproved={isNFTApproved}
              />
              <ProfitabilityCalculator
                tokenId={position.tokenId}
                pendingFees={pendingFees}
                token0Symbol={position.pool.token0.symbol}
                token1Symbol={position.pool.token1.symbol}
                token0Decimals={position.pool.token0.decimals}
                token1Decimals={position.pool.token1.decimals}
                liquidity={position.liquidity}
                isCompoundEnabled={position.compoundConfig?.enabled}
              />
            </div>
          </div>
        )}

        {/* Increase Liquidity Tab */}
        {activeTab === 'increase' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Add Liquidity</h3>

            {/* Deposit Mode Toggle */}
            <div className="flex items-center gap-2 p-1 bg-gray-800/50 rounded-xl w-fit">
              <button
                onClick={() => setIncreaseDepositMode('single')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  increaseDepositMode === 'single'
                    ? 'bg-primary-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Zap size={16} />
                Single Token
              </button>
              <button
                onClick={() => setIncreaseDepositMode('both')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  increaseDepositMode === 'both'
                    ? 'bg-primary-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Both Tokens
              </button>
            </div>

            {/* Single Token Mode */}
            {increaseDepositMode === 'single' && (
              <div className="space-y-4">
                <div className="bg-primary-500/10 border border-primary-500/30 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 text-primary-400">
                    <Zap size={14} />
                    <span>Deposit a single token and we&apos;ll automatically swap a portion to add liquidity.</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Select Token</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSingleTokenAddress(position.pool.token0.address)}
                      className={`p-3 rounded-xl border transition-all ${
                        singleTokenAddress === position.pool.token0.address
                          ? 'bg-primary-500/20 border-primary-500 text-white'
                          : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      {position.pool.token0.symbol}
                    </button>
                    <button
                      onClick={() => setSingleTokenAddress(position.pool.token1.address)}
                      className={`p-3 rounded-xl border transition-all ${
                        singleTokenAddress === position.pool.token1.address
                          ? 'bg-primary-500/20 border-primary-500 text-white'
                          : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      {position.pool.token1.symbol}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Amount</label>
                  <input
                    type="number"
                    value={singleTokenAmount}
                    onChange={(e) => setSingleTokenAmount(e.target.value)}
                    placeholder="0.0"
                    className="input w-full"
                  />
                </div>

                <button
                  onClick={handleSingleTokenIncrease}
                  disabled={isPending || isConfirming || !singleTokenAddress || !singleTokenAmount}
                  className="w-full btn-primary flex items-center justify-center gap-2"
                >
                  {(isPending || isConfirming) && <Loader2 className="animate-spin" size={16} />}
                  {isPending ? 'Confirm in Wallet...' : isConfirming ? 'Adding...' : (
                    <>
                      <Zap size={16} />
                      Add Liquidity
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Both Tokens Mode */}
            {increaseDepositMode === 'both' && (
              <>
                {/* Ratio info banner */}
                {calculatePairedAmount && (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2 text-blue-400">
                      <Info size={14} />
                      <span>Amounts are locked to pool ratio. Enter one amount to auto-calculate the other.</span>
                    </div>
                  </div>
                )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="block text-sm text-gray-400">{position.pool.token0.symbol} Amount</label>
                  {activeInput === 'amount1' && amount1 && calculatePairedAmount && (
                    <span className="text-xs bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Lock size={10} />
                      Calculated
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={amount0}
                    onChange={(e) => {
                      if (activeInput === 'amount1' && amount1 && calculatePairedAmount) return;
                      setActiveInput('amount0');
                      setAmount0(e.target.value);
                    }}
                    onFocus={() => {
                      if (!(activeInput === 'amount1' && amount1 && calculatePairedAmount)) {
                        setActiveInput('amount0');
                      }
                    }}
                    placeholder="0.0"
                    readOnly={activeInput === 'amount1' && !!amount1 && !!calculatePairedAmount}
                    className={`input w-full ${
                      activeInput === 'amount1' && amount1 && calculatePairedAmount
                        ? 'bg-gray-900 cursor-not-allowed text-gray-300'
                        : ''
                    }`}
                  />
                  {activeInput === 'amount1' && amount1 && calculatePairedAmount && (
                    <button
                      onClick={() => {
                        setActiveInput('amount0');
                        setAmount1('');
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary-400 hover:text-primary-300"
                    >
                      Edit this
                    </button>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="block text-sm text-gray-400">{position.pool.token1.symbol} Amount</label>
                  {activeInput === 'amount0' && amount0 && calculatePairedAmount && (
                    <span className="text-xs bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Lock size={10} />
                      Calculated
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={amount1}
                    onChange={(e) => {
                      if (activeInput === 'amount0' && amount0 && calculatePairedAmount) return;
                      setActiveInput('amount1');
                      setAmount1(e.target.value);
                    }}
                    onFocus={() => {
                      if (!(activeInput === 'amount0' && amount0 && calculatePairedAmount)) {
                        setActiveInput('amount1');
                      }
                    }}
                    placeholder="0.0"
                    readOnly={activeInput === 'amount0' && !!amount0 && !!calculatePairedAmount}
                    className={`input w-full ${
                      activeInput === 'amount0' && amount0 && calculatePairedAmount
                        ? 'bg-gray-900 cursor-not-allowed text-gray-300'
                        : ''
                    }`}
                  />
                  {activeInput === 'amount0' && amount0 && calculatePairedAmount && (
                    <button
                      onClick={() => {
                        setActiveInput('amount1');
                        setAmount0('');
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary-400 hover:text-primary-300"
                    >
                      Edit this
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Slippage Tolerance</label>
              <div className="flex gap-2">
                {[
                  { value: SLIPPAGE_PRESETS.VERY_LOW, label: '0.1%' },
                  { value: SLIPPAGE_PRESETS.LOW, label: '0.5%' },
                  { value: SLIPPAGE_PRESETS.MEDIUM, label: '1%' },
                  { value: SLIPPAGE_PRESETS.HIGH, label: '3%' },
                ].map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setSlippage(preset.value)}
                    className={`px-3 py-1 rounded ${
                      slippage === preset.value
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Token Approval Section */}
            {amount0 && amount1 && (
              <div className="space-y-2">
                {!isToken0Approved(parseUnits(amount0 || '0', position.pool.token0.decimals)) && (
                  <button
                    onClick={() => approveToken0(parseUnits(amount0, position.pool.token0.decimals) * 2n)}
                    disabled={isPending || isConfirming}
                    className="btn-secondary w-full"
                  >
                    {approval0Pending || approval0Confirming ? 'Approving...' : `Approve ${position.pool.token0.symbol}`}
                  </button>
                )}
                {!isToken1Approved(parseUnits(amount1 || '0', position.pool.token1.decimals)) && (
                  <button
                    onClick={() => approveToken1(parseUnits(amount1, position.pool.token1.decimals) * 2n)}
                    disabled={isPending || isConfirming}
                    className="btn-secondary w-full"
                  >
                    {approval1Pending || approval1Confirming ? 'Approving...' : `Approve ${position.pool.token1.symbol}`}
                  </button>
                )}
              </div>
            )}

            <button
              onClick={handleIncreaseLiquidity}
              disabled={
                isPending ||
                isConfirming ||
                !amount0 ||
                !amount1 ||
                !isNFTApproved ||
                !isToken0Approved(parseUnits(amount0 || '0', position.pool.token0.decimals)) ||
                !isToken1Approved(parseUnits(amount1 || '0', position.pool.token1.decimals))
              }
              className="btn-primary w-full"
            >
              {isPending || isConfirming ? 'Processing...' : !isNFTApproved ? 'Approve NFT First' : 'Add Liquidity'}
            </button>
              </>
            )}
          </div>
        )}

        {/* Decrease Liquidity Tab */}
        {activeTab === 'decrease' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Remove Liquidity</h3>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Amount to Remove: {decreasePercent}%</label>
              <input
                type="range"
                min="1"
                max="100"
                value={decreasePercent}
                onChange={(e) => setDecreasePercent(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-sm text-gray-400 mt-1">
                <span>1%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
              </div>
            </div>
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((percent) => (
                <button
                  key={percent}
                  onClick={() => setDecreasePercent(percent)}
                  className={`px-4 py-2 rounded ${
                    decreasePercent === percent
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {percent}%
                </button>
              ))}
            </div>
            <button
              onClick={handleDecreaseLiquidity}
              disabled={isPending || isConfirming || !isNFTApproved}
              className="btn-primary w-full bg-red-500 hover:bg-red-600"
            >
              {isPending || isConfirming ? 'Processing...' : !isNFTApproved ? 'Approve NFT First' : `Remove ${decreasePercent}% Liquidity`}
            </button>
          </div>
        )}

        {/* Collect Fees Tab */}
        {activeTab === 'collect' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Collect Fees</h3>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <p className="text-gray-400 mb-2">Unclaimed Fees:</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400">{position.pool.token0.symbol}</p>
                  <p className="text-xl font-semibold text-green-400">
                    {pendingFees ? formatUnits(pendingFees[0] || BigInt(0), position.pool.token0.decimals).slice(0, 10) : '0'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400">{position.pool.token1.symbol}</p>
                  <p className="text-xl font-semibold text-green-400">
                    {pendingFees ? formatUnits(pendingFees[1] || BigInt(0), position.pool.token1.decimals).slice(0, 10) : '0'}
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={handleCollectFees}
              disabled={isPending || isConfirming || !isNFTApproved}
              className="btn-primary w-full"
            >
              {isPending || isConfirming ? 'Processing...' : !isNFTApproved ? 'Approve NFT First' : 'Collect All Fees'}
            </button>
          </div>
        )}

        {/* Auto-Compound Tab */}
        {activeTab === 'compound' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Auto-Compound Settings</h3>

            {position.compoundConfig?.enabled ? (
              <div className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-green-400 mb-2">
                    <CheckCircle size={20} />
                    <span className="font-semibold">Auto-Compound Active</span>
                  </div>
                  <p className="text-gray-400 text-sm">Your position fees will be automatically compounded.</p>
                </div>

                <button
                  onClick={handleSelfCompound}
                  disabled={isPending || isConfirming}
                  className="btn-primary w-full"
                >
                  {isPending || isConfirming ? 'Processing...' : 'Compound Now'}
                </button>

                <button
                  onClick={handleDisableCompound}
                  disabled={isPending || isConfirming}
                  className="btn-secondary w-full"
                >
                  Disable Auto-Compound
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Minimum Compound Interval</label>
                  <select
                    value={minCompoundInterval}
                    onChange={(e) => setMinCompoundInterval(Number(e.target.value))}
                    className="input w-full"
                  >
                    <option value={1800}>30 minutes</option>
                    <option value={3600}>1 hour</option>
                    <option value={7200}>2 hours</option>
                    <option value={21600}>6 hours</option>
                    <option value={43200}>12 hours</option>
                    <option value={86400}>24 hours</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Minimum Reward Amount (ETH)</label>
                  <input
                    type="number"
                    value={minRewardAmount}
                    onChange={(e) => setMinRewardAmount(e.target.value)}
                    placeholder="0.001"
                    className="input w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">Minimum fee amount required before compounding</p>
                </div>

                <button
                  onClick={handleEnableCompound}
                  disabled={isPending || isConfirming}
                  className="btn-primary w-full"
                >
                  {isPending || isConfirming ? 'Processing...' : 'Enable Auto-Compound'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Auto-Range Tab */}
        {activeTab === 'range' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Auto-Range Settings</h3>

            {position.rangeConfig?.enabled ? (
              <div className="space-y-4">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-blue-400 mb-2">
                    <TrendingUp size={20} />
                    <span className="font-semibold">Auto-Range Active</span>
                  </div>
                  <p className="text-gray-400 text-sm">Your position will be automatically rebalanced when out of range.</p>
                </div>

                {rebalanceStatus && rebalanceStatus[0] && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                    <p className="text-yellow-400">Position needs rebalancing!</p>
                    <button
                      onClick={handleExecuteRebalance}
                      disabled={isPending || isConfirming}
                      className="btn-primary mt-2"
                    >
                      Rebalance Now
                    </button>
                  </div>
                )}

                <button
                  onClick={handleDisableAutoRange}
                  disabled={isPending || isConfirming}
                  className="btn-secondary w-full"
                >
                  Disable Auto-Range
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Lower Delta (ticks below current)</label>
                  <input
                    type="number"
                    value={lowerDelta}
                    onChange={(e) => setLowerDelta(Number(e.target.value))}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Upper Delta (ticks above current)</label>
                  <input
                    type="number"
                    value={upperDelta}
                    onChange={(e) => setUpperDelta(Number(e.target.value))}
                    className="input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Rebalance Threshold (ticks)</label>
                  <input
                    type="number"
                    value={rebalanceThreshold}
                    onChange={(e) => setRebalanceThreshold(Number(e.target.value))}
                    className="input w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">How many ticks out of range before rebalancing</p>
                </div>

                <button
                  onClick={handleEnableAutoRange}
                  disabled={isPending || isConfirming}
                  className="btn-primary w-full"
                >
                  {isPending || isConfirming ? 'Processing...' : 'Enable Auto-Range'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Strategy Tab */}
        {activeTab === 'strategy' && position && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RangeStrategyBuilder
              tokenId={tokenId!}
              currentTick={Math.floor((position.tickLower + position.tickUpper) / 2)}
              tickLower={position.tickLower}
              tickUpper={position.tickUpper}
              tickSpacing={60}
              isEnabled={position.rangeConfig?.enabled}
            />
            <ProfitabilityCalculator
              tokenId={position.tokenId}
              pendingFees={pendingFees}
              token0Symbol={position.pool.token0.symbol}
              token1Symbol={position.pool.token1.symbol}
              token0Decimals={position.pool.token0.decimals}
              token1Decimals={position.pool.token1.decimals}
              liquidity={position.liquidity}
              isCompoundEnabled={position.compoundConfig?.enabled}
            />
          </div>
        )}
      </div>
    </div>
  );
}
