'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccount, useReadContract, useBalance, useChainId } from 'wagmi';
import { Plus, Loader2, AlertCircle, Info, Zap, ArrowRight, ChevronDown } from 'lucide-react';
import { parseUnits, formatUnits, keccak256, encodeAbiParameters } from 'viem';
import { useV4Utils } from '@/hooks/useV4Utils';
import { useZapLiquidity, ZapToken, ZapQuote } from '@/hooks/useZapLiquidity';
import { useTokenApproval } from '@/hooks/useTokenApproval';
import { useToast } from '@/components/common/toast';
import { getContracts, CHAIN_IDS } from '@/config/contracts';
import { TOKENS_BY_CHAIN } from '@/config/tokens';
import ERC20Abi from '@/abis/ERC20.json';
import StateViewAbi from '@/abis/StateView.json';
import { getTickSpacing, calculateTickRange, getFullRangeTicks, getTickFromSqrtPrice } from '@/utils/tickMath';

const FEE_TIERS = [
  { label: '0.05%', value: 500 },
  { label: '0.30%', value: 3000 },
  { label: '1.00%', value: 10000 },
];

export default function InitiatorPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [depositMode, setDepositMode] = useState<'single' | 'both'>('both');

  // Parse URL parameters (from pools page navigation)
  const searchParams = useSearchParams();
  const urlToken0 = searchParams.get('token0');
  const urlToken1 = searchParams.get('token1');
  const urlFee = searchParams.get('fee');
  const hasPoolParams = !!(urlToken0 && urlToken1 && urlFee);

  // Get tokens for current chain
  const TOKENS = useMemo(() => TOKENS_BY_CHAIN[chainId] || TOKENS_BY_CHAIN[CHAIN_IDS.BASE], [chainId]);

  // Form state
  const [token0, setToken0] = useState('');
  const [token1, setToken1] = useState('');
  const [fee, setFee] = useState(3000); // Default to 0.30% fee tier
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [activeInput, setActiveInput] = useState<'amount0' | 'amount1' | null>(null);

  // Single token zap state
  const [singleTokenAddress, setSingleTokenAddress] = useState<string>('');
  const [singleTokenAmount, setSingleTokenAmount] = useState('');
  const [zapQuote, setZapQuote] = useState<ZapQuote | null>(null);

  // Reset tokens when chain changes (only if not coming from pools page with params)
  useEffect(() => {
    if (!hasPoolParams) {
      setToken0('');
      setToken1('');
    }
  }, [chainId, hasPoolParams]);

  // Initialize state from URL params when coming from pools page
  useEffect(() => {
    if (hasPoolParams && urlToken0 && urlToken1 && urlFee) {
      // Find matching tokens from TOKENS list
      const t0 = TOKENS.find(t =>
        t.address.toLowerCase() === urlToken0.toLowerCase()
      );
      const t1 = TOKENS.find(t =>
        t.address.toLowerCase() === urlToken1.toLowerCase()
      );

      // Set tokens and fee
      setToken0(urlToken0);
      setToken1(urlToken1);
      const parsedFee = parseInt(urlFee);
      if (!isNaN(parsedFee)) {
        setFee(parsedFee);
      }

      // Skip to step 2 (range selection) when pool is preselected
      if (t0 && t1) {
        setStep(2);
        // Default single token to token0
        setSingleTokenAddress(urlToken0);
      }
    }
  }, [hasPoolParams, urlToken0, urlToken1, urlFee, TOKENS]);

  const { mintPosition, isPending, isConfirming, isSuccess, hash } = useV4Utils();

  // Zap liquidity hook for single-token deposits
  const {
    getZapQuote,
    executeZap,
    quoteLoading: zapQuoteLoading,
    isPending: zapIsPending,
    isConfirming: zapIsConfirming,
    isSuccess: zapIsSuccess,
    hash: zapHash,
    error: zapError,
  } = useZapLiquidity();

  // Get token data from TOKENS list
  const token0Data = useMemo(() => {
    if (!token0) return undefined;
    return TOKENS.find(t => t.address.toLowerCase() === token0.toLowerCase());
  }, [TOKENS, token0]);

  const token1Data = useMemo(() => {
    if (!token1) return undefined;
    return TOKENS.find(t => t.address.toLowerCase() === token1.toLowerCase());
  }, [TOKENS, token1]);

  // Check if tokens are native ETH
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const token0IsNative = token0 ? token0.toLowerCase() === ZERO_ADDRESS : (token0Data?.isNative || false);
  const token1IsNative = token1 ? token1.toLowerCase() === ZERO_ADDRESS : (token1Data?.isNative || false);

  // Debug logging for balance checking
  console.log('=== Balance Debug ===');
  console.log('token0:', token0, 'isNative:', token0IsNative);
  console.log('token1:', token1, 'isNative:', token1IsNative);

  // Read native ETH balance
  const { data: ethBalance } = useBalance({
    address: address,
    query: {
      enabled: !!address && (token0IsNative || token1IsNative),
    },
  });

  // Read ERC20 token balances (only for non-native tokens)
  const { data: balance0ERC20 } = useReadContract({
    address: token0 as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!token0 && !token0IsNative,
    },
  });

  const { data: balance1ERC20 } = useReadContract({
    address: token1 as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!token1 && !token1IsNative,
    },
  });

  // Use native ETH balance for native tokens, ERC20 balance otherwise
  const balance0 = token0IsNative ? ethBalance?.value : balance0ERC20;
  const balance1 = token1IsNative ? ethBalance?.value : balance1ERC20;

  // Debug logging for balances
  console.log('ethBalance:', ethBalance?.value?.toString());
  console.log('balance0ERC20:', balance0ERC20?.toString());
  console.log('balance1ERC20:', balance1ERC20?.toString());
  console.log('final balance0:', balance0?.toString());
  console.log('final balance1:', balance1?.toString());

  const {
    approve: approveToken0,
    isApproved: isToken0Approved,
    isPending: isPendingApproval0
  } = useTokenApproval(token0 as `0x${string}`, CONTRACTS.V4_UTILS);

  const {
    approve: approveToken1,
    isApproved: isToken1Approved,
    isPending: isPendingApproval1
  } = useTokenApproval(token1 as `0x${string}`, CONTRACTS.V4_UTILS);


  // Get pool info to determine current tick
  const sortedToken0 = token0 && token1 && token0.toLowerCase() < token1.toLowerCase() ? token0 : token1;
  const sortedToken1 = token0 && token1 && token0.toLowerCase() < token1.toLowerCase() ? token1 : token0;

  const poolId = sortedToken0 && sortedToken1 ? keccak256(
    encodeAbiParameters(
      [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ],
      [
        sortedToken0 as `0x${string}`,
        sortedToken1 as `0x${string}`,
        fee,
        getTickSpacing(fee),
        '0x0000000000000000000000000000000000000000' as `0x${string}`,
      ]
    )
  ) : null;

  const { data: slot0Data, isLoading: isLoadingSlot0 } = useReadContract({
    address: CONTRACTS.STATE_VIEW,
    abi: StateViewAbi,
    functionName: 'getSlot0',
    args: poolId ? [poolId] : undefined,
    query: {
      // Load slot0 data as soon as we have tokens and a range strategy selected (step 2+)
      enabled: !!poolId && step >= 2,
    },
  });

  // Extract current tick from slot0 - slot0Data is [sqrtPriceX96, tick, protocolFee, lpFee]
  const slot0Array = slot0Data as readonly [bigint, number, number, number] | undefined;
  const currentTick = slot0Array ? Number(slot0Array[1]) : 0;
  const currentSqrtPriceX96 = slot0Array ? slot0Array[0] : BigInt(0);

  // Calculate pool price and check if it's realistic
  const poolPriceInfo = (() => {
    if (!currentSqrtPriceX96 || currentSqrtPriceX96 === BigInt(0)) {
      return { price: 0, isRealistic: false, warning: 'Pool not initialized' };
    }

    const Q96 = BigInt(2) ** BigInt(96);
    const sqrtPrice = Number(currentSqrtPriceX96) / Number(Q96);
    const rawPrice = sqrtPrice * sqrtPrice;

    // Get decimals for sorted tokens
    const sortedToken0Data = sortedToken0 === token0 ? token0Data : token1Data;
    const sortedToken1Data = sortedToken0 === token0 ? token1Data : token0Data;

    if (!sortedToken0Data || !sortedToken1Data) {
      return { price: 0, isRealistic: false, warning: 'Token data not available' };
    }

    const decimalAdjustment = Math.pow(10, sortedToken0Data.decimals - sortedToken1Data.decimals);
    const adjustedPrice = rawPrice * decimalAdjustment;

    // For ETH/USDC or WETH/USDC pools, price should be roughly 0.0001-0.001 (USDC per ETH = 1000-10000)
    // The inverse (ETH per USDC) should be ~7000 currently
    const isEthUsdcPool = (sortedToken0Data.symbol === 'ETH' || sortedToken0Data.symbol === 'WETH' ||
                          sortedToken1Data.symbol === 'ETH' || sortedToken1Data.symbol === 'WETH') &&
                         (sortedToken0Data.symbol === 'USDC' || sortedToken1Data.symbol === 'USDC');

    let isRealistic = true;
    let warning = '';
    let displayPrice = adjustedPrice;

    if (isEthUsdcPool) {
      // Check if ETH price is between $100 and $100,000
      const ethPriceUsd = sortedToken0Data.symbol === 'USDC' ? 1 / adjustedPrice : adjustedPrice;
      if (ethPriceUsd < 100 || ethPriceUsd > 100000) {
        isRealistic = false;
        warning = `Pool price is unrealistic (1 ETH = $${ethPriceUsd.toExponential(2)}). This pool may have been initialized incorrectly. Use ETH/USDC 0.3% pool instead.`;
      }
      displayPrice = ethPriceUsd;
    }

    return { price: displayPrice, isRealistic, warning, rawPrice: adjustedPrice };
  })();

  // Calculate token ratio based on current price and tick range
  const calculatePairedAmount = useMemo(() => {
    if (!currentSqrtPriceX96 || currentSqrtPriceX96 === BigInt(0) || !token0Data || !token1Data || !minPrice) {
      return null;
    }

    const tickSpacing = getTickSpacing(fee);
    let tickLower: number;
    let tickUpper: number;

    if (minPrice === 'full') {
      [tickLower, tickUpper] = getFullRangeTicks(tickSpacing);
    } else if (minPrice === 'wide') {
      [tickLower, tickUpper] = calculateTickRange(currentTick, tickSpacing, 2000);
    } else if (minPrice === 'concentrated') {
      [tickLower, tickUpper] = calculateTickRange(currentTick, tickSpacing, 100);
    } else {
      return null;
    }

    // Calculate sqrt prices for range bounds
    const sqrtPriceLower = Math.sqrt(1.0001 ** tickLower);
    const sqrtPriceUpper = Math.sqrt(1.0001 ** tickUpper);
    const Q96 = BigInt(2) ** BigInt(96);
    const sqrtPriceCurrent = Number(currentSqrtPriceX96) / Number(Q96);

    // Determine if we're in range
    const currentTickNum = currentTick;

    // Get sorted token data for proper calculation
    const sortedToken0Data = sortedToken0 === token0 ? token0Data : token1Data;
    const sortedToken1Data = sortedToken0 === token0 ? token1Data : token0Data;
    const isSorted = sortedToken0 === token0;

    return {
      // Calculate amount1 from amount0
      fromAmount0ToAmount1: (inputAmount0: string): string => {
        if (!inputAmount0 || parseFloat(inputAmount0) === 0) return '';

        const amount0Wei = parseFloat(inputAmount0);

        // If current tick is below range, only token0 is needed
        if (currentTickNum <= tickLower) {
          return '0';
        }
        // If current tick is above range, only token1 is needed
        if (currentTickNum >= tickUpper) {
          return ''; // Can't calculate - need to show that position is out of range
        }

        // Within range: calculate ratio
        // amount0 = L * (1/sqrtP - 1/sqrtPu)
        // amount1 = L * (sqrtP - sqrtPl)
        // ratio = amount1/amount0 = (sqrtP - sqrtPl) / (1/sqrtP - 1/sqrtPu)
        const numerator = sqrtPriceCurrent - sqrtPriceLower;
        const denominator = (1 / sqrtPriceCurrent) - (1 / sqrtPriceUpper);

        if (denominator === 0) return '';

        const ratio = numerator / denominator;

        // Adjust for decimal differences between tokens
        const decimalAdjustment = Math.pow(10, sortedToken0Data.decimals - sortedToken1Data.decimals);
        const amount1 = amount0Wei * ratio * decimalAdjustment;

        // If tokens were swapped in sorting, swap the result
        if (!isSorted) {
          return (amount0Wei / ratio / decimalAdjustment).toFixed(6);
        }

        return amount1.toFixed(6);
      },
      // Calculate amount0 from amount1
      fromAmount1ToAmount0: (inputAmount1: string): string => {
        if (!inputAmount1 || parseFloat(inputAmount1) === 0) return '';

        const amount1Wei = parseFloat(inputAmount1);

        // If current tick is below range, only token0 is needed
        if (currentTickNum <= tickLower) {
          return ''; // Can't calculate - only token0 needed
        }
        // If current tick is above range, only token1 is needed
        if (currentTickNum >= tickUpper) {
          return '0';
        }

        // Within range: calculate ratio
        const numerator = sqrtPriceCurrent - sqrtPriceLower;
        const denominator = (1 / sqrtPriceCurrent) - (1 / sqrtPriceUpper);

        if (numerator === 0) return '';

        const ratio = numerator / denominator;

        // Adjust for decimal differences between tokens
        const decimalAdjustment = Math.pow(10, sortedToken0Data.decimals - sortedToken1Data.decimals);
        const amount0 = amount1Wei / ratio / decimalAdjustment;

        // If tokens were swapped in sorting, swap the result
        if (!isSorted) {
          return (amount1Wei * ratio * decimalAdjustment).toFixed(6);
        }

        return amount0.toFixed(6);
      },
      tickLower,
      tickUpper,
      sqrtPriceCurrent,
      sqrtPriceLower,
      sqrtPriceUpper,
    };
  }, [currentSqrtPriceX96, currentTick, token0Data, token1Data, minPrice, fee, sortedToken0, token0]);

  // Auto-calculate paired token amount when user types
  // Use refs to prevent infinite loops
  const isAutoCalculating = useMemo(() => ({ current: false }), []);

  useEffect(() => {
    if (!calculatePairedAmount || !activeInput || isAutoCalculating.current) return;

    isAutoCalculating.current = true;

    if (activeInput === 'amount0' && amount0) {
      const calculatedAmount1 = calculatePairedAmount.fromAmount0ToAmount1(amount0);
      if (calculatedAmount1 !== '' && calculatedAmount1 !== amount1) {
        // Trim trailing zeros for cleaner display
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

    // Reset flag after a short delay to allow the state to settle
    setTimeout(() => {
      isAutoCalculating.current = false;
    }, 100);
  }, [amount0, amount1, activeInput, calculatePairedAmount, isAutoCalculating]);

  // Handle transaction success
  useEffect(() => {
    if (isSuccess && hash) {
      showToast({
        type: 'success',
        message: 'Position created successfully!',
        txHash: hash,
        chainId,
      });
      // Reset form
      setTimeout(() => {
        setStep(1);
        setToken0('');
        setToken1('');
        setAmount0('');
        setAmount1('');
        setMinPrice('');
        setMaxPrice('');
      }, 2000);
    }
  }, [isSuccess, hash, showToast, chainId]);

  const handleApprovals = async () => {
    if (!address || !token0Data || !token1Data) return;

    try {
      const amount0Wei = parseUnits(amount0, token0Data.decimals);
      const amount1Wei = parseUnits(amount1, token1Data.decimals);

      // Approve token 0 (skip if native ETH - no approval needed)
      if (!token0IsNative && !isToken0Approved(amount0Wei)) {
        showToast({ type: 'info', message: `Approving ${token0Data.symbol}...` });
        await approveToken0(amount0Wei);
      }

      // Approve token 1 (skip if native ETH - no approval needed)
      if (!token1IsNative && !isToken1Approved(amount1Wei)) {
        showToast({ type: 'info', message: `Approving ${token1Data.symbol}...` });
        await approveToken1(amount1Wei);
      }

      showToast({ type: 'success', message: 'Tokens approved!' });
    } catch (error: any) {
      showToast({ type: 'error', message: error.message || 'Approval failed' });
    }
  };

  const handleMintPosition = async () => {
    if (!address || !token0Data || !token1Data) return;

    try {
      const amount0Wei = parseUnits(amount0, token0Data.decimals);
      const amount1Wei = parseUnits(amount1, token1Data.decimals);

      // Check balances (skip check for native ETH - wallet will handle it)
      const userBalance0 = balance0 ? BigInt(balance0.toString()) : BigInt(0);
      const userBalance1 = balance1 ? BigInt(balance1.toString()) : BigInt(0);

      // Only check ERC20 token balances - native ETH will be checked by wallet
      if (!token0IsNative && userBalance0 < amount0Wei) {
        showToast({
          type: 'error',
          message: `Insufficient ${token0Data.symbol} balance. You have ${formatUnits(userBalance0, token0Data.decimals)} but need ${amount0}`,
        });
        return;
      }

      if (!token1IsNative && userBalance1 < amount1Wei) {
        showToast({
          type: 'error',
          message: `Insufficient ${token1Data.symbol} balance. You have ${formatUnits(userBalance1, token1Data.decimals)} but need ${amount1}`,
        });
        return;
      }

      // CRITICAL: Sort currencies by address (Uniswap V4 requirement)
      const token0Address = token0 as `0x${string}`;
      const token1Address = token1 as `0x${string}`;

      const sortedCurrency0 = token0Address.toLowerCase() < token1Address.toLowerCase()
        ? token0Address
        : token1Address;
      const sortedCurrency1 = token0Address.toLowerCase() < token1Address.toLowerCase()
        ? token1Address
        : token0Address;

      // Swap amounts if currencies were swapped
      const needsSwap = sortedCurrency0 !== token0Address;
      const finalAmount0Desired = needsSwap ? amount1Wei : amount0Wei;
      const finalAmount1Desired = needsSwap ? amount0Wei : amount1Wei;

      // Calculate tick spacing based on fee tier
      const tickSpacing = getTickSpacing(fee);

      // Calculate tick range based on selected strategy
      let alignedTickLower: number;
      let alignedTickUpper: number;

      if (minPrice === 'full' || currentTick === 0) {
        // Full range or no pool data - use max range
        [alignedTickLower, alignedTickUpper] = getFullRangeTicks(tickSpacing);
      } else if (minPrice === 'wide') {
        // Wide range: ~±50% around current price (2000 tick spacings)
        [alignedTickLower, alignedTickUpper] = calculateTickRange(currentTick, tickSpacing, 2000);
      } else if (minPrice === 'concentrated') {
        // Concentrated: ~±10% around current price (100 tick spacings)
        [alignedTickLower, alignedTickUpper] = calculateTickRange(currentTick, tickSpacing, 100);
      } else {
        // Default to wide range
        [alignedTickLower, alignedTickUpper] = calculateTickRange(currentTick, tickSpacing, 1000);
      }

      // Debug logging
      console.log('=== Position Creation Debug ===');
      console.log('Selected tokens:', { token0Data, token1Data });
      console.log('Input amounts:', { amount0, amount1 });
      console.log('Parsed amounts:', { amount0Wei: amount0Wei.toString(), amount1Wei: amount1Wei.toString() });
      console.log('Addresses:', { token0Address, token1Address });
      console.log('Sorted:', { sortedCurrency0, sortedCurrency1 });
      console.log('Needs swap:', needsSwap);
      console.log('Pool state:', {
        currentTick,
        currentSqrtPriceX96: currentSqrtPriceX96.toString(),
        tickSpacing
      });
      console.log('Tick range:', { alignedTickLower, alignedTickUpper });
      console.log('Final amounts:', {
        finalAmount0Desired: finalAmount0Desired.toString(),
        finalAmount1Desired: finalAmount1Desired.toString()
      });

      showToast({ type: 'info', message: 'Creating position...' });

      await mintPosition({
        currency0: sortedCurrency0,
        currency1: sortedCurrency1,
        fee,
        tickLower: alignedTickLower,
        tickUpper: alignedTickUpper,
        amount0Desired: finalAmount0Desired,
        amount1Desired: finalAmount1Desired,
        amount0Max: (finalAmount0Desired * BigInt(110)) / BigInt(100), // 10% buffer for max
        amount1Max: (finalAmount1Desired * BigInt(110)) / BigInt(100),
        recipient: address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour
      });
    } catch (error: any) {
      console.error('Position creation error:', error);

      // Provide more helpful error messages
      let errorMessage = 'Transaction failed';

      if (error.message?.includes('Pool not initialized')) {
        errorMessage = 'Pool not initialized. The selected token pair pool needs to be created first.';
      } else if (error.message?.includes('TickSpacing')) {
        errorMessage = 'Invalid tick range for the selected fee tier.';
      } else if (error.message?.includes('user rejected')) {
        errorMessage = 'Transaction rejected by user';
      } else if (error.message?.includes('insufficient funds')) {
        errorMessage = 'Insufficient ETH for gas fees';
      } else if (error.shortMessage) {
        errorMessage = error.shortMessage;
      } else if (error.message) {
        errorMessage = error.message;
      }

      showToast({ type: 'error', message: errorMessage });
    }
  };

  // Get single token data
  const singleTokenData = useMemo(() => {
    if (!singleTokenAddress) return undefined;
    return TOKENS.find(t => t.address.toLowerCase() === singleTokenAddress.toLowerCase());
  }, [TOKENS, singleTokenAddress]);

  // Fetch zap quote when single token amount changes
  useEffect(() => {
    const fetchZapQuote = async () => {
      if (depositMode !== 'single' || !singleTokenAmount || parseFloat(singleTokenAmount) <= 0 || !singleTokenData || !token0Data || !token1Data || !address) {
        setZapQuote(null);
        return;
      }

      const inputToken: ZapToken = {
        symbol: singleTokenData.symbol,
        address: singleTokenData.address,
        decimals: singleTokenData.decimals,
        isNative: singleTokenData.isNative,
      };

      const targetToken0: ZapToken = {
        symbol: token0Data.symbol,
        address: token0Data.address,
        decimals: token0Data.decimals,
        isNative: token0Data.isNative,
      };

      const targetToken1: ZapToken = {
        symbol: token1Data.symbol,
        address: token1Data.address,
        decimals: token1Data.decimals,
        isNative: token1Data.isNative,
      };

      const rangeStrategy = minPrice === 'full' ? 'full' : minPrice === 'wide' ? 'wide' : 'concentrated';

      const quote = await getZapQuote({
        inputToken,
        inputAmount: singleTokenAmount,
        targetToken0,
        targetToken1,
        fee,
        rangeStrategy,
        recipient: address,
      });

      setZapQuote(quote);
    };

    const debounce = setTimeout(fetchZapQuote, 500);
    return () => clearTimeout(debounce);
  }, [depositMode, singleTokenAmount, singleTokenData, token0Data, token1Data, fee, minPrice, address, getZapQuote]);

  // Handle zap execution
  const handleZap = async () => {
    if (!address || !singleTokenData || !token0Data || !token1Data || !singleTokenAmount) return;

    try {
      showToast({ type: 'info', message: 'Creating position with auto-swap...' });

      const inputToken: ZapToken = {
        symbol: singleTokenData.symbol,
        address: singleTokenData.address,
        decimals: singleTokenData.decimals,
        isNative: singleTokenData.isNative,
      };

      const targetToken0: ZapToken = {
        symbol: token0Data.symbol,
        address: token0Data.address,
        decimals: token0Data.decimals,
        isNative: token0Data.isNative,
      };

      const targetToken1: ZapToken = {
        symbol: token1Data.symbol,
        address: token1Data.address,
        decimals: token1Data.decimals,
        isNative: token1Data.isNative,
      };

      const rangeStrategy = minPrice === 'full' ? 'full' : minPrice === 'wide' ? 'wide' : 'concentrated';

      await executeZap({
        inputToken,
        inputAmount: singleTokenAmount,
        targetToken0,
        targetToken1,
        fee,
        rangeStrategy,
        recipient: address,
      });
    } catch (error: any) {
      console.error('Zap execution error:', error);
      showToast({ type: 'error', message: error.message || 'Transaction failed' });
    }
  };

  // Handle zap success
  useEffect(() => {
    if (zapIsSuccess && zapHash) {
      showToast({
        type: 'success',
        message: 'Position created successfully!',
        txHash: zapHash,
        chainId,
      });
      // Reset form
      setTimeout(() => {
        setStep(1);
        setToken0('');
        setToken1('');
        setSingleTokenAmount('');
        setSingleTokenAddress('');
        setZapQuote(null);
      }, 2000);
    }
  }, [zapIsSuccess, zapHash, showToast, chainId]);

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto card py-12 text-center">
        <p className="text-lg text-gray-400">Please connect your wallet to create a position</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Create New Position</h1>
        <p className="text-gray-400">
          Initialize a new liquidity position on Uniswap V4
        </p>
        {hasPoolParams && token0Data && token1Data && (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded-lg text-purple-300 text-sm">
            <span>Selected pool:</span>
            <span className="font-semibold">{token0Data.symbol}/{token1Data.symbol}</span>
            <span className="text-purple-400/70">({(fee / 10000).toFixed(2)}% fee)</span>
          </div>
        )}
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-4 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  s <= step
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                {s}
              </div>
              {s < 3 && (
                <div
                  className={`flex-1 h-1 mx-2 ${
                    s < step ? 'bg-primary-500' : 'bg-gray-800'
                  }`}
                />
              )}
            </div>
          ))}
      </div>

      {/* Step 1: Select Pool */}
      {step === 1 && (
        <div className="card space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">Select Pool</h2>
            <p className="text-gray-400 text-sm mb-6">
              Choose the token pair and fee tier for your position
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Token 0
              </label>
              <select
                value={token0}
                onChange={(e) => setToken0(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500"
              >
                <option value="">Select token</option>
                {TOKENS.map(t => (
                  <option key={t.address} value={t.address}>{t.symbol}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Token 1
              </label>
              <select
                value={token1}
                onChange={(e) => setToken1(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500"
              >
                <option value="">Select token</option>
                {TOKENS.map(t => (
                  <option key={t.address} value={t.address}>{t.symbol}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Fee Tier</label>
            <div className="grid grid-cols-3 gap-3">
              {FEE_TIERS.map((tier) => (
                <button
                  key={tier.value}
                  onClick={() => setFee(tier.value)}
                  className={`px-4 py-3 border rounded-lg transition-colors ${
                    fee === tier.value
                      ? 'bg-primary-500 border-primary-500 text-white'
                      : 'bg-gray-800 border-gray-700 hover:border-primary-500'
                  }`}
                >
                  {tier.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!token0 || !token1}
            className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Set Price Range */}
      {step === 2 && (
        <div className="card space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">Set Price Range</h2>
            <p className="text-gray-400 text-sm mb-2">
              Choose a range strategy for your liquidity position
            </p>
          </div>

          {/* Range Strategy Selection */}
          <div className="space-y-3">
            <label className="block text-sm font-medium mb-2">Range Strategy</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                onClick={() => {
                  setMinPrice('full');
                  setMaxPrice('full');
                }}
                className={`p-4 border rounded-lg transition-colors text-left ${
                  minPrice === 'full'
                    ? 'bg-primary-500/20 border-primary-500 text-white'
                    : 'bg-gray-800 border-gray-700 hover:border-primary-500'
                }`}
              >
                <div className="font-medium mb-1">Full Range</div>
                <p className="text-xs text-gray-400">Liquidity at all prices. Lowest fees, lowest risk.</p>
              </button>
              <button
                onClick={() => {
                  setMinPrice('wide');
                  setMaxPrice('wide');
                }}
                className={`p-4 border rounded-lg transition-colors text-left ${
                  minPrice === 'wide'
                    ? 'bg-primary-500/20 border-primary-500 text-white'
                    : 'bg-gray-800 border-gray-700 hover:border-primary-500'
                }`}
              >
                <div className="font-medium mb-1">Wide Range</div>
                <p className="text-xs text-gray-400">±50% around current price. Balanced approach.</p>
              </button>
              <button
                onClick={() => {
                  setMinPrice('concentrated');
                  setMaxPrice('concentrated');
                }}
                className={`p-4 border rounded-lg transition-colors text-left ${
                  minPrice === 'concentrated'
                    ? 'bg-primary-500/20 border-primary-500 text-white'
                    : 'bg-gray-800 border-gray-700 hover:border-primary-500'
                }`}
              >
                <div className="font-medium mb-1">Concentrated</div>
                <p className="text-xs text-gray-400">±10% around current price. Higher fees, higher risk.</p>
              </button>
            </div>
          </div>

          {/* Range Info */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2">
            <Info className="text-blue-400 mt-0.5 flex-shrink-0" size={16} />
            <div className="text-xs text-blue-200">
              <p className="font-medium mb-1">
                {minPrice === 'full' && 'Full Range Position'}
                {minPrice === 'wide' && 'Wide Range Position'}
                {minPrice === 'concentrated' && 'Concentrated Position'}
                {!minPrice && 'Select a Range Strategy'}
              </p>
              <p>
                {minPrice === 'full' && 'Your position will provide liquidity across all possible prices. This is safest for volatile pairs but earns lower fees.'}
                {minPrice === 'wide' && 'Your position will cover a wide range around the current price (±50%). Good balance of fee earnings and impermanent loss protection.'}
                {minPrice === 'concentrated' && 'Your position will be concentrated near the current price (±10%). Higher fee earnings but requires active management.'}
                {!minPrice && 'Choose a strategy above to continue.'}
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="btn-secondary flex-1 py-3"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!minPrice || !maxPrice}
              className="btn-primary flex-1 py-3 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Deposit Amounts */}
      {step === 3 && (
        <div className="card space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">Deposit Amounts</h2>
            <p className="text-gray-400 text-sm mb-4">
              Choose how to provide liquidity
            </p>
          </div>

          {/* Deposit Mode Toggle */}
          <div className="flex items-center gap-2 p-1 bg-gray-800/50 rounded-xl w-fit">
            <button
              onClick={() => setDepositMode('single')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                depositMode === 'single'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Zap size={16} />
              Single Token
            </button>
            <button
              onClick={() => setDepositMode('both')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                depositMode === 'both'
                  ? 'bg-primary-500 text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Both Tokens
            </button>
          </div>

          {/* Pool Price Warning */}
          {!poolPriceInfo.isRealistic && poolPriceInfo.warning && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="text-red-400 mt-0.5 flex-shrink-0" size={20} />
              <div>
                <p className="font-medium text-red-400 mb-1">Warning: Unrealistic Pool Price</p>
                <p className="text-sm text-red-200">{poolPriceInfo.warning}</p>
                <p className="text-xs text-gray-400 mt-2">
                  Creating a position in this pool may result in unexpected token ratios.
                  Your tokens might be refunded if the position range doesn&apos;t match the pool price.
                </p>
              </div>
            </div>
          )}

          {/* Pool Price Info */}
          {poolPriceInfo.isRealistic && poolPriceInfo.price > 0 && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2">
              <Info className="text-green-400 flex-shrink-0" size={16} />
              <span className="text-sm text-green-200">
                Pool price: 1 ETH ≈ ${poolPriceInfo.price.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC
              </span>
            </div>
          )}

          {/* Single Token Deposit UI */}
          {depositMode === 'single' && (
            <div className="space-y-4">
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 flex items-start gap-2">
                <Zap className="text-purple-400 mt-0.5 flex-shrink-0" size={16} />
                <p className="text-xs text-purple-200">
                  Deposit a single token and we&apos;ll automatically swap a portion to create a balanced position.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Select Token</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSingleTokenAddress(token0)}
                    className={`p-3 rounded-lg border transition-all ${
                      singleTokenAddress === token0
                        ? 'bg-primary-500/20 border-primary-500 text-white'
                        : 'bg-gray-800 border-gray-700 hover:border-gray-600 text-gray-300'
                    }`}
                  >
                    {token0Data?.symbol || 'Token 0'}
                  </button>
                  <button
                    onClick={() => setSingleTokenAddress(token1)}
                    className={`p-3 rounded-lg border transition-all ${
                      singleTokenAddress === token1
                        ? 'bg-primary-500/20 border-primary-500 text-white'
                        : 'bg-gray-800 border-gray-700 hover:border-gray-600 text-gray-300'
                    }`}
                  >
                    {token1Data?.symbol || 'Token 1'}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium">
                    Amount
                  </label>
                  {singleTokenAddress && (
                    <span className="text-xs text-gray-400">
                      Balance: {singleTokenAddress === token0 && balance0 != null && token0Data
                        ? parseFloat(formatUnits(BigInt(balance0.toString()), token0Data.decimals)).toFixed(4)
                        : singleTokenAddress === token1 && balance1 != null && token1Data
                        ? parseFloat(formatUnits(BigInt(balance1.toString()), token1Data.decimals)).toFixed(4)
                        : '0'}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  value={singleTokenAmount}
                  onChange={(e) => setSingleTokenAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-primary-500"
                />
              </div>

              {/* Zap Quote Preview */}
              {zapQuoteLoading && (
                <div className="flex items-center justify-center gap-2 py-4 text-gray-400">
                  <Loader2 className="animate-spin" size={16} />
                  <span className="text-sm">Getting quote...</span>
                </div>
              )}

              {zapQuote && (
                <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                  <div className="flex items-center gap-2 mb-3">
                    <Info size={14} className="text-blue-400" />
                    <span className="text-sm font-medium text-gray-300">Position Preview</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Swap Amount</span>
                      <span className="text-white">
                        {formatUnits(zapQuote.swapAmount, zapQuote.swapFromToken.decimals).slice(0, 10)} {zapQuote.swapFromToken.symbol}
                        <ArrowRight className="inline mx-1" size={12} />
                        {zapQuote.swapToToken.symbol}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Expected {token0Data?.symbol}</span>
                      <span className="text-white">
                        {token0Data && formatUnits(zapQuote.expectedAmount0, token0Data.decimals).slice(0, 10)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Expected {token1Data?.symbol}</span>
                      <span className="text-white">
                        {token1Data && formatUnits(zapQuote.expectedAmount1, token1Data.decimals).slice(0, 10)}
                      </span>
                    </div>
                    {zapQuote.priceImpact > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Price Impact</span>
                        <span className={zapQuote.priceImpact > 1 ? 'text-yellow-400' : 'text-green-400'}>
                          {zapQuote.priceImpact.toFixed(2)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Both Tokens Deposit UI */}
          {depositMode === 'both' && (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <label className="block text-sm font-medium">
                      {token0Data?.symbol} Amount
                    </label>
                    {activeInput === 'amount1' && amount1 && calculatePairedAmount && (
                      <span className="text-xs bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded">Auto</span>
                    )}
                  </div>
                  {balance0 != null && token0Data && (
                    <span className="text-xs text-gray-400">
                      Balance: {parseFloat(formatUnits(BigInt(balance0.toString()), token0Data.decimals)).toFixed(4)}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  value={amount0}
                  onChange={(e) => {
                    setActiveInput('amount0');
                    setAmount0(e.target.value);
                  }}
                  onFocus={() => setActiveInput('amount0')}
                  placeholder="0.00"
                  step="0.01"
                  className={`w-full px-4 py-3 bg-gray-800 border rounded-lg focus:outline-none focus:border-primary-500 ${
                    activeInput === 'amount1' && amount1 ? 'border-primary-500/50' : 'border-gray-700'
                  }`}
                />
                {balance0 != null && token0Data && amount0 && parseUnits(amount0, token0Data.decimals) > BigInt(balance0.toString()) && (
                  <div className="flex items-center gap-1 mt-1 text-red-400 text-xs">
                    <AlertCircle size={12} />
                    <span>Insufficient balance</span>
                  </div>
                )}
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <label className="block text-sm font-medium">
                      {token1Data?.symbol} Amount
                    </label>
                    {activeInput === 'amount0' && amount0 && calculatePairedAmount && (
                      <span className="text-xs bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded">Auto</span>
                    )}
                  </div>
                  {balance1 != null && token1Data && (
                    <span className="text-xs text-gray-400">
                      Balance: {parseFloat(formatUnits(BigInt(balance1.toString()), token1Data.decimals)).toFixed(4)}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  value={amount1}
                  onChange={(e) => {
                    setActiveInput('amount1');
                    setAmount1(e.target.value);
                  }}
                  onFocus={() => setActiveInput('amount1')}
                  placeholder="0.00"
                  step="0.01"
                  className={`w-full px-4 py-3 bg-gray-800 border rounded-lg focus:outline-none focus:border-primary-500 ${
                    activeInput === 'amount0' && amount0 ? 'border-primary-500/50' : 'border-gray-700'
                  }`}
                />
                {balance1 != null && token1Data && amount1 && parseUnits(amount1, token1Data.decimals) > BigInt(balance1.toString()) && (
                  <div className="flex items-center gap-1 mt-1 text-red-400 text-xs">
                    <AlertCircle size={12} />
                    <span>Insufficient balance</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loading state for pool data */}
          {isLoadingSlot0 && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="animate-spin" size={12} />
              <span>Loading pool data...</span>
            </div>
          )}

          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Selected Pool</span>
              <span className="font-medium">{token0Data?.symbol}/{token1Data?.symbol}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Fee Tier</span>
              <span className="font-medium">{(fee / 10000)}%</span>
            </div>
            {currentTick !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Current Tick</span>
                <span className="font-mono text-xs">{currentTick.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Info about selected range */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2">
            <Info className="text-blue-400 mt-0.5 flex-shrink-0" size={16} />
            <div className="text-xs text-blue-200">
              <p className="font-medium mb-1">
                {minPrice === 'full' && 'Full Range Position'}
                {minPrice === 'wide' && 'Wide Range Position'}
                {minPrice === 'concentrated' && 'Concentrated Position'}
              </p>
              <p>
                {minPrice === 'full' && 'Liquidity across all possible prices. Lowest fees but safest for volatile pairs.'}
                {minPrice === 'wide' && 'Liquidity across ±50% of current price. Balanced fee earnings and risk.'}
                {minPrice === 'concentrated' && 'Concentrated near current price (±10%). Higher fees but requires monitoring.'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {/* Approval Buttons - Both Tokens Mode */}
            {depositMode === 'both' && (
              <button
                onClick={handleApprovals}
                disabled={!amount0 || !amount1 || isPendingApproval0 || isPendingApproval1}
                className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
              >
                {(isPendingApproval0 || isPendingApproval1) && <Loader2 className="animate-spin" size={18} />}
                {isPendingApproval0 || isPendingApproval1 ? 'Approving...' : 'Approve Tokens'}
              </button>
            )}

            {/* Create Position Button */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="btn-secondary flex-1 py-3"
              >
                Back
              </button>

              {/* Both Tokens Mode - Create Position */}
              {depositMode === 'both' && (
                <button
                  onClick={handleMintPosition}
                  disabled={!amount0 || !amount1 || isPending || isConfirming || !poolPriceInfo.isRealistic}
                  className="btn-primary flex-1 py-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(isPending || isConfirming) && <Loader2 className="animate-spin" size={18} />}
                  {isPending ? 'Confirm in Wallet...' : isConfirming ? 'Creating...' : !poolPriceInfo.isRealistic ? 'Pool Price Invalid' : 'Create Position'}
                </button>
              )}

              {/* Single Token Mode - Zap Position */}
              {depositMode === 'single' && (
                <button
                  onClick={handleZap}
                  disabled={!singleTokenAmount || !singleTokenAddress || zapIsPending || zapIsConfirming}
                  className="btn-primary flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(zapIsPending || zapIsConfirming) && <Loader2 className="animate-spin" size={18} />}
                  {zapIsPending ? 'Confirm in Wallet...' : zapIsConfirming ? 'Creating...' : (
                    <>
                      <Zap size={16} />
                      Create Position
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Help Section - Chain-specific info */}
      {chainId === CHAIN_IDS.SEPOLIA && (
        <div className="card mt-8 border-blue-500/20 bg-blue-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-blue-400 mt-1" size={20} />
            <div>
              <h3 className="font-semibold text-blue-400 mb-2">Need Test Tokens?</h3>
              <p className="text-sm text-gray-300 mb-3">
                You need Sepolia testnet tokens to create positions. Here&apos;s how to get them:
              </p>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium text-white">1. Get Sepolia ETH:</span>
                  <ul className="ml-4 mt-1 space-y-1 text-gray-400">
                    <li>• Visit <a href="https://sepoliafaucet.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">sepoliafaucet.com</a></li>
                    <li>• Or <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Alchemy Sepolia Faucet</a></li>
                  </ul>
                </div>
                <div>
                  <span className="font-medium text-white">2. Get WETH (Wrapped ETH):</span>
                  <ul className="ml-4 mt-1 space-y-1 text-gray-400">
                    <li>• Go to <a href="https://sepolia.etherscan.io/address/0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9#writeContract" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">WETH Contract on Etherscan</a></li>
                    <li>• Connect wallet and use &quot;deposit&quot; function to wrap your ETH</li>
                  </ul>
                </div>
                <div>
                  <span className="font-medium text-white">3. Get USDC/DAI:</span>
                  <ul className="ml-4 mt-1 space-y-1 text-gray-400">
                    <li>• USDC: <a href="https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">0x1c7D...7238</a></li>
                    <li>• DAI: <a href="https://sepolia.etherscan.io/address/0x68194a729C2450ad26072b3D33ADaCbcef39D574" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">0x6819...D574</a></li>
                    <li>• Use a Sepolia faucet or testnet swap to get these tokens</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {chainId === CHAIN_IDS.BASE && (
        <div className="card mt-8 border-blue-500/20 bg-blue-500/5">
          <div className="flex items-start gap-3">
            <Info className="text-blue-400 mt-1" size={20} />
            <div>
              <h3 className="font-semibold text-blue-400 mb-2">Getting Started on Base</h3>
              <p className="text-sm text-gray-300 mb-3">
                You need tokens on Base mainnet to create positions.
              </p>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium text-white">Get tokens on Base:</span>
                  <ul className="ml-4 mt-1 space-y-1 text-gray-400">
                    <li>• Bridge from Ethereum via <a href="https://bridge.base.org" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Base Bridge</a></li>
                    <li>• Buy directly on <a href="https://www.coinbase.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Coinbase</a> and withdraw to Base</li>
                    <li>• Swap on <a href="https://app.uniswap.org" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Uniswap</a></li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
