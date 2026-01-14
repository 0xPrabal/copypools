'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAccount, useReadContract, useBalance, useChainId, usePublicClient } from 'wagmi';
import { Loader2, AlertCircle, Info, Zap, ChevronDown, Check, AlertTriangle } from 'lucide-react';
import { parseUnits, formatUnits, keccak256, encodeAbiParameters } from 'viem';
import { useV4Utils } from '@/hooks/useV4Utils';
import { useZapLiquidity, ZapToken, ZapQuote } from '@/hooks/useZapLiquidity';
import { useTokenApproval } from '@/hooks/useTokenApproval';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import { useToast } from '@/components/common/toast';
import { getContracts, CHAIN_IDS } from '@/config/contracts';
import { TOKENS_BY_CHAIN } from '@/config/tokens';
import ERC20Abi from '@/abis/ERC20.json';
import StateViewAbi from '@/abis/StateView.json';
import { getTickSpacing, calculateTickRange, getFullRangeTicks } from '@/utils/tickMath';
import { cn } from '@/lib/utils';
import { Stepper, PositionSummaryCard } from '@/components/position';
import { Slider } from '@/components/ui/slider';

type RangeStrategy = 'full' | 'wide' | 'concentrated' | 'custom';

const FEE_TIERS = [
  { label: '0.05%', value: 500, description: 'Best for stable or low-volatility pairs' },
  { label: '0.30%', value: 3000, description: 'Balanced option for most pairs' },
  { label: '1.00%', value: 10000, description: 'Higher fees, higher risk, lower volume' },
];

export default function InitiatorPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const router = useRouter();
  const publicClient = usePublicClient({ chainId: chainId as 8453 | 11155111 });
  const CONTRACTS = getContracts(chainId);
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [depositMode, setDepositMode] = useState<'single' | 'both'>('both');
  const [rangeStrategy, setRangeStrategy] = useState<RangeStrategy>('full');

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
  const [fee, setFee] = useState(3000);
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [activeInput, setActiveInput] = useState<'amount0' | 'amount1' | null>(null);

  // Single token zap state
  const [singleTokenAddress, setSingleTokenAddress] = useState<string>('');
  const [singleTokenAmount, setSingleTokenAmount] = useState('');
  const [zapQuote, setZapQuote] = useState<ZapQuote | null>(null);

  // Price range state for slider - will be updated dynamically based on pool price
  const [priceRange, setPriceRange] = useState<number[]>([0, 0]);
  const [sliderBoundsInitialized, setSliderBoundsInitialized] = useState(false);

  // Reset tokens when chain changes
  useEffect(() => {
    if (!hasPoolParams) {
      setToken0('');
      setToken1('');
    }
  }, [chainId, hasPoolParams]);

  // Initialize from URL params
  useEffect(() => {
    if (hasPoolParams && urlToken0 && urlToken1 && urlFee) {
      setToken0(urlToken0);
      setToken1(urlToken1);
      const parsedFee = parseInt(urlFee);
      if (!isNaN(parsedFee)) setFee(parsedFee);
      setStep(2);
      setSingleTokenAddress(urlToken0);
    }
  }, [hasPoolParams, urlToken0, urlToken1, urlFee]);

  const { mintPosition, isPending, isConfirming, isSuccess, hash } = useV4Utils();

  const {
    getZapQuote,
    executeZap,
    quoteLoading: zapQuoteLoading,
    isPending: zapIsPending,
    isConfirming: zapIsConfirming,
    isSuccess: zapIsSuccess,
    hash: zapHash,
  } = useZapLiquidity();

  // Token data resolution
  const token0FromList = useMemo(() => {
    if (!token0) return undefined;
    return TOKENS.find(t => t.address.toLowerCase() === token0.toLowerCase());
  }, [TOKENS, token0]);

  const token1FromList = useMemo(() => {
    if (!token1) return undefined;
    return TOKENS.find(t => t.address.toLowerCase() === token1.toLowerCase());
  }, [TOKENS, token1]);

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const token0NeedsOnChain = !!token0 && !token0FromList && token0.toLowerCase() !== ZERO_ADDRESS;
  const token1NeedsOnChain = !!token1 && !token1FromList && token1.toLowerCase() !== ZERO_ADDRESS;

  const { data: token0Symbol } = useReadContract({
    address: token0 as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'symbol',
    query: { enabled: token0NeedsOnChain },
  });

  const { data: token0Decimals } = useReadContract({
    address: token0 as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'decimals',
    query: { enabled: token0NeedsOnChain },
  });

  const { data: token1Symbol } = useReadContract({
    address: token1 as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'symbol',
    query: { enabled: token1NeedsOnChain },
  });

  const { data: token1Decimals } = useReadContract({
    address: token1 as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'decimals',
    query: { enabled: token1NeedsOnChain },
  });

  const token0Data = useMemo(() => {
    if (token0FromList) return token0FromList;
    if (!token0) return undefined;
    if (token0.toLowerCase() === ZERO_ADDRESS) {
      return { symbol: 'ETH', address: ZERO_ADDRESS as `0x${string}`, decimals: 18, isNative: true };
    }
    if (token0Symbol && token0Decimals !== undefined) {
      return { symbol: token0Symbol as string, address: token0 as `0x${string}`, decimals: Number(token0Decimals) };
    }
    return undefined;
  }, [token0, token0FromList, token0Symbol, token0Decimals]);

  const token1Data = useMemo(() => {
    if (token1FromList) return token1FromList;
    if (!token1) return undefined;
    if (token1.toLowerCase() === ZERO_ADDRESS) {
      return { symbol: 'ETH', address: ZERO_ADDRESS as `0x${string}`, decimals: 18, isNative: true };
    }
    if (token1Symbol && token1Decimals !== undefined) {
      return { symbol: token1Symbol as string, address: token1 as `0x${string}`, decimals: Number(token1Decimals) };
    }
    return undefined;
  }, [token1, token1FromList, token1Symbol, token1Decimals]);

  const token0IsNative = token0 ? token0.toLowerCase() === ZERO_ADDRESS : (token0Data?.isNative || false);
  const token1IsNative = token1 ? token1.toLowerCase() === ZERO_ADDRESS : (token1Data?.isNative || false);

  const { token0Price, token1Price } = useTokenPrices(token0, token1, chainId);

  // Balances
  const { data: ethBalance } = useBalance({
    address: address,
    query: { enabled: !!address && (token0IsNative || token1IsNative) },
  });

  const { data: balance0ERC20 } = useReadContract({
    address: token0 as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!token0 && !token0IsNative },
  });

  const { data: balance1ERC20 } = useReadContract({
    address: token1 as `0x${string}`,
    abi: ERC20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!token1 && !token1IsNative },
  });

  const balance0 = token0IsNative ? ethBalance?.value : (balance0ERC20 as bigint | undefined);
  const balance1 = token1IsNative ? ethBalance?.value : (balance1ERC20 as bigint | undefined);

  const {
    approve: approveToken0,
    isApproved: isToken0Approved,
    isPending: isPendingApproval0,
    isConfirming: isConfirmingApproval0,
    isSuccess: isSuccessApproval0,
    refetch: refetchApproval0,
  } = useTokenApproval(token0 as `0x${string}`, CONTRACTS.V4_UTILS);

  const {
    approve: approveToken1,
    isApproved: isToken1Approved,
    isPending: isPendingApproval1,
    isConfirming: isConfirmingApproval1,
    isSuccess: isSuccessApproval1,
    refetch: refetchApproval1,
  } = useTokenApproval(token1 as `0x${string}`, CONTRACTS.V4_UTILS);

  // Refetch allowance when approval transaction is confirmed
  useEffect(() => {
    if (isSuccessApproval0) {
      // Refetch immediately and again after a short delay to ensure blockchain state is updated
      refetchApproval0();
      const timer = setTimeout(() => refetchApproval0(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccessApproval0, refetchApproval0]);

  useEffect(() => {
    if (isSuccessApproval1) {
      refetchApproval1();
      const timer = setTimeout(() => refetchApproval1(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccessApproval1, refetchApproval1]);

  // Pool info
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
    query: { enabled: !!poolId && step >= 2 },
  });

  const slot0Array = slot0Data as readonly [bigint, number, number, number] | undefined;
  const currentTick = slot0Array ? Number(slot0Array[1]) : 0;
  const currentSqrtPriceX96 = slot0Array ? slot0Array[0] : BigInt(0);

  // Pool price calculation
  const poolPriceInfo = useMemo(() => {
    if (!currentSqrtPriceX96 || currentSqrtPriceX96 === BigInt(0)) {
      return { price: 0, isRealistic: false, warning: 'Pool not initialized' };
    }
    const Q96 = BigInt(2) ** BigInt(96);
    const sqrtPrice = Number(currentSqrtPriceX96) / Number(Q96);
    const rawPrice = sqrtPrice * sqrtPrice;
    const sortedToken0Data = sortedToken0 === token0 ? token0Data : token1Data;
    const sortedToken1Data = sortedToken0 === token0 ? token1Data : token0Data;
    if (!sortedToken0Data || !sortedToken1Data) {
      return { price: 0, isRealistic: false, warning: 'Token data not available' };
    }
    const decimalAdjustment = Math.pow(10, sortedToken0Data.decimals - sortedToken1Data.decimals);
    const adjustedPrice = rawPrice * decimalAdjustment;
    let displayPrice = adjustedPrice;
    if (adjustedPrice < 0.001 && adjustedPrice > 0) {
      displayPrice = 1 / adjustedPrice;
    }
    const isRealistic = displayPrice > 0 && isFinite(displayPrice);
    return { price: displayPrice, isRealistic, warning: isRealistic ? '' : 'Pool price appears invalid' };
  }, [currentSqrtPriceX96, sortedToken0, token0, token0Data, token1Data]);

  const currentPrice = poolPriceInfo.price || 0;

  // Dynamic slider bounds based on current pool price
  const absoluteMin = useMemo(() => {
    if (currentPrice <= 0) return 1;
    // Set min to 1% of current price (or at least 0.000001 for very small prices)
    return Math.max(0.000001, currentPrice * 0.01);
  }, [currentPrice]);

  const absoluteMax = useMemo(() => {
    if (currentPrice <= 0) return 10000;
    // Set max to 100x current price
    return currentPrice * 100;
  }, [currentPrice]);

  // Initialize slider bounds when pool price is loaded
  useEffect(() => {
    if (currentPrice > 0 && !sliderBoundsInitialized) {
      // Initialize with full range by default
      setPriceRange([absoluteMin, absoluteMax]);
      setSliderBoundsInitialized(true);
    }
  }, [currentPrice, absoluteMin, absoluteMax, sliderBoundsInitialized]);

  // Check if position would be in range
  const isInRange = useMemo(() => {
    if (priceRange[0] === 0 && priceRange[1] === 0) return true; // Not initialized yet
    return priceRange[0] <= currentPrice && currentPrice <= priceRange[1];
  }, [priceRange, currentPrice]);

  // Handle range strategy change
  const handleStrategyChange = (strategy: RangeStrategy) => {
    if (strategy === rangeStrategy) return; // Prevent re-selecting same strategy
    setRangeStrategy(strategy);

    if (currentPrice <= 0) return; // Can't calculate range without price

    switch (strategy) {
      case 'full':
        setPriceRange([absoluteMin, absoluteMax]);
        break;
      case 'wide':
        // 50% range around current price
        const wideMin = currentPrice * 0.5;
        const wideMax = currentPrice * 1.5;
        setPriceRange([Math.max(absoluteMin, wideMin), Math.min(absoluteMax, wideMax)]);
        break;
      case 'concentrated':
        // 10% range around current price
        const concMin = currentPrice * 0.9;
        const concMax = currentPrice * 1.1;
        setPriceRange([Math.max(absoluteMin, concMin), Math.min(absoluteMax, concMax)]);
        break;
    }
  };

  // Paired amount calculation
  const calculatePairedAmount = useMemo(() => {
    if (!currentSqrtPriceX96 || currentSqrtPriceX96 === BigInt(0) || !token0Data || !token1Data || !rangeStrategy) {
      return null;
    }
    const tickSpacing = getTickSpacing(fee);
    let tickLower: number, tickUpper: number;
    if (rangeStrategy === 'full') {
      [tickLower, tickUpper] = getFullRangeTicks(tickSpacing);
    } else if (rangeStrategy === 'wide') {
      [tickLower, tickUpper] = calculateTickRange(currentTick, tickSpacing, 2000);
    } else if (rangeStrategy === 'concentrated') {
      [tickLower, tickUpper] = calculateTickRange(currentTick, tickSpacing, 100);
    } else {
      return null;
    }
    const sqrtPriceLower = Math.sqrt(1.0001 ** tickLower);
    const sqrtPriceUpper = Math.sqrt(1.0001 ** tickUpper);
    const Q96 = BigInt(2) ** BigInt(96);
    const sqrtPriceCurrent = Number(currentSqrtPriceX96) / Number(Q96);
    const sortedToken0Data = sortedToken0 === token0 ? token0Data : token1Data;
    const sortedToken1Data = sortedToken0 === token0 ? token1Data : token0Data;
    const isSorted = sortedToken0 === token0;

    return {
      fromAmount0ToAmount1: (inputAmount0: string): string => {
        if (!inputAmount0 || parseFloat(inputAmount0) === 0) return '';
        const amount0Wei = parseFloat(inputAmount0);
        if (currentTick <= tickLower) return '0';
        if (currentTick >= tickUpper) return '';
        const numerator = sqrtPriceCurrent - sqrtPriceLower;
        const denominator = (1 / sqrtPriceCurrent) - (1 / sqrtPriceUpper);
        if (denominator === 0) return '';
        const ratio = numerator / denominator;
        const decimalAdjustment = Math.pow(10, sortedToken0Data.decimals - sortedToken1Data.decimals);
        const amount1 = amount0Wei * ratio * decimalAdjustment;
        if (!isSorted) return (amount0Wei / ratio / decimalAdjustment).toFixed(6);
        return amount1.toFixed(6);
      },
      fromAmount1ToAmount0: (inputAmount1: string): string => {
        if (!inputAmount1 || parseFloat(inputAmount1) === 0) return '';
        const amount1Wei = parseFloat(inputAmount1);
        if (currentTick <= tickLower) return '';
        if (currentTick >= tickUpper) return '0';
        const numerator = sqrtPriceCurrent - sqrtPriceLower;
        const denominator = (1 / sqrtPriceCurrent) - (1 / sqrtPriceUpper);
        if (numerator === 0) return '';
        const ratio = numerator / denominator;
        const decimalAdjustment = Math.pow(10, sortedToken0Data.decimals - sortedToken1Data.decimals);
        const amount0 = amount1Wei / ratio / decimalAdjustment;
        if (!isSorted) return (amount1Wei * ratio * decimalAdjustment).toFixed(6);
        return amount0.toFixed(6);
      },
      tickLower,
      tickUpper,
    };
  }, [currentSqrtPriceX96, currentTick, token0Data, token1Data, rangeStrategy, fee, sortedToken0, token0]);

  // Auto-calculate paired amount
  const isAutoCalculating = useMemo(() => ({ current: false }), []);

  useEffect(() => {
    if (!calculatePairedAmount || !activeInput || isAutoCalculating.current) return;
    isAutoCalculating.current = true;
    if (activeInput === 'amount0' && amount0) {
      const calculated = calculatePairedAmount.fromAmount0ToAmount1(amount0);
      if (calculated !== '' && calculated !== amount1) {
        setAmount1(parseFloat(calculated).toString());
      }
    } else if (activeInput === 'amount1' && amount1) {
      const calculated = calculatePairedAmount.fromAmount1ToAmount0(amount1);
      if (calculated !== '' && calculated !== amount0) {
        setAmount0(parseFloat(calculated).toString());
      }
    }
    setTimeout(() => { isAutoCalculating.current = false; }, 100);
  }, [amount0, amount1, activeInput, calculatePairedAmount, isAutoCalculating]);

  // Handle transaction success
  useEffect(() => {
    if (isSuccess && hash && publicClient) {
      showToast({ type: 'success', message: 'Position created successfully!', txHash: hash, chainId });
      const getTokenIdAndNavigate = async () => {
        try {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          const positionManagerAddress = CONTRACTS.POSITION_MANAGER.toLowerCase();
          const transferLog = receipt.logs.find(log =>
            log.address.toLowerCase() === positionManagerAddress &&
            log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
          );
          if (transferLog && transferLog.topics[3]) {
            router.push(`/positions/${BigInt(transferLog.topics[3]).toString()}`);
            return;
          }
          router.push('/positions');
        } catch { router.push('/positions'); }
      };
      getTokenIdAndNavigate();
    }
  }, [isSuccess, hash, showToast, chainId, publicClient, router, CONTRACTS.POSITION_MANAGER]);

  // Handle mint position
  const handleMintPosition = async () => {
    if (!address || !token0Data || !token1Data) return;
    try {
      const amount0Wei = parseUnits(amount0, token0Data.decimals);
      const amount1Wei = parseUnits(amount1, token1Data.decimals);
      const token0Address = token0 as `0x${string}`;
      const token1Address = token1 as `0x${string}`;
      const sortedCurrency0 = token0Address.toLowerCase() < token1Address.toLowerCase() ? token0Address : token1Address;
      const sortedCurrency1 = token0Address.toLowerCase() < token1Address.toLowerCase() ? token1Address : token0Address;
      const needsSwap = sortedCurrency0 !== token0Address;
      const finalAmount0 = needsSwap ? amount1Wei : amount0Wei;
      const finalAmount1 = needsSwap ? amount0Wei : amount1Wei;
      const tickSpacing = getTickSpacing(fee);
      let alignedTickLower: number, alignedTickUpper: number;
      if (rangeStrategy === 'full' || currentTick === 0) {
        [alignedTickLower, alignedTickUpper] = getFullRangeTicks(tickSpacing);
      } else if (rangeStrategy === 'wide') {
        [alignedTickLower, alignedTickUpper] = calculateTickRange(currentTick, tickSpacing, 2000);
      } else {
        [alignedTickLower, alignedTickUpper] = calculateTickRange(currentTick, tickSpacing, 100);
      }
      showToast({ type: 'info', message: 'Creating position...' });
      await mintPosition({
        currency0: sortedCurrency0,
        currency1: sortedCurrency1,
        fee,
        tickLower: alignedTickLower,
        tickUpper: alignedTickUpper,
        amount0Desired: finalAmount0,
        amount1Desired: finalAmount1,
        amount0Max: (finalAmount0 * BigInt(110)) / BigInt(100),
        amount1Max: (finalAmount1 * BigInt(110)) / BigInt(100),
        recipient: address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
      });
    } catch (error: any) {
      let errorMessage = 'Transaction failed';
      if (error.message?.includes('Pool not initialized')) errorMessage = 'Pool not initialized.';
      else if (error.message?.includes('user rejected')) errorMessage = 'Transaction rejected';
      else if (error.shortMessage) errorMessage = error.shortMessage;
      showToast({ type: 'error', message: errorMessage });
    }
  };

  // Zap handling
  const singleTokenData = useMemo(() => {
    if (!singleTokenAddress) return undefined;
    if (token0 && singleTokenAddress.toLowerCase() === token0.toLowerCase()) return token0Data;
    if (token1 && singleTokenAddress.toLowerCase() === token1.toLowerCase()) return token1Data;
    return TOKENS.find(t => t.address.toLowerCase() === singleTokenAddress.toLowerCase());
  }, [singleTokenAddress, token0, token1, token0Data, token1Data, TOKENS]);

  useEffect(() => {
    const fetchZapQuote = async () => {
      if (depositMode !== 'single' || !singleTokenAmount || parseFloat(singleTokenAmount) <= 0 || !singleTokenData || !token0Data || !token1Data || !address) {
        setZapQuote(null);
        return;
      }
      const inputToken: ZapToken = { symbol: singleTokenData.symbol, address: singleTokenData.address, decimals: singleTokenData.decimals, isNative: singleTokenData.isNative };
      const targetToken0: ZapToken = { symbol: token0Data.symbol, address: token0Data.address, decimals: token0Data.decimals, isNative: token0Data.isNative };
      const targetToken1: ZapToken = { symbol: token1Data.symbol, address: token1Data.address, decimals: token1Data.decimals, isNative: token1Data.isNative };
      const zapRangeStrategy = rangeStrategy === 'custom' ? 'wide' : rangeStrategy;
      const quote = await getZapQuote({ inputToken, inputAmount: singleTokenAmount, targetToken0, targetToken1, fee, rangeStrategy: zapRangeStrategy, recipient: address });
      setZapQuote(quote);
    };
    const debounce = setTimeout(fetchZapQuote, 500);
    return () => clearTimeout(debounce);
  }, [depositMode, singleTokenAmount, singleTokenData, token0Data, token1Data, fee, rangeStrategy, address, getZapQuote]);

  const handleZap = async () => {
    if (!address || !singleTokenData || !token0Data || !token1Data || !singleTokenAmount) return;
    try {
      showToast({ type: 'info', message: 'Creating position with auto-swap...' });
      const inputToken: ZapToken = { symbol: singleTokenData.symbol, address: singleTokenData.address, decimals: singleTokenData.decimals, isNative: singleTokenData.isNative };
      const targetToken0: ZapToken = { symbol: token0Data.symbol, address: token0Data.address, decimals: token0Data.decimals, isNative: token0Data.isNative };
      const targetToken1: ZapToken = { symbol: token1Data.symbol, address: token1Data.address, decimals: token1Data.decimals, isNative: token1Data.isNative };
      const zapRangeStrategy = rangeStrategy === 'custom' ? 'wide' : rangeStrategy;
      // Use 5% slippage (500 bps) for better success rate with volatile pairs
      await executeZap({ inputToken, inputAmount: singleTokenAmount, targetToken0, targetToken1, fee, rangeStrategy: zapRangeStrategy, recipient: address, slippageBps: 500 });
    } catch (error: any) {
      showToast({ type: 'error', message: error.message || 'Transaction failed' });
    }
  };

  useEffect(() => {
    if (zapIsSuccess && zapHash && publicClient) {
      showToast({ type: 'success', message: 'Position created successfully!', txHash: zapHash, chainId });
      const getTokenIdAndNavigate = async () => {
        try {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: zapHash });
          const positionManagerAddress = CONTRACTS.POSITION_MANAGER.toLowerCase();
          const transferLog = receipt.logs.find(log =>
            log.address.toLowerCase() === positionManagerAddress &&
            log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
          );
          if (transferLog && transferLog.topics[3]) {
            router.push(`/positions/${BigInt(transferLog.topics[3]).toString()}`);
            return;
          }
          router.push('/positions');
        } catch { router.push('/positions'); }
      };
      getTokenIdAndNavigate();
    }
  }, [zapIsSuccess, zapHash, showToast, chainId, publicClient, router, CONTRACTS.POSITION_MANAGER]);

  const formatPrice = (price: number) => {
    if (price >= 1000000) return `$${(price / 1000000).toFixed(2)}M`;
    if (price >= 1000) return `$${price.toLocaleString()}`;
    return `$${price.toFixed(2)}`;
  };

  const formatBalance = (balance: bigint | undefined, decimals: number) => {
    if (!balance) return '0';
    return parseFloat(formatUnits(balance, decimals)).toFixed(4);
  };

  // Get range strategy name for display
  const getRangeStrategyName = () => {
    switch (rangeStrategy) {
      case 'full': return 'Full Range';
      case 'wide': return 'Wide Range';
      case 'concentrated': return 'Concentrated';
      default: return 'Custom';
    }
  };

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-2xl bg-surface-card border border-gray-800/50 py-12 text-center">
          <p className="text-lg text-text-secondary">Please connect your wallet to create a position</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-20 py-6 lg:py-10">
      <section className="w-full max-w-6xl mx-auto">
        {/* Stepper */}
        <Stepper currentStep={step} />

        {/* Body - Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[35%_65%] bg-surface-card rounded-b-2xl border border-t-0 border-gray-800/50">
          {/* Left / Preview */}
          <div className="p-5 lg:border-r border-[#C5ECEB] dark:border-gray-700">
            <h3 className="text-base font-bold text-brand-medium mb-2">Preview</h3>
            <p className="text-text-secondary text-sm font-medium max-w-48 mb-8">
              Here&apos;s a quick summary of your selections so far
            </p>

            <PositionSummaryCard
              currentStep={step}
              token0Data={token0Data}
              token1Data={token1Data}
              fee={fee}
              rangeStrategy={step >= 2 ? getRangeStrategyName() : undefined}
              minPrice={step >= 2 ? formatPrice(priceRange[0]) : undefined}
              maxPrice={step >= 2 ? formatPrice(priceRange[1]) : undefined}
              currentPrice={step >= 2 ? formatPrice(currentPrice) : undefined}
              isInRange={isInRange}
            />
          </div>

          {/* Right / Selection */}
          <div>
            {/* Step 1: Select Tokens */}
            {step === 1 && (
              <div className="px-6 lg:px-10 py-10">
                <h3 className="text-base font-bold text-brand-medium mb-2">Select Tokens</h3>
                <p className="text-text-secondary text-sm font-medium mb-8">
                  Choose the token pair and fee tier for your liquidity position
                </p>

                {/* Token selectors */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10 max-w-xl">
                  <div>
                    <label className="block text-xs text-text-secondary font-medium mb-2">Token 1</label>
                    <div className="relative">
                      <select
                        value={token0}
                        onChange={(e) => setToken0(e.target.value)}
                        className="w-full bg-surface-page dark:bg-gray-800 rounded-xl px-4 py-3 text-text-primary text-sm font-medium border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-brand-medium appearance-none cursor-pointer"
                      >
                        <option value="">Select token</option>
                        {TOKENS.filter(t => t.address.toLowerCase() !== token1.toLowerCase()).map((token) => (
                          <option key={token.address} value={token.address}>{token.symbol}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary font-medium mb-2">Token 2</label>
                    <div className="relative">
                      <select
                        value={token1}
                        onChange={(e) => setToken1(e.target.value)}
                        className="w-full bg-surface-page dark:bg-gray-800 rounded-xl px-4 py-3 text-text-primary text-sm font-medium border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-brand-medium appearance-none cursor-pointer"
                      >
                        <option value="">Select token</option>
                        {TOKENS.filter(t => t.address.toLowerCase() !== token0.toLowerCase()).map((token) => (
                          <option key={token.address} value={token.address}>{token.symbol}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Fee tier */}
                <h3 className="text-base font-bold text-brand-medium mb-2">Fee Tier</h3>
                <p className="text-text-secondary text-sm font-medium mb-6 max-w-xl">
                  Select how much trading fee you earn when users swap through this pool
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 mb-12 max-w-3xl">
                  {FEE_TIERS.map((tier) => (
                    <div
                      key={tier.value}
                      onClick={() => setFee(tier.value)}
                      className={cn(
                        'rounded-2xl p-6 cursor-pointer transition-all',
                        fee === tier.value
                          ? 'bg-gradient-hard text-white'
                          : 'border border-[#CDEEEE] dark:border-gray-700 text-brand-medium hover:border-brand-medium'
                      )}
                    >
                      <h3 className={cn('text-base font-bold mb-2', fee === tier.value ? 'text-white' : 'text-text-primary')}>{tier.label}</h3>
                      <p className={cn('text-sm', fee === tier.value ? 'text-white/90' : 'text-text-secondary')}>{tier.description}</p>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => {
                    setStep(2);
                    setSingleTokenAddress(token0);
                  }}
                  disabled={!token0 || !token1}
                  className="w-full max-w-3xl py-3 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            )}

            {/* Step 2: Set Price Range */}
            {step === 2 && (
              <div className="p-6 lg:p-12">
                <div className="mb-10">
                  <h2 className="text-base font-bold text-brand-medium mb-2">Set Price Range</h2>
                  <p className="text-text-secondary text-sm font-medium">
                    Choose a range strategy for your liquidity position
                  </p>
                </div>

                {/* Price scale */}
                <div className="mb-10">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <div className="text-sm text-text-primary">Min price</div>
                      <div className="text-brand-medium font-semibold">{formatPrice(priceRange[0])}</div>
                    </div>
                    <span className="text-xs font-medium text-[#2C6E68] dark:text-brand-soft bg-[#C5ECEB] dark:bg-brand-medium/20 rounded-xl px-2 py-1 text-center">
                      <span className="block">Current price</span>
                      <span className="block">{formatPrice(currentPrice)}</span>
                    </span>
                    <div className="text-right">
                      <div className="text-sm text-text-primary">Max price</div>
                      <div className="text-brand-medium font-semibold">{formatPrice(priceRange[1])}</div>
                    </div>
                  </div>

                  <div className="relative py-2">
                    <Slider
                      min={absoluteMin}
                      max={absoluteMax}
                      step={Math.max(0.000001, (absoluteMax - absoluteMin) / 1000)}
                      value={priceRange[0] > 0 || priceRange[1] > 0 ? priceRange : [absoluteMin, absoluteMax]}
                      onValueChange={(values) => {
                        setPriceRange(values);
                        setRangeStrategy('custom');
                      }}
                      className="w-full"
                    />
                  </div>

                  <div className="flex justify-between text-sm text-text-muted mt-3">
                    <span>{formatPrice(absoluteMin)}</span>
                    <span>{formatPrice(absoluteMax)}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-gray-100 dark:bg-gray-800/50 px-6 py-4 mb-6">
                  <div className="flex items-center gap-4">
                    <span className={cn('inline-flex items-center gap-2 rounded-full text-sm font-medium', isInRange ? 'text-status-success' : 'text-status-warning')}>
                      {isInRange ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                      {isInRange ? 'In Range' : 'Out of Range'}
                    </span>
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <span className={cn('h-2.5 w-2.5 rounded-full', isInRange ? 'bg-status-success' : 'bg-status-warning')} />
                      {isInRange ? 'Earning fees' : 'Not earning fees'}
                    </div>
                  </div>
                  <div className="text-sm text-text-secondary">
                    Your range: <span className="font-semibold">{formatPrice(priceRange[0])} – {formatPrice(priceRange[1])}</span>
                  </div>
                </div>

                {/* How it works */}
                <div className="flex gap-4 rounded-2xl bg-gray-100 dark:bg-gray-800/50 p-6 mb-12">
                  <Info className="h-5 w-5 text-brand-medium flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-base text-text-primary mb-1">How it works</div>
                    <p className="text-[13px] text-text-secondary font-medium">
                      While the market price is between your Min and Max, your liquidity is active and earning fees.
                      Price moves outside? Earned fees pause.
                    </p>
                  </div>
                </div>

                {/* Range strategy */}
                <div className="mb-12">
                  <h3 className="text-base font-bold text-brand-medium mb-2">Range Strategy</h3>
                  <p className="text-text-secondary text-sm font-medium mb-6">
                    Pick a ready-made range based on your risk level
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
                    {[
                      { key: 'full' as RangeStrategy, title: 'Full range', description: 'Liquidity at all prices. Lowest fees, lowest risks' },
                      { key: 'wide' as RangeStrategy, title: 'Wide range', description: '50% around current price. Balanced approach' },
                      { key: 'concentrated' as RangeStrategy, title: 'Concentrated', description: '10% around current price. Higher fees, higher risk' },
                    ].map((s) => (
                      <div
                        key={s.key}
                        onClick={() => handleStrategyChange(s.key)}
                        className={cn(
                          'rounded-2xl p-6 cursor-pointer transition-all',
                          rangeStrategy === s.key
                            ? 'bg-gradient-hard text-white'
                            : 'border border-[#CDEEEE] dark:border-gray-700 text-text-primary hover:border-brand-medium'
                        )}
                      >
                        <div className="text-lg font-semibold mb-2">{s.title}</div>
                        <p className={cn('text-sm', rangeStrategy === s.key ? 'text-white/90' : 'text-text-muted')}>{s.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <button onClick={() => setStep(1)} className="flex-1 py-3 border-2 border-brand-medium text-brand-medium hover:bg-brand-medium/10 rounded-xl font-medium transition-colors">
                    Back
                  </button>
                  <button onClick={() => setStep(3)} className="flex-1 py-3 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white">
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Deposit Amount */}
            {step === 3 && (
              <div className="p-6 lg:p-12">
                <div className="mb-8">
                  <h2 className="text-base font-bold text-brand-medium mb-2">Deposit Amount</h2>
                  <p className="text-text-secondary text-sm font-medium">Choose how to provide liquidity</p>
                </div>

                {/* Deposit Mode Toggle */}
                <div className="flex items-center gap-2 p-1 bg-gray-100 dark:bg-gray-800/50 rounded-xl w-fit mb-8">
                  <button
                    onClick={() => setDepositMode('single')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
                      depositMode === 'single' ? 'bg-gradient-hard text-white shadow-lg' : 'text-text-muted hover:text-text-primary'
                    )}
                  >
                    <Zap size={16} />
                    Single Token
                  </button>
                  <button
                    onClick={() => setDepositMode('both')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
                      depositMode === 'both' ? 'bg-gradient-hard text-white shadow-lg' : 'text-text-muted hover:text-text-primary'
                    )}
                  >
                    Both Tokens
                  </button>
                </div>

                {/* Token Prices Info */}
                {token0Data && token1Data && (token0Price !== null || token1Price !== null) && (
                  <div className="bg-brand-medium/10 border border-brand-medium/30 rounded-xl p-3 mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="text-brand-medium flex-shrink-0" size={16} />
                      <span className="text-sm font-medium text-brand-medium">Token Prices</span>
                    </div>
                    <div className="flex gap-4 text-sm text-text-secondary">
                      <span>{token0Data.symbol} = {token0Price !== null ? `$${token0Price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: token0Price < 1 ? 4 : 2 })}` : 'N/A'}</span>
                      <span>{token1Data.symbol} = {token1Price !== null ? `$${token1Price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: token1Price < 1 ? 4 : 2 })}` : 'N/A'}</span>
                    </div>
                  </div>
                )}

                {/* Single Token Mode */}
                {depositMode === 'single' && (
                  <div className="space-y-6 mb-8">
                    <div className="bg-brand-soft/10 border border-brand-soft/30 rounded-xl p-3 flex items-start gap-2">
                      <Zap className="text-brand-soft mt-0.5 flex-shrink-0" size={16} />
                      <p className="text-xs text-brand-soft">
                        Deposit a single token and we&apos;ll automatically swap a portion to create a balanced position.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2 text-text-primary">Select Token</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => token0Data && setSingleTokenAddress(token0Data.address)}
                          className={cn(
                            'p-3 rounded-xl border transition-all',
                            singleTokenAddress === token0Data?.address
                              ? 'bg-brand-medium/10 border-brand-medium text-white'
                              : 'bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 hover:border-gray-400 text-text-secondary'
                          )}
                        >
                          {token0Data?.symbol || 'Token 0'}
                        </button>
                        <button
                          onClick={() => token1Data && setSingleTokenAddress(token1Data.address)}
                          className={cn(
                            'p-3 rounded-xl border transition-all',
                            singleTokenAddress === token1Data?.address
                              ? 'bg-brand-medium/10 border-brand-medium text-white'
                              : 'bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 hover:border-gray-400 text-text-secondary'
                          )}
                        >
                          {token1Data?.symbol || 'Token 1'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-text-primary">Amount</label>
                        {singleTokenData && (
                          <span className="text-xs text-text-muted">
                            Balance: {formatBalance(singleTokenAddress === token0 ? balance0 : balance1, singleTokenData.decimals)}
                          </span>
                        )}
                      </div>
                      <input
                        type="number"
                        value={singleTokenAmount}
                        onChange={(e) => setSingleTokenAmount(e.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-brand-medium transition-colors text-text-primary"
                      />
                    </div>

                    {zapQuoteLoading && (
                      <div className="flex items-center justify-center gap-2 py-4 text-text-muted">
                        <Loader2 className="animate-spin" size={16} />
                        <span className="text-sm">Getting quote...</span>
                      </div>
                    )}

                    {zapQuote && singleTokenData && (
                      <div className="bg-gray-100 dark:bg-gray-800/30 rounded-xl p-4 border border-gray-200 dark:border-gray-700/50">
                        <div className="flex items-center gap-2 mb-3">
                          <Info size={14} className="text-brand-medium" />
                          <span className="text-sm font-medium text-text-secondary">Position Preview</span>
                        </div>
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-text-muted">Your deposit</span>
                            <span className="text-text-primary font-medium">{singleTokenAmount} {singleTokenData.symbol}</span>
                          </div>
                          {zapQuote.priceImpact > 0 && (
                            <div className="flex justify-between pt-2">
                              <span className="text-text-muted">Price Impact</span>
                              <span className={zapQuote.priceImpact > 1 ? 'text-status-warning' : 'text-status-success'}>
                                {zapQuote.priceImpact.toFixed(2)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Both Tokens Mode */}
                {depositMode === 'both' && (
                  <div className="space-y-6 mb-8">
                    {calculatePairedAmount && (
                      <div className="bg-brand-medium/10 border border-brand-medium/30 rounded-xl p-3 text-sm">
                        <div className="flex items-center gap-2 text-brand-medium">
                          <Info size={14} />
                          <span>Amounts are locked to pool ratio. Enter one amount to auto-calculate the other.</span>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-text-primary">{token0Data?.symbol} Amount</label>
                        {balance0 !== undefined && token0Data && (
                          <button
                            onClick={() => {
                              setActiveInput('amount0');
                              setAmount0(formatUnits(BigInt(balance0.toString()), token0Data.decimals));
                            }}
                            className="text-xs text-text-muted hover:text-brand-medium transition-colors"
                          >
                            Balance: {formatBalance(balance0, token0Data.decimals)} (Max)
                          </button>
                        )}
                      </div>
                      <input
                        type="number"
                        value={amount0}
                        onChange={(e) => { setActiveInput('amount0'); setAmount0(e.target.value); }}
                        placeholder="0.00"
                        step="0.01"
                        className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-brand-medium transition-colors text-text-primary"
                      />
                      {balance0 !== undefined && token0Data && amount0 && parseUnits(amount0, token0Data.decimals) > BigInt(balance0.toString()) && (
                        <div className="flex items-center gap-1 mt-1 text-status-error text-xs">
                          <AlertCircle size={12} />
                          <span>Insufficient balance</span>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-text-primary">{token1Data?.symbol} Amount</label>
                        {balance1 !== undefined && token1Data && (
                          <button
                            onClick={() => {
                              setActiveInput('amount1');
                              setAmount1(formatUnits(BigInt(balance1.toString()), token1Data.decimals));
                            }}
                            className="text-xs text-text-muted hover:text-brand-medium transition-colors"
                          >
                            Balance: {formatBalance(balance1, token1Data.decimals)} (Max)
                          </button>
                        )}
                      </div>
                      <input
                        type="number"
                        value={amount1}
                        onChange={(e) => { setActiveInput('amount1'); setAmount1(e.target.value); }}
                        placeholder="0.00"
                        step="0.01"
                        className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:border-brand-medium transition-colors text-text-primary"
                      />
                      {balance1 !== undefined && token1Data && amount1 && parseUnits(amount1, token1Data.decimals) > BigInt(balance1.toString()) && (
                        <div className="flex items-center gap-1 mt-1 text-status-error text-xs">
                          <AlertCircle size={12} />
                          <span>Insufficient balance</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {isLoadingSlot0 && (
                  <div className="flex items-center gap-2 text-xs text-text-muted mb-4">
                    <Loader2 className="animate-spin" size={12} />
                    <span>Loading pool data...</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <button onClick={() => setStep(2)} className="flex-1 py-3 border-2 border-brand-medium text-brand-medium hover:bg-brand-medium/10 rounded-xl font-medium transition-colors">
                    Back
                  </button>

                  {depositMode === 'single' ? (
                    (() => {
                      if (!singleTokenAmount || !singleTokenAddress || !singleTokenData || parseFloat(singleTokenAmount) <= 0) {
                        return (
                          <button disabled className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed">
                            <Zap size={16} />
                            Create Position
                          </button>
                        );
                      }
                      const amountWei = parseUnits(singleTokenAmount, singleTokenData.decimals);
                      const approvalAmount = amountWei * 3n;
                      const isSingleToken0 = singleTokenAddress.toLowerCase() === token0?.toLowerCase();
                      const isNativeToken = singleTokenAddress.toLowerCase() === ZERO_ADDRESS;
                      const alreadyApproved = isNativeToken || (isSingleToken0 ? isToken0Approved(approvalAmount) : isToken1Approved(approvalAmount));
                      const isApproving = isPendingApproval0 || isPendingApproval1 || isConfirmingApproval0 || isConfirmingApproval1;

                      if (!alreadyApproved) {
                        return (
                          <button
                            onClick={async () => {
                              try {
                                if (isSingleToken0) { await approveToken0(approvalAmount); refetchApproval0(); }
                                else { await approveToken1(approvalAmount); refetchApproval1(); }
                                showToast({ type: 'success', message: `${singleTokenData.symbol} approved!` });
                              } catch (error: any) {
                                showToast({ type: 'error', message: error.message || 'Approval failed' });
                              }
                            }}
                            disabled={isApproving}
                            className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium text-white disabled:opacity-50 transition-all"
                          >
                            {isApproving && <Loader2 className="animate-spin" size={18} />}
                            {isApproving ? 'Approving...' : `Approve ${singleTokenData.symbol}`}
                          </button>
                        );
                      }

                      return (
                        <button
                          onClick={handleZap}
                          disabled={zapIsPending || zapIsConfirming}
                          className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {(zapIsPending || zapIsConfirming) && <Loader2 className="animate-spin" size={18} />}
                          {zapIsPending ? 'Confirm in Wallet...' : zapIsConfirming ? 'Creating...' : (<><Zap size={16} />Create Position</>)}
                        </button>
                      );
                    })()
                  ) : (
                    (() => {
                      if (!amount0 || !amount1 || !token0Data || !token1Data || parseFloat(amount0) <= 0 || parseFloat(amount1) <= 0) {
                        return (
                          <button disabled className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed">
                            Create Position
                          </button>
                        );
                      }
                      const amount0Wei = parseUnits(amount0, token0Data.decimals);
                      const amount1Wei = parseUnits(amount1, token1Data.decimals);
                      const token0NeedsApproval = !token0IsNative && !isToken0Approved(amount0Wei);
                      const token1NeedsApproval = !token1IsNative && !isToken1Approved(amount1Wei);
                      const needsApproval = token0NeedsApproval || token1NeedsApproval;
                      const isApproving = isPendingApproval0 || isPendingApproval1 || isConfirmingApproval0 || isConfirmingApproval1;

                      if (needsApproval) {
                        const tokenToApprove = token0NeedsApproval ? token0Data.symbol : token1Data.symbol;
                        return (
                          <button
                            onClick={async () => {
                              try {
                                if (token0NeedsApproval) { await approveToken0(amount0Wei); refetchApproval0(); showToast({ type: 'success', message: `${token0Data.symbol} approved!` }); }
                                if (token1NeedsApproval) { await approveToken1(amount1Wei); refetchApproval1(); showToast({ type: 'success', message: `${token1Data.symbol} approved!` }); }
                              } catch (error: any) {
                                showToast({ type: 'error', message: error.message || 'Approval failed' });
                              }
                            }}
                            disabled={isApproving}
                            className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium text-white disabled:opacity-50 transition-all"
                          >
                            {isApproving && <Loader2 className="animate-spin" size={18} />}
                            {isApproving ? 'Approving...' : `Approve ${tokenToApprove}`}
                          </button>
                        );
                      }

                      return (
                        <button
                          onClick={handleMintPosition}
                          disabled={isPending || isConfirming || !poolPriceInfo.isRealistic}
                          className="flex-1 py-3 flex items-center justify-center gap-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {(isPending || isConfirming) && <Loader2 className="animate-spin" size={18} />}
                          {isPending ? 'Confirm in Wallet...' : isConfirming ? 'Creating...' : !poolPriceInfo.isRealistic ? 'Pool Price Invalid' : 'Create Position'}
                        </button>
                      );
                    })()
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
