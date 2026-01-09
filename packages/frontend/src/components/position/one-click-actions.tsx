'use client';

import { useState } from 'react';
import { formatUnits, encodeAbiParameters, keccak256 } from 'viem';
import { usePublicClient, useChainId, useAccount } from 'wagmi';
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  Zap,
  ArrowDownToLine,
  RefreshCw,
  Move,
  Sparkles,
  ArrowRight,
  Shield
} from 'lucide-react';
import { useV4Utils, applySlippage, DEFAULT_SLIPPAGE_BPS } from '@/hooks/useV4Utils';
import { getContracts, CHAIN_IDS } from '@/config/contracts';

// Backend API URL for swap quotes
const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

// WETH addresses per chain
const WETH_ADDRESSES: Record<number, `0x${string}`> = {
  [CHAIN_IDS.BASE]: '0x4200000000000000000000000000000000000006',
  [CHAIN_IDS.SEPOLIA]: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
};

/**
 * Get swap quote from 0x API via backend
 */
async function getSwapQuote(
  sellToken: string,
  buyToken: string,
  sellAmount: bigint,
  chainId: number,
  taker: string
): Promise<{
  router: `0x${string}`;
  data: `0x${string}`;
  expectedOutput: bigint;
  priceImpact: number;
} | null> {
  try {
    console.log('[OneClick] Fetching swap quote:', { sellToken, buyToken, sellAmount: sellAmount.toString(), chainId, taker });
    const response = await fetch(`${BACKEND_URL}/api/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken,
        buyToken,
        sellAmount: sellAmount.toString(),
        chainId,
        taker,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[OneClick] Swap quote failed:', errorText);
      return null;
    }

    const data = await response.json();
    console.log('[OneClick] Swap quote received:', data);
    return {
      router: data.router as `0x${string}`,
      data: data.data as `0x${string}`,
      expectedOutput: BigInt(data.expectedOutput),
      priceImpact: data.priceImpact || 0,
    };
  } catch (error) {
    console.error('[OneClick] Failed to get swap quote:', error);
    return null;
  }
}

interface OneClickActionsProps {
  tokenId: bigint;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  tickSpacing: number;
  token0Symbol: string;
  token1Symbol: string;
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  token0Decimals: number;
  token1Decimals: number;
  fee: number;
  hooks?: `0x${string}`;
  pendingFees?: [bigint, bigint];
  isNFTApproved: boolean;
  onActionComplete?: () => void;
}

// StateView ABI for getting current tick
const STATE_VIEW_ABI = [
  {
    name: 'getSlot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
  },
] as const;

// Compute poolId from poolKey
function computePoolId(
  currency0: `0x${string}`,
  currency1: `0x${string}`,
  fee: number,
  tickSpacing: number,
  hooks: `0x${string}`
): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' },
    ],
    [currency0, currency1, fee, tickSpacing, hooks]
  );
  return keccak256(encoded);
}

// Stablecoin addresses per chain
const STABLECOINS_BY_CHAIN = {
  [CHAIN_IDS.BASE]: [
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`, color: 'from-blue-500 to-blue-600' },
    { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA' as `0x${string}`, color: 'from-blue-400 to-blue-500' },
    { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb' as `0x${string}`, color: 'from-yellow-500 to-yellow-600' },
  ],
  [CHAIN_IDS.SEPOLIA]: [
    { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`, color: 'from-blue-500 to-blue-600' },
    { symbol: 'USDT', address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06' as `0x${string}`, color: 'from-green-500 to-green-600' },
    { symbol: 'DAI', address: '0x68194a729C2450ad26072b3D33ADaCbcef39D574' as `0x${string}`, color: 'from-yellow-500 to-yellow-600' },
  ],
};

export function OneClickActions({
  tokenId,
  liquidity,
  tickLower,
  tickUpper,
  tickSpacing,
  token0Symbol,
  token1Symbol,
  token0Address,
  token1Address,
  token0Decimals,
  token1Decimals,
  fee,
  hooks = '0x0000000000000000000000000000000000000000',
  pendingFees,
  isNFTApproved,
  onActionComplete,
}: OneClickActionsProps) {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [exitToken, setExitToken] = useState<`0x${string}` | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const chainId = useChainId();
  const { address: userAddress } = useAccount();
  const CONTRACTS = getContracts(chainId);
  const publicClient = usePublicClient({ chainId });

  const {
    decreaseLiquidity,
    decreaseAndSwap,
    exitToStablecoin,
    collectFees,
    moveRange,
    isPending,
    isConfirming,
    isSuccess,
    error,
  } = useV4Utils();

  // Get stablecoins for current chain
  const stablecoins = STABLECOINS_BY_CHAIN[chainId as keyof typeof STABLECOINS_BY_CHAIN] || STABLECOINS_BY_CHAIN[CHAIN_IDS.BASE];

  const isProcessing = isPending || isConfirming || swapLoading;
  const hasLiquidity = BigInt(liquidity || '0') > 0n;
  const hasFees = (pendingFees?.[0] || 0n) > 0n || (pendingFees?.[1] || 0n) > 0n;

  // One-Click Exit: Remove all liquidity and get BOTH tokens back
  const handleExitBothTokens = async () => {
    if (!hasLiquidity) return;
    setActiveAction('exit-both');

    // Set minimum amounts to 0 - slippage protection is handled by the contract's maxSwapSlippage
    // We can't easily calculate expected output without sqrtPriceX96
    // The hook applies additional slippage protection
    await decreaseLiquidity({
      tokenId,
      liquidity: BigInt(liquidity),
      amount0Min: 0n, // Contract handles slippage protection
      amount1Min: 0n, // Contract handles slippage protection
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
      slippageBps: DEFAULT_SLIPPAGE_BPS,
    });

    onActionComplete?.();
  };

  // One-Click Exit to single token (swap to one currency)
  const handleExitToSingleToken = async (targetToken: `0x${string}`) => {
    if (!hasLiquidity || !publicClient) return;
    setActiveAction('exit-single');
    setExitToken(targetToken);
    setSwapLoading(true);

    try {
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      const weth = WETH_ADDRESSES[chainId] || WETH_ADDRESSES[CHAIN_IDS.BASE];

      // Determine which token needs to be swapped to the target
      const targetIsToken0 = targetToken.toLowerCase() === token0Address.toLowerCase();
      const sourceToken = targetIsToken0 ? token1Address : token0Address;

      // Estimate the amount of source token we'll receive from decreasing liquidity
      // We use a rough estimation based on position value distribution
      // In V4, liquidity removal gives proportional amounts based on current price
      const poolId = computePoolId(token0Address, token1Address, fee, tickSpacing, hooks);

      const slot0 = await publicClient.readContract({
        address: CONTRACTS.STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      });

      const sqrtPriceX96 = slot0[0];
      const currentTick = Number(slot0[1]);

      // Estimate amounts based on liquidity and tick range
      // For simplicity, we estimate based on the position being ~50% in each token when in range
      const liquidityBigInt = BigInt(liquidity);

      // Calculate estimated amounts from liquidity (simplified estimation)
      // This is an approximation - the actual amounts depend on the exact price within the range
      const Q96 = 2n ** 96n;
      const sqrtPrice = sqrtPriceX96;
      const sqrtRatioA = BigInt(Math.floor(Math.sqrt(1.0001 ** tickLower) * Number(Q96)));
      const sqrtRatioB = BigInt(Math.floor(Math.sqrt(1.0001 ** tickUpper) * Number(Q96)));

      let estimatedAmount0 = 0n;
      let estimatedAmount1 = 0n;

      if (currentTick < tickLower) {
        // Position is below range - all in token0
        estimatedAmount0 = (liquidityBigInt * (sqrtRatioB - sqrtRatioA)) / (sqrtRatioA * sqrtRatioB / Q96);
      } else if (currentTick >= tickUpper) {
        // Position is above range - all in token1
        estimatedAmount1 = (liquidityBigInt * (sqrtRatioB - sqrtRatioA)) / Q96;
      } else {
        // Position is in range - split between both tokens
        const sqrtPriceCurrent = sqrtPrice;
        estimatedAmount0 = (liquidityBigInt * (sqrtRatioB - sqrtPriceCurrent)) / (sqrtPriceCurrent * sqrtRatioB / Q96);
        estimatedAmount1 = (liquidityBigInt * (sqrtPriceCurrent - sqrtRatioA)) / Q96;
      }

      // Determine the swap amount (the non-target token amount)
      const swapAmount = targetIsToken0 ? estimatedAmount1 : estimatedAmount0;

      console.log('[OneClick] Exit to single token:', {
        targetToken,
        targetIsToken0,
        sourceToken,
        estimatedAmount0: estimatedAmount0.toString(),
        estimatedAmount1: estimatedAmount1.toString(),
        swapAmount: swapAmount.toString(),
      });

      let swapData: `0x${string}` = '0x';

      // Only fetch swap quote if there's a meaningful amount to swap
      if (swapAmount > 0n) {
        // Normalize addresses for swap (use WETH instead of zero address)
        const sellTokenAddress = sourceToken.toLowerCase() === ZERO_ADDRESS ? weth : sourceToken;
        const buyTokenAddress = targetToken.toLowerCase() === ZERO_ADDRESS ? weth : targetToken;

        // Fetch swap quote from 0x API via backend
        // Use V4Utils as taker since it executes the swap
        const quote = await getSwapQuote(
          sellTokenAddress,
          buyTokenAddress,
          swapAmount,
          chainId,
          CONTRACTS.V4_UTILS
        );

        if (quote) {
          // Encode router and calldata for the contract
          swapData = encodeAbiParameters(
            [{ type: 'address' }, { type: 'bytes' }],
            [quote.router, quote.data]
          ) as `0x${string}`;
          console.log('[OneClick] Swap data encoded:', swapData.slice(0, 100) + '...');
        } else {
          console.warn('[OneClick] Could not get swap quote, proceeding without swap data');
          // If we can't get a quote but the target IS one of the pool tokens,
          // the user will at least get that portion without the swap
        }
      }

      setSwapLoading(false);

      // Execute the decrease and swap
      await decreaseAndSwap({
        tokenId,
        liquidity: BigInt(liquidity),
        amount0Min: 0n, // Contract handles slippage via maxSwapSlippage
        amount1Min: 0n, // Contract handles slippage via maxSwapSlippage
        deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
        targetCurrency: targetToken,
        slippageBps: DEFAULT_SLIPPAGE_BPS,
        swapData,
      });

      onActionComplete?.();
    } catch (err) {
      console.error('[OneClick] Exit to single token failed:', err);
      setSwapLoading(false);
      throw err;
    }
  };

  // One-Click Exit to Stablecoin (USDC, USDT, DAI)
  const handleExitToStablecoin = async (stablecoinAddress: `0x${string}`) => {
    if (!hasLiquidity || !publicClient) return;
    setActiveAction('exit-stable');
    setExitToken(stablecoinAddress);
    setSwapLoading(true);

    try {
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      const weth = WETH_ADDRESSES[chainId] || WETH_ADDRESSES[CHAIN_IDS.BASE];

      // Get pool state for amount estimation
      const poolId = computePoolId(token0Address, token1Address, fee, tickSpacing, hooks);

      const slot0 = await publicClient.readContract({
        address: CONTRACTS.STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      });

      const sqrtPriceX96 = slot0[0];
      const currentTick = Number(slot0[1]);

      // Estimate amounts based on liquidity and tick range
      const liquidityBigInt = BigInt(liquidity);
      const Q96 = 2n ** 96n;
      const sqrtPrice = sqrtPriceX96;
      const sqrtRatioA = BigInt(Math.floor(Math.sqrt(1.0001 ** tickLower) * Number(Q96)));
      const sqrtRatioB = BigInt(Math.floor(Math.sqrt(1.0001 ** tickUpper) * Number(Q96)));

      let estimatedAmount0 = 0n;
      let estimatedAmount1 = 0n;

      if (currentTick < tickLower) {
        // Position is below range - all in token0
        estimatedAmount0 = (liquidityBigInt * (sqrtRatioB - sqrtRatioA)) / (sqrtRatioA * sqrtRatioB / Q96);
      } else if (currentTick >= tickUpper) {
        // Position is above range - all in token1
        estimatedAmount1 = (liquidityBigInt * (sqrtRatioB - sqrtRatioA)) / Q96;
      } else {
        // Position is in range - split between both tokens
        const sqrtPriceCurrent = sqrtPrice;
        estimatedAmount0 = (liquidityBigInt * (sqrtRatioB - sqrtPriceCurrent)) / (sqrtPriceCurrent * sqrtRatioB / Q96);
        estimatedAmount1 = (liquidityBigInt * (sqrtPriceCurrent - sqrtRatioA)) / Q96;
      }

      console.log('[OneClick] Exit to stablecoin:', {
        stablecoinAddress,
        token0Address,
        token1Address,
        estimatedAmount0: estimatedAmount0.toString(),
        estimatedAmount1: estimatedAmount1.toString(),
      });

      // Check if either token is already the stablecoin (no swap needed)
      const token0IsStable = token0Address.toLowerCase() === stablecoinAddress.toLowerCase();
      const token1IsStable = token1Address.toLowerCase() === stablecoinAddress.toLowerCase();

      let swapData0: `0x${string}` = '0x';
      let swapData1: `0x${string}` = '0x';

      // Fetch swap quote for token0 if it's not the stablecoin and has amount
      if (!token0IsStable && estimatedAmount0 > 0n) {
        const sellToken0 = token0Address.toLowerCase() === ZERO_ADDRESS ? weth : token0Address;

        const quote0 = await getSwapQuote(
          sellToken0,
          stablecoinAddress,
          estimatedAmount0,
          chainId,
          CONTRACTS.V4_UTILS
        );

        if (quote0) {
          swapData0 = encodeAbiParameters(
            [{ type: 'address' }, { type: 'bytes' }],
            [quote0.router, quote0.data]
          ) as `0x${string}`;
          console.log('[OneClick] Swap data0 encoded for token0 -> stablecoin');
        } else {
          console.warn('[OneClick] Could not get swap quote for token0');
        }
      }

      // Fetch swap quote for token1 if it's not the stablecoin and has amount
      if (!token1IsStable && estimatedAmount1 > 0n) {
        const sellToken1 = token1Address.toLowerCase() === ZERO_ADDRESS ? weth : token1Address;

        const quote1 = await getSwapQuote(
          sellToken1,
          stablecoinAddress,
          estimatedAmount1,
          chainId,
          CONTRACTS.V4_UTILS
        );

        if (quote1) {
          swapData1 = encodeAbiParameters(
            [{ type: 'address' }, { type: 'bytes' }],
            [quote1.router, quote1.data]
          ) as `0x${string}`;
          console.log('[OneClick] Swap data1 encoded for token1 -> stablecoin');
        } else {
          console.warn('[OneClick] Could not get swap quote for token1');
        }
      }

      setSwapLoading(false);

      // Execute exit to stablecoin with swap data
      await exitToStablecoin({
        tokenId,
        liquidity: BigInt(liquidity),
        targetStablecoin: stablecoinAddress,
        minAmountOut: 0n, // Contract handles slippage protection
        deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
        swapData0,
        swapData1,
        slippageBps: 100n, // 1% slippage for stablecoins
      });

      onActionComplete?.();
    } catch (err) {
      console.error('[OneClick] Exit to stablecoin failed:', err);
      setSwapLoading(false);
      throw err;
    }
  };

  // One-Click Collect & Compound (collect fees, ready to add back)
  const handleCollectAll = async () => {
    if (!hasFees) return;
    setActiveAction('collect');

    await collectFees({
      tokenId,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
    });

    onActionComplete?.();
  };

  // One-Click Rebalance: Move to centered range around CURRENT tick
  const handleQuickRebalance = async () => {
    if (!hasLiquidity || !publicClient) return;
    setActiveAction('rebalance');

    try {
      // Compute poolId to fetch current tick
      const poolId = computePoolId(
        token0Address,
        token1Address,
        fee,
        tickSpacing,
        hooks
      );

      // Fetch current tick from StateView
      const slot0 = await publicClient.readContract({
        address: CONTRACTS.STATE_VIEW,
        abi: STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      });
      const currentTick = Number(slot0[1]);
      console.log('Current tick:', currentTick);

      // Calculate new range centered around CURRENT tick (not old position)
      const rangeWidth = tickUpper - tickLower;
      const halfWidth = Math.floor(rangeWidth / 2);

      // Align to tick spacing
      let newTickLower = Math.floor((currentTick - halfWidth) / tickSpacing) * tickSpacing;
      let newTickUpper = Math.ceil((currentTick + halfWidth) / tickSpacing) * tickSpacing;

      // Ensure ticks are properly ordered
      if (newTickLower >= newTickUpper) {
        newTickUpper = newTickLower + tickSpacing;
      }

      console.log('Rebalancing: old range', tickLower, '-', tickUpper, '-> new range', newTickLower, '-', newTickUpper);

      await moveRange({
        tokenId,
        newTickLower,
        newTickUpper,
        liquidityToMove: BigInt(liquidity),
        amount0Max: BigInt(2) ** BigInt(128) - BigInt(1), // Max uint128
        amount1Max: BigInt(2) ** BigInt(128) - BigInt(1),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
      });

      onActionComplete?.();
    } catch (e) {
      console.error('Rebalance failed:', e);
      setActiveAction(null);
    }
  };

  return (
    <div className="card-gradient animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
            <Zap className="text-yellow-400" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Quick Actions</h3>
            <p className="text-xs text-gray-400">One-click operations for your position</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Sparkles size={12} />
          <span>Optimized</span>
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
                {swapLoading && 'Fetching swap quote...'}
                {isPending && !swapLoading && 'Waiting for wallet confirmation...'}
                {isConfirming && 'Transaction in progress...'}
                {isSuccess && 'Action completed successfully!'}
                {error && 'Transaction failed'}
              </p>
              {error && <p className="text-xs text-red-400 mt-0.5">{error.message}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Approval Warning */}
      {!isNFTApproved && (
        <div className="bg-gradient-to-r from-amber-500/10 to-yellow-500/5 border border-amber-500/20 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Shield className="text-amber-400" size={16} />
            </div>
            <div>
              <p className="text-sm font-medium text-amber-400">NFT Approval Required</p>
              <p className="text-xs text-gray-400">Approve your position NFT to enable quick actions</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Exit to Both Tokens */}
        <div className="action-card action-card-primary group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center group-hover:from-blue-500/30 group-hover:to-cyan-500/30 transition-all">
                <ArrowDownToLine className="text-blue-400" size={22} />
              </div>
              <div>
                <h4 className="font-semibold text-white flex items-center gap-2">
                  Remove Liquidity
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">Get Both Tokens</span>
                </h4>
                <p className="text-sm text-gray-400">
                  Remove all liquidity and receive {token0Symbol} + {token1Symbol}
                </p>
              </div>
            </div>
            <button
              onClick={handleExitBothTokens}
              disabled={isProcessing || !hasLiquidity || !isNFTApproved}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {isProcessing && activeAction === 'exit-both' ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  Processing
                </>
              ) : (
                <>
                  Remove
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Exit to Single Token */}
        <div className="action-card action-card-info">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
              <ArrowDownToLine className="text-cyan-400" size={22} />
            </div>
            <div>
              <h4 className="font-semibold text-white">Exit to Single Token</h4>
              <p className="text-sm text-gray-400">
                Remove liquidity and swap everything to one token
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleExitToSingleToken(token0Address)}
              disabled={isProcessing || !hasLiquidity || !isNFTApproved}
              className="group relative px-4 py-3 rounded-xl bg-gray-800/50 border border-gray-700/50 hover:border-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 opacity-0 group-hover:opacity-10 transition-opacity" />
              <span className="font-semibold text-white">{token0Symbol}</span>
            </button>
            <button
              onClick={() => handleExitToSingleToken(token1Address)}
              disabled={isProcessing || !hasLiquidity || !isNFTApproved}
              className="group relative px-4 py-3 rounded-xl bg-gray-800/50 border border-gray-700/50 hover:border-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-10 transition-opacity" />
              <span className="font-semibold text-white">{token1Symbol}</span>
            </button>
          </div>
        </div>

        {/* Exit to Stablecoin */}
        <div className="action-card action-card-success">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
              <ArrowDownToLine className="text-green-400" size={22} />
            </div>
            <div>
              <h4 className="font-semibold text-white">Exit to Stablecoin</h4>
              <p className="text-sm text-gray-400">
                Remove liquidity and convert everything to a stablecoin
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {stablecoins.map((stable) => (
              <button
                key={stable.symbol}
                onClick={() => handleExitToStablecoin(stable.address)}
                disabled={isProcessing || !hasLiquidity || !isNFTApproved}
                className="group relative px-4 py-3 rounded-xl bg-gray-800/50 border border-gray-700/50 hover:border-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className={`absolute inset-0 rounded-xl bg-gradient-to-r ${stable.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                <span className="font-semibold text-white">{stable.symbol}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Collect All Fees */}
        <div className="action-card group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center group-hover:from-purple-500/30 group-hover:to-pink-500/30 transition-all">
                <RefreshCw className="text-purple-400" size={22} />
              </div>
              <div>
                <h4 className="font-semibold text-white">Collect All Fees</h4>
                <p className="text-sm text-gray-400">
                  Harvest accumulated trading fees
                </p>
                {hasFees && pendingFees && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                      {formatUnits(pendingFees[0], token0Decimals).slice(0, 8)} {token0Symbol}
                    </span>
                    <span className="text-gray-600">+</span>
                    <span className="text-xs font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                      {formatUnits(pendingFees[1], token1Decimals).slice(0, 8)} {token1Symbol}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={handleCollectAll}
              disabled={isProcessing || !hasFees || !isNFTApproved}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {isProcessing && activeAction === 'collect' ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  Processing
                </>
              ) : (
                <>
                  Collect
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Quick Rebalance */}
        <div className="action-card action-card-warning group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center group-hover:from-orange-500/30 group-hover:to-amber-500/30 transition-all">
                <Move className="text-orange-400" size={22} />
              </div>
              <div>
                <h4 className="font-semibold text-white">Quick Rebalance</h4>
                <p className="text-sm text-gray-400">
                  Re-center your position around current price
                </p>
              </div>
            </div>
            <button
              onClick={handleQuickRebalance}
              disabled={isProcessing || !hasLiquidity || !isNFTApproved}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {isProcessing && activeAction === 'rebalance' ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  Processing
                </>
              ) : (
                <>
                  Rebalance
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-6 pt-4 border-t border-gray-800/50">
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span>All actions execute in a single optimized transaction</span>
        </div>
      </div>
    </div>
  );
}
