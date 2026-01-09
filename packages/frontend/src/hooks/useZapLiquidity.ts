'use client';

import { useState, useCallback } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useChainId, usePublicClient, useAccount } from 'wagmi';
import { parseUnits, encodeAbiParameters, keccak256 } from 'viem';
import { getContracts, CHAIN_IDS } from '@/config/contracts';
import V4UtilsAbi from '@/abis/V4Utils.json';
import StateViewAbi from '@/abis/StateView.json';
import { getTickSpacing, calculateTickRange, getFullRangeTicks } from '@/utils/tickMath';

// 0x AllowanceHolder addresses (v2 API)
// This is the router address that needs to be approved on V4Utils
const ZEROX_ALLOWANCE_HOLDER: Record<number, `0x${string}`> = {
  [CHAIN_IDS.BASE]: '0x0000000000001fF3684f28c67538d4D072C22734',
  [CHAIN_IDS.SEPOLIA]: '0x0000000000001fF3684f28c67538d4D072C22734',
};

// Legacy Exchange Proxy (kept for reference)
const ZEROX_EXCHANGE_PROXY: Record<number, `0x${string}`> = {
  [CHAIN_IDS.BASE]: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
  [CHAIN_IDS.SEPOLIA]: '0xDef1C0ded9bec7F1a1670819833240f027b25EfF',
};

// WETH addresses per chain
const WETH_ADDRESSES: Record<number, `0x${string}`> = {
  [CHAIN_IDS.BASE]: '0x4200000000000000000000000000000000000006',
  [CHAIN_IDS.SEPOLIA]: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
};

// Backend API URL - use same env var as backend.ts
// Remove trailing slash to prevent double-slash in URLs
const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export interface ZapToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  isNative?: boolean;
}

export interface ZapParams {
  inputToken: ZapToken;
  inputAmount: string;
  targetToken0: ZapToken;
  targetToken1: ZapToken;
  fee: number;
  rangeStrategy: 'full' | 'wide' | 'concentrated';
  recipient: `0x${string}`;
}

export interface ZapQuote {
  swapAmount: bigint;
  expectedAmount0: bigint;
  expectedAmount1: bigint;
  swapFromToken: ZapToken;
  swapToToken: ZapToken;
  priceImpact: number;
  estimatedGas: bigint;
}

// Gas estimation multiplier (120% of estimated gas)
const GAS_BUFFER_MULTIPLIER = 120n;

/**
 * Calculate the optimal swap ratio for a given tick range
 */
function calculateOptimalRatio(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number
): { ratio0: number; ratio1: number } {
  const Q96 = 2n ** 96n;
  const price = Number((sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / Q96 / Q96) / 1e18;

  const sqrtRatioA = Math.sqrt(1.0001 ** tickLower);
  const sqrtRatioB = Math.sqrt(1.0001 ** tickUpper);
  const sqrtPrice = Math.sqrt(price);

  if (sqrtPrice <= sqrtRatioA) {
    return { ratio0: 100, ratio1: 0 };
  } else if (sqrtPrice >= sqrtRatioB) {
    return { ratio0: 0, ratio1: 100 };
  }

  // Calculate amounts for unit liquidity
  const amount0 = (1 / sqrtPrice - 1 / sqrtRatioB) * 1e18;
  const amount1 = (sqrtPrice - sqrtRatioA) * 1e18;

  const total = amount0 * price + amount1;
  const ratio0 = Math.round((amount0 * price / total) * 100);
  const ratio1 = 100 - ratio0;

  return { ratio0, ratio1 };
}

/**
 * Get swap quote from 0x API via backend
 */
async function getSwapQuote(
  sellToken: string,
  buyToken: string,
  sellAmount: bigint,
  chainId: number,
  taker: string // Required for 0x API v2
): Promise<{
  router: `0x${string}`;
  data: `0x${string}`;
  expectedOutput: bigint;
  priceImpact: number;
} | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/exchange/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellToken,
        buyToken,
        sellAmount: sellAmount.toString(),
        chainId,
        taker, // Required for 0x API v2
      }),
    });

    if (!response.ok) {
      console.warn('Swap quote failed:', await response.text());
      return null;
    }

    const data = await response.json();
    return {
      router: data.router as `0x${string}`,
      data: data.data as `0x${string}`,
      expectedOutput: BigInt(data.expectedOutput),
      priceImpact: data.priceImpact || 0,
    };
  } catch (error) {
    console.error('Failed to get swap quote:', error);
    return null;
  }
}

export function useZapLiquidity() {
  const chainId = useChainId();
  const { address: userAddress, connector } = useAccount();
  const CONTRACTS = getContracts(chainId);
  const publicClient = usePublicClient({ chainId });
  const { writeContract, writeContractAsync, data: hash, isPending, error } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const [quoteLoading, setQuoteLoading] = useState(false);
  const [zapError, setZapError] = useState<string | null>(null);

  /**
   * Check if a router is approved on V4Utils
   */
  const checkRouterApproved = useCallback(async (router: `0x${string}`): Promise<boolean> => {
    try {
      const isApproved = await publicClient?.readContract({
        address: CONTRACTS.V4_UTILS,
        abi: V4UtilsAbi,
        functionName: 'approvedRouters',
        args: [router],
      });
      return isApproved as boolean;
    } catch (error) {
      console.warn('Failed to check router approval:', error);
      return false;
    }
  }, [publicClient, CONTRACTS]);

  /**
   * Get a quote for the zap operation
   */
  const getZapQuote = useCallback(async (params: ZapParams): Promise<ZapQuote | null> => {
    setQuoteLoading(true);
    setZapError(null);

    try {
      const { inputToken, inputAmount, targetToken0, targetToken1, fee, rangeStrategy } = params;

      // Parse input amount
      const inputAmountWei = parseUnits(inputAmount, inputToken.decimals);

      // Sort tokens for pool key (Uniswap V4 requirement)
      const sortedToken0 = targetToken0.address.toLowerCase() < targetToken1.address.toLowerCase()
        ? targetToken0
        : targetToken1;
      const sortedToken1 = targetToken0.address.toLowerCase() < targetToken1.address.toLowerCase()
        ? targetToken1
        : targetToken0;

      // Get pool state
      const tickSpacing = getTickSpacing(fee);
      const poolId = keccak256(
        encodeAbiParameters(
          [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
          [
            sortedToken0.address,
            sortedToken1.address,
            fee,
            tickSpacing,
            '0x0000000000000000000000000000000000000000' as `0x${string}`,
          ]
        )
      );

      // Read pool slot0
      console.log('=== Zap Debug ===');
      console.log('ChainId:', chainId);
      console.log('StateView:', CONTRACTS.STATE_VIEW);
      console.log('PoolId:', poolId);
      console.log('Token0:', sortedToken0.address);
      console.log('Token1:', sortedToken1.address);
      console.log('Fee:', fee, 'TickSpacing:', tickSpacing);

      if (!publicClient) {
        throw new Error('Public client not available. Please check your wallet connection.');
      }

      let slot0;
      try {
        slot0 = await publicClient.readContract({
          address: CONTRACTS.STATE_VIEW,
          abi: StateViewAbi,
          functionName: 'getSlot0',
          args: [poolId],
        });
      } catch (err: any) {
        console.error('getSlot0 error:', err);
        // Check if pool doesn't exist
        if (err.message?.includes('zero data') || err.message?.includes('0x')) {
          throw new Error(`Pool does not exist on chain ${chainId}. The pool with tokens ${sortedToken0.symbol}/${sortedToken1.symbol} and fee ${fee / 10000}% may not be initialized.`);
        }
        throw err;
      }

      console.log('Slot0 result:', slot0);

      if (!slot0) {
        throw new Error('Pool not found or not initialized');
      }

      const slot0Array = slot0 as readonly [bigint, number, number, number];
      const sqrtPriceX96 = slot0Array[0];
      const currentTick = Number(slot0Array[1]);

      if (sqrtPriceX96 === 0n) {
        throw new Error('Pool not initialized');
      }

      // Calculate tick range based on strategy
      let tickLower: number;
      let tickUpper: number;

      if (rangeStrategy === 'full') {
        [tickLower, tickUpper] = getFullRangeTicks(tickSpacing);
      } else if (rangeStrategy === 'wide') {
        [tickLower, tickUpper] = calculateTickRange(currentTick, tickSpacing, 2000);
      } else {
        // concentrated
        [tickLower, tickUpper] = calculateTickRange(currentTick, tickSpacing, 100);
      }

      // Calculate optimal ratio for the range
      const { ratio0, ratio1 } = calculateOptimalRatio(sqrtPriceX96, tickLower, tickUpper);

      // Handle native ETH - treat 0x0 as WETH for swap purposes
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      const weth = WETH_ADDRESSES[chainId];

      const normalizedInputAddress = inputToken.address.toLowerCase() === ZERO_ADDRESS
        ? weth.toLowerCase()
        : inputToken.address.toLowerCase();
      const normalizedToken0Address = sortedToken0.address.toLowerCase() === ZERO_ADDRESS
        ? weth.toLowerCase()
        : sortedToken0.address.toLowerCase();
      const normalizedToken1Address = sortedToken1.address.toLowerCase() === ZERO_ADDRESS
        ? weth.toLowerCase()
        : sortedToken1.address.toLowerCase();

      const inputMatchesToken0 = normalizedInputAddress === normalizedToken0Address;
      const inputMatchesToken1 = normalizedInputAddress === normalizedToken1Address;

      if (!inputMatchesToken0 && !inputMatchesToken1) {
        throw new Error('Input token must be one of the pool tokens');
      }

      // Calculate swap amount based on ratios
      let swapAmount: bigint;
      let swapFromToken: ZapToken;
      let swapToToken: ZapToken;

      if (inputMatchesToken0) {
        // Input is token0, need to swap some to token1
        // We need ratio1% of value in token1
        swapAmount = (inputAmountWei * BigInt(ratio1)) / 100n;
        swapFromToken = sortedToken0;
        swapToToken = sortedToken1;
      } else {
        // Input is token1, need to swap some to token0
        // We need ratio0% of value in token0
        swapAmount = (inputAmountWei * BigInt(ratio0)) / 100n;
        swapFromToken = sortedToken1;
        swapToToken = sortedToken0;
      }

      // Get expected output from swap
      let expectedSwapOutput = 0n;
      let priceImpact = 0;

      if (swapAmount > 0n) {
        const sellTokenAddress = swapFromToken.isNative
          ? weth
          : swapFromToken.address;
        const buyTokenAddress = swapToToken.isNative
          ? weth
          : swapToToken.address;

        // Use V4Utils as taker since it executes the swap
        const quote = await getSwapQuote(sellTokenAddress, buyTokenAddress, swapAmount, chainId, CONTRACTS.V4_UTILS);
        if (quote) {
          expectedSwapOutput = quote.expectedOutput;
          priceImpact = quote.priceImpact;
        }
      }

      // Calculate expected final amounts
      let expectedAmount0: bigint;
      let expectedAmount1: bigint;

      if (inputMatchesToken0) {
        expectedAmount0 = inputAmountWei - swapAmount;
        expectedAmount1 = expectedSwapOutput;
      } else {
        expectedAmount0 = expectedSwapOutput;
        expectedAmount1 = inputAmountWei - swapAmount;
      }

      setQuoteLoading(false);

      return {
        swapAmount,
        expectedAmount0,
        expectedAmount1,
        swapFromToken,
        swapToToken,
        priceImpact,
        estimatedGas: 500000n, // Estimated gas for zap operation
      };
    } catch (err: any) {
      console.error('Zap quote error:', err);
      setZapError(err.message || 'Failed to get zap quote');
      setQuoteLoading(false);
      return null;
    }
  }, [chainId, CONTRACTS, publicClient]);

  /**
   * Execute the zap operation
   */
  const executeZap = useCallback(async (params: ZapParams): Promise<void> => {
    setZapError(null);

    try {
      const { inputToken, inputAmount, targetToken0, targetToken1, fee, rangeStrategy, recipient } = params;

      // Parse input amount
      const inputAmountWei = parseUnits(inputAmount, inputToken.decimals);

      // Sort tokens for pool key
      const sortedToken0 = targetToken0.address.toLowerCase() < targetToken1.address.toLowerCase()
        ? targetToken0
        : targetToken1;
      const sortedToken1 = targetToken0.address.toLowerCase() < targetToken1.address.toLowerCase()
        ? targetToken1
        : targetToken0;

      // Get pool state
      const tickSpacing = getTickSpacing(fee);
      const poolId = keccak256(
        encodeAbiParameters(
          [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
          [
            sortedToken0.address,
            sortedToken1.address,
            fee,
            tickSpacing,
            '0x0000000000000000000000000000000000000000' as `0x${string}`,
          ]
        )
      );

      // Read pool slot0
      console.log('=== ExecuteZap Debug ===');
      console.log('ChainId:', chainId);
      console.log('StateView:', CONTRACTS.STATE_VIEW);
      console.log('PoolId:', poolId);
      console.log('Token0:', sortedToken0.address);
      console.log('Token1:', sortedToken1.address);
      console.log('Fee:', fee, 'TickSpacing:', tickSpacing);

      if (!publicClient) {
        throw new Error('Public client not available. Please check your wallet connection.');
      }

      let slot0;
      try {
        slot0 = await publicClient.readContract({
          address: CONTRACTS.STATE_VIEW,
          abi: StateViewAbi,
          functionName: 'getSlot0',
          args: [poolId],
        });
      } catch (err: any) {
        console.error('getSlot0 error in executeZap:', err);
        if (err.message?.includes('zero data') || err.message?.includes('0x')) {
          throw new Error(`Pool does not exist on chain ${chainId}. Please select a pool that is initialized.`);
        }
        throw err;
      }

      console.log('Slot0 result:', slot0);

      if (!slot0) {
        throw new Error('Pool not found');
      }

      const slot0Array = slot0 as readonly [bigint, number, number, number];
      const sqrtPriceX96 = slot0Array[0];
      const currentTick = Number(slot0Array[1]);

      if (sqrtPriceX96 === 0n) {
        throw new Error('Pool not initialized');
      }

      // Calculate tick range
      let tickLower: number;
      let tickUpper: number;

      if (rangeStrategy === 'full') {
        [tickLower, tickUpper] = getFullRangeTicks(tickSpacing);
      } else if (rangeStrategy === 'wide') {
        [tickLower, tickUpper] = calculateTickRange(currentTick, tickSpacing, 2000);
      } else {
        [tickLower, tickUpper] = calculateTickRange(currentTick, tickSpacing, 100);
      }

      // Calculate optimal ratio
      const { ratio0, ratio1 } = calculateOptimalRatio(sqrtPriceX96, tickLower, tickUpper);

      console.log('=== Zap Debug ===');
      console.log('sqrtPriceX96:', sqrtPriceX96.toString());
      console.log('tickLower:', tickLower, 'tickUpper:', tickUpper);
      console.log('ratio0:', ratio0, 'ratio1:', ratio1);

      // Handle native ETH
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
      const weth = WETH_ADDRESSES[chainId];

      const normalizedInputAddress = inputToken.address.toLowerCase() === ZERO_ADDRESS
        ? weth.toLowerCase()
        : inputToken.address.toLowerCase();
      const normalizedToken0Address = sortedToken0.address.toLowerCase() === ZERO_ADDRESS
        ? weth.toLowerCase()
        : sortedToken0.address.toLowerCase();

      const inputMatchesToken0 = normalizedInputAddress === normalizedToken0Address;

      // Calculate swap amount
      let swapAmount: bigint;
      let swapSourceCurrency: `0x${string}`;

      if (inputMatchesToken0) {
        swapAmount = (inputAmountWei * BigInt(ratio1)) / 100n;
        swapSourceCurrency = sortedToken0.address;
      } else {
        swapAmount = (inputAmountWei * BigInt(ratio0)) / 100n;
        swapSourceCurrency = sortedToken1.address;
      }

      console.log('inputMatchesToken0:', inputMatchesToken0);
      console.log('inputAmountWei:', inputAmountWei.toString());
      console.log('swapAmount:', swapAmount.toString());

      // Get swap data from 0x API
      let swapData: `0x${string}` = '0x';

      if (swapAmount > 0n) {
        const swapFromAddress = inputMatchesToken0 ? sortedToken0.address : sortedToken1.address;
        const swapToAddress = inputMatchesToken0 ? sortedToken1.address : sortedToken0.address;

        const sellToken = swapFromAddress.toLowerCase() === ZERO_ADDRESS ? weth : swapFromAddress;
        const buyToken = swapToAddress.toLowerCase() === ZERO_ADDRESS ? weth : swapToAddress;

        // Use V4Utils as taker since it executes the swap on behalf of user
        const quote = await getSwapQuote(sellToken, buyToken, swapAmount, chainId, CONTRACTS.V4_UTILS);
        if (quote) {
          // Check if the router is approved on V4Utils
          const routerApproved = await checkRouterApproved(quote.router as `0x${string}`);
          if (!routerApproved) {
            const allowanceHolder = ZEROX_ALLOWANCE_HOLDER[chainId];
            throw new Error(
              `Swap router (${quote.router}) is not approved on V4Utils. ` +
              `The contract owner needs to call setRouterApproval(${allowanceHolder || quote.router}, true) to enable One-Click Zap.`
            );
          }

          // Encode router and data for V4Utils contract
          swapData = encodeAbiParameters(
            [{ type: 'address' }, { type: 'bytes' }],
            [quote.router, quote.data]
          ) as `0x${string}`;
        } else {
          throw new Error('Failed to get swap quote from 0x. Please try again.');
        }
      }

      // Calculate expected amounts (with 10% buffer for slippage)
      let amount0Desired: bigint;
      let amount1Desired: bigint;

      if (inputMatchesToken0) {
        amount0Desired = inputAmountWei - swapAmount;
        amount1Desired = 0n; // Will be filled by swap
      } else {
        amount0Desired = 0n; // Will be filled by swap
        amount1Desired = inputAmountWei - swapAmount;
      }

      // PoolKey struct
      const poolKey = {
        currency0: sortedToken0.address,
        currency1: sortedToken1.address,
        fee,
        tickSpacing,
        hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      };

      // SwapAndMintParams struct
      const swapAndMintParams = {
        poolKey,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Max: inputMatchesToken0 ? inputAmountWei : (inputAmountWei * 110n) / 100n,
        amount1Max: inputMatchesToken0 ? (inputAmountWei * 110n) / 100n : inputAmountWei,
        recipient,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour
        swapSourceCurrency,
        swapSourceAmount: swapAmount,
        swapData,
        maxSwapSlippage: 100n, // 1% slippage
      };

      // Calculate ETH value to send
      const inputIsNative = inputToken.address.toLowerCase() === ZERO_ADDRESS;
      const ethValue = inputIsNative ? inputAmountWei : 0n;

      console.log('=== Final Params ===');
      console.log('amount0Desired:', amount0Desired.toString());
      console.log('amount1Desired:', amount1Desired.toString());
      console.log('swapSourceAmount:', swapAmount.toString());
      console.log('swapSourceCurrency:', swapSourceCurrency);
      console.log('ethValue:', ethValue.toString());

      // Estimate gas
      let gasLimit = 5000000n;
      try {
        if (publicClient) {
          console.log('[Zap] Estimating gas for swapAndMint...');
          const estimated = await publicClient.estimateContractGas({
            address: CONTRACTS.V4_UTILS,
            abi: V4UtilsAbi,
            functionName: 'swapAndMint',
            args: [swapAndMintParams],
            value: ethValue,
          });
          gasLimit = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
          console.log('[Zap] Gas estimated:', gasLimit.toString());
        }
      } catch (e) {
        console.warn('[Zap] Gas estimation failed, using fallback:', e);
        // Don't throw - continue with fallback gas limit
      }

      // Execute transaction
      console.log('[Zap] Calling writeContractAsync for swapAndMint...');
      console.log('[Zap] Contract:', CONTRACTS.V4_UTILS);
      console.log('[Zap] Gas limit:', gasLimit.toString());
      console.log('[Zap] ETH value:', ethValue.toString());
      console.log('[Zap] userAddress:', userAddress);
      console.log('[Zap] connector:', connector?.name);

      try {
        // Use writeContractAsync with explicit account for Privy/MetaMask compatibility
        const txHash = await writeContractAsync({
          chainId,
          address: CONTRACTS.V4_UTILS,
          abi: V4UtilsAbi,
          functionName: 'swapAndMint',
          args: [swapAndMintParams],
          value: ethValue,
          gas: gasLimit,
          account: userAddress, // Explicitly pass account for Privy/MetaMask
        });
        console.log('[Zap] Transaction hash:', txHash);
        // Don't return - function returns void, hash is available via hook
      } catch (writeError) {
        console.error('[Zap] writeContractAsync error:', writeError);
        throw writeError;
      }
    } catch (err: any) {
      console.error('Zap execution error:', err);
      setZapError(err.message || 'Failed to execute zap');
      throw err;
    }
  }, [chainId, CONTRACTS, publicClient, writeContractAsync, checkRouterApproved, userAddress, connector]);

  return {
    getZapQuote,
    executeZap,
    checkRouterApproved,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error: error || (zapError ? new Error(zapError) : null),
    quoteLoading,
  };
}
