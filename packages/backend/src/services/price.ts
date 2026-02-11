/**
 * Price Service - Multi-source token USD pricing
 *
 * Features:
 * - Fetch token prices in USD via CoinGecko, DeFiLlama, Binance
 * - 5-minute price caching
 * - Stablecoin detection (no API call needed)
 * - Batch price fetching for efficiency
 * - Per-provider circuit breakers for resilience
 * - Liquidity math for position value calculation
 */

import axios from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { memoryCache, CACHE_TTL } from './cache.js';

const priceLogger = logger.child({ service: 'price' });

// ============ Constants ============

// USDC addresses per chain (quote currency for pricing)
export const USDC_ADDRESSES: Record<number, string> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',     // Base Mainnet
};

// WETH addresses per chain (for native ETH pricing)
export const WETH_ADDRESSES: Record<number, string> = {
  8453: '0x4200000000000000000000000000000000000006',     // Base Mainnet
};

// Native ETH address (zero address)
const NATIVE_ETH = '0x0000000000000000000000000000000000000000';

// Known stablecoins (price = $1.00)
const STABLECOINS: Record<number, Set<string>> = {
  8453: new Set([
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
  ]),
};

// Token info map (symbol, decimals) for common tokens
export const TOKEN_INFO: Record<number, Record<string, { symbol: string; decimals: number }>> = {
  8453: {
    // Native & Wrapped
    '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18 },
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
    // Stablecoins
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 },
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC', decimals: 6 },
    // LSTs
    '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': { symbol: 'wstETH', decimals: 18 },
    '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH', decimals: 18 },
    '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c': { symbol: 'rETH', decimals: 18 },
    // BTC
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
    // Popular tokens
    '0x532f27101965dd16442e59d40670faf5ebb142e4': { symbol: 'BRETT', decimals: 18 },
    '0x0578d8a44db98b23bf096a382e016e29a5ce0ffe': { symbol: 'HIGHER', decimals: 18 },
    '0x768be13e1680b5ebe0024c42c896e3db59ec0149': { symbol: 'MOCHI', decimals: 18 },
    '0x4ed4e862860bed51a9570b96d89af5e1b0efefed': { symbol: 'DEGEN', decimals: 18 },
    '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4': { symbol: 'TOSHI', decimals: 18 },
    '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO', decimals: 18 },
    '0x2416092f143378750bb29b79ed961ab195cceea5': { symbol: 'ezETH', decimals: 18 },
    '0x04c0599ae5a44757c0af6f9ec3b93da8976c150a': { symbol: 'weETH', decimals: 18 },
    '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': { symbol: 'USDT', decimals: 6 },
  },
};

// ============ Types ============

export interface TokenPrice {
  address: string;
  symbol: string;
  decimals: number;
  priceUSD: number | null;
  cached: boolean;
  timestamp: number;
  source?: string;
  error?: string;
}

export interface PositionUSDValues {
  token0Amount: string;
  token1Amount: string;
  token0PriceUSD: number | null;
  token1PriceUSD: number | null;
  token0ValueUSD: number | null;
  token1ValueUSD: number | null;
  totalValueUSD: number | null;
  pendingFeesUSD: number | null;
  collectedFeesUSD: number | null;
}

// ============ Per-Provider Circuit Breakers ============

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60_000; // 60 seconds

const providerCircuitBreakers: Record<string, CircuitBreakerState> = {
  coingecko: { failures: 0, lastFailure: 0, isOpen: false },
  defillama: { failures: 0, lastFailure: 0, isOpen: false },
  binance: { failures: 0, lastFailure: 0, isOpen: false },
};

function recordProviderSuccess(provider: string): void {
  const cb = providerCircuitBreakers[provider];
  if (cb) { cb.failures = 0; cb.isOpen = false; }
}

function recordProviderFailure(provider: string): void {
  const cb = providerCircuitBreakers[provider];
  if (!cb) return;
  cb.failures++;
  cb.lastFailure = Date.now();
  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.isOpen = true;
    priceLogger.warn({ provider, failures: cb.failures }, `Circuit breaker opened for ${provider}`);
  }
}

function isProviderCircuitOpen(provider: string): boolean {
  const cb = providerCircuitBreakers[provider];
  if (!cb || !cb.isOpen) return false;
  if (Date.now() - cb.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
    cb.isOpen = false;
    cb.failures = 0;
    priceLogger.info({ provider }, `Circuit breaker reset for ${provider}`);
    return false;
  }
  return true;
}

// ============ Provider Configuration ============

// CoinGecko asset platform IDs per chain
const COINGECKO_PLATFORM_IDS: Record<number, string> = {
  8453: 'base',
  1: 'ethereum',
};

// DeFiLlama chain identifiers
const DEFILLAMA_CHAIN_IDS: Record<number, string> = {
  8453: 'base',
  1: 'ethereum',
};

// Binance symbol mapping for major tokens (lowercase address → trading pair)
const BINANCE_SYMBOL_MAP: Record<string, string> = {
  '0x4200000000000000000000000000000000000006': 'ETHUSDT',  // WETH (Base)
  '0x0000000000000000000000000000000000000000': 'ETHUSDT',  // Native ETH
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'BTCUSDT', // cbBTC ≈ BTC
};

// ============ Cache Keys ============

const PRICE_CACHE_KEY = (chainId: number, address: string) =>
  `price_${chainId}_${address.toLowerCase()}`;

const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============ Helper Functions ============

function getTokenInfo(address: string, chainId: number): { symbol: string; decimals: number } {
  const normalized = address.toLowerCase();
  const chainTokens = TOKEN_INFO[chainId] || TOKEN_INFO[8453];
  return chainTokens[normalized] || { symbol: address.slice(0, 6), decimals: 18 };
}

function isStablecoin(address: string, chainId: number): boolean {
  const normalized = address.toLowerCase();
  const chainStables = STABLECOINS[chainId];
  return chainStables?.has(normalized) || false;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Convert native ETH address to WETH for API lookups
 */
function toApiAddress(tokenAddress: string, chainId: number): string | null {
  const normalized = normalizeAddress(tokenAddress);
  if (normalized === NATIVE_ETH.toLowerCase()) {
    return WETH_ADDRESSES[chainId]?.toLowerCase() || null;
  }
  return normalized;
}

// ============ Price Providers ============

/**
 * Fetch token price from CoinGecko (primary source)
 */
async function fetchCoinGeckoPrice(
  tokenAddress: string,
  chainId: number
): Promise<number | null> {
  if (isProviderCircuitOpen('coingecko')) return null;

  const platformId = COINGECKO_PLATFORM_IDS[chainId];
  if (!platformId) {
    priceLogger.debug({ chainId }, 'CoinGecko platform not configured for chain');
    return null;
  }

  const apiAddress = toApiAddress(tokenAddress, chainId);
  if (!apiAddress) return null;

  try {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    const baseUrl = config.COINGECKO_API_KEY
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';

    if (config.COINGECKO_API_KEY) {
      headers['x-cg-pro-api-key'] = config.COINGECKO_API_KEY;
    }

    const response = await axios.get(
      `${baseUrl}/simple/token_price/${platformId}`,
      {
        headers,
        params: {
          contract_addresses: apiAddress,
          vs_currencies: 'usd',
        },
        timeout: 10_000,
      }
    );

    const priceData = response.data[apiAddress];
    if (priceData?.usd) {
      recordProviderSuccess('coingecko');
      priceLogger.debug({ token: apiAddress, price: priceData.usd, source: 'coingecko' }, 'CoinGecko price fetched');
      return priceData.usd;
    }

    return null;
  } catch (error) {
    recordProviderFailure('coingecko');
    if (axios.isAxiosError(error)) {
      priceLogger.debug({ status: error.response?.status, token: apiAddress }, 'CoinGecko price fetch failed');
    } else {
      priceLogger.debug({ error, token: apiAddress }, 'CoinGecko price fetch error');
    }
    return null;
  }
}

/**
 * Fetch token price from DeFiLlama (fallback 1)
 * Free, no API key, supports any on-chain token
 */
async function fetchDeFiLlamaPrice(
  tokenAddress: string,
  chainId: number
): Promise<number | null> {
  if (isProviderCircuitOpen('defillama')) return null;

  const chainName = DEFILLAMA_CHAIN_IDS[chainId];
  if (!chainName) return null;

  const apiAddress = toApiAddress(tokenAddress, chainId);
  if (!apiAddress) return null;

  try {
    const coinKey = `${chainName}:${apiAddress}`;
    const response = await axios.get(
      `https://coins.llama.fi/prices/current/${coinKey}`,
      { timeout: 10_000 }
    );

    const priceData = response.data?.coins?.[coinKey];
    if (priceData?.price && priceData.confidence > 0.5) {
      recordProviderSuccess('defillama');
      priceLogger.debug({ token: apiAddress, price: priceData.price, source: 'defillama' }, 'DeFiLlama price fetched');
      return priceData.price;
    }

    return null;
  } catch (error) {
    recordProviderFailure('defillama');
    if (axios.isAxiosError(error)) {
      priceLogger.debug({ status: error.response?.status, token: apiAddress }, 'DeFiLlama price fetch failed');
    } else {
      priceLogger.debug({ error, token: apiAddress }, 'DeFiLlama price fetch error');
    }
    return null;
  }
}

/**
 * Fetch token price from Binance (fallback 2)
 * Free, no API key. Only works for tokens with known Binance trading pairs.
 */
async function fetchBinancePrice(
  tokenAddress: string
): Promise<number | null> {
  if (isProviderCircuitOpen('binance')) return null;

  const normalized = normalizeAddress(tokenAddress);
  const symbol = BINANCE_SYMBOL_MAP[normalized];
  if (!symbol) return null;

  try {
    const response = await axios.get(
      'https://api.binance.com/api/v3/ticker/price',
      {
        params: { symbol },
        timeout: 5_000,
      }
    );

    const price = parseFloat(response.data?.price);
    if (price > 0) {
      recordProviderSuccess('binance');
      priceLogger.debug({ symbol, price, source: 'binance' }, 'Binance price fetched');
      return price;
    }

    return null;
  } catch (error) {
    recordProviderFailure('binance');
    if (axios.isAxiosError(error)) {
      priceLogger.debug({ status: error.response?.status, symbol }, 'Binance price fetch failed');
    } else {
      priceLogger.debug({ error, symbol }, 'Binance price fetch error');
    }
    return null;
  }
}

// ============ Main Price Functions ============

/**
 * Get token price in USD with caching and multi-source fallback
 * Tries: CoinGecko → DeFiLlama → Binance
 */
export async function getTokenPriceUSD(
  tokenAddress: string,
  chainId: number
): Promise<TokenPrice> {
  const normalized = normalizeAddress(tokenAddress);
  const tokenInfo = getTokenInfo(tokenAddress, chainId);
  const timestamp = Date.now();

  // Check for stablecoins (return $1.00)
  if (isStablecoin(normalized, chainId)) {
    return {
      address: normalized,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      priceUSD: 1.0,
      cached: false,
      timestamp,
      source: 'stablecoin',
    };
  }

  // Check cache
  const cacheKey = PRICE_CACHE_KEY(chainId, normalized);
  const cached = memoryCache.get<number>(cacheKey);

  if (cached !== null) {
    return {
      address: normalized,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      priceUSD: cached,
      cached: true,
      timestamp,
    };
  }

  // Try providers in order: CoinGecko → DeFiLlama → Binance
  let priceUSD: number | null = null;
  let priceSource = '';

  // Provider 1: CoinGecko
  priceUSD = await fetchCoinGeckoPrice(tokenAddress, chainId);
  priceSource = 'coingecko';

  // Provider 2: DeFiLlama
  if (priceUSD === null) {
    priceUSD = await fetchDeFiLlamaPrice(tokenAddress, chainId);
    priceSource = 'defillama';
  }

  // Provider 3: Binance (for major tokens only)
  if (priceUSD === null) {
    priceUSD = await fetchBinancePrice(tokenAddress);
    priceSource = 'binance';
  }

  // Cache the result
  if (priceUSD !== null) {
    memoryCache.set(cacheKey, priceUSD, PRICE_CACHE_TTL);
    priceLogger.debug({ token: tokenInfo.symbol, priceUSD, source: priceSource }, 'Price resolved');
  }

  return {
    address: normalized,
    symbol: tokenInfo.symbol,
    decimals: tokenInfo.decimals,
    priceUSD,
    cached: false,
    timestamp,
    source: priceUSD !== null ? priceSource : undefined,
    error: priceUSD === null ? 'Price unavailable from all sources (CoinGecko, DeFiLlama, Binance)' : undefined,
  };
}

/**
 * Get multiple token prices in batch
 */
export async function getBatchPrices(
  tokenAddresses: string[],
  chainId: number
): Promise<Map<string, TokenPrice>> {
  const results = new Map<string, TokenPrice>();
  const uniqueAddresses = [...new Set(tokenAddresses.map(normalizeAddress))];

  // Fetch all prices in parallel
  const pricePromises = uniqueAddresses.map(async (address) => {
    const price = await getTokenPriceUSD(address, chainId);
    results.set(address, price);
  });

  await Promise.all(pricePromises);

  return results;
}

// ============ Liquidity Math ============

/**
 * Convert tick to sqrtRatioX96
 */
export function tickToSqrtRatioX96(tick: number): bigint {
  const absTick = Math.abs(tick);

  // Using the formula: sqrt(1.0001^tick) * 2^96
  const sqrtRatio = Math.sqrt(1.0001 ** tick);
  const Q96 = 2n ** 96n;

  return BigInt(Math.floor(sqrtRatio * Number(Q96)));
}

/**
 * Calculate token amounts from liquidity and tick range
 */
export function liquidityToAmounts(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number
): { amount0: bigint; amount1: bigint } {
  const Q96 = 2n ** 96n;

  const sqrtRatioA = tickToSqrtRatioX96(tickLower);
  const sqrtRatioB = tickToSqrtRatioX96(tickUpper);

  // Clamp current price to range
  let sqrtRatioCurrent = sqrtPriceX96;
  if (sqrtPriceX96 < sqrtRatioA) {
    sqrtRatioCurrent = sqrtRatioA;
  } else if (sqrtPriceX96 > sqrtRatioB) {
    sqrtRatioCurrent = sqrtRatioB;
  }

  // Calculate amounts
  // amount0 = L * (sqrt(upper) - sqrt(current)) / (sqrt(current) * sqrt(upper))
  // amount1 = L * (sqrt(current) - sqrt(lower))

  let amount0 = 0n;
  let amount1 = 0n;

  if (sqrtPriceX96 < sqrtRatioA) {
    // Below range: all token0
    amount0 = (liquidity * Q96 * (sqrtRatioB - sqrtRatioA)) / (sqrtRatioA * sqrtRatioB);
  } else if (sqrtPriceX96 >= sqrtRatioB) {
    // Above range: all token1
    amount1 = (liquidity * (sqrtRatioB - sqrtRatioA)) / Q96;
  } else {
    // In range: both tokens
    amount0 = (liquidity * Q96 * (sqrtRatioB - sqrtRatioCurrent)) / (sqrtRatioCurrent * sqrtRatioB);
    amount1 = (liquidity * (sqrtRatioCurrent - sqrtRatioA)) / Q96;
  }

  return { amount0, amount1 };
}

/**
 * Calculate position value in USD
 */
export async function calculatePositionValueUSD(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  token0Address: string,
  token1Address: string,
  chainId: number,
  pendingFees?: { amount0: bigint; amount1: bigint },
  collectedFees?: { amount0: bigint; amount1: bigint }
): Promise<PositionUSDValues> {
  // Get token amounts from liquidity
  const { amount0, amount1 } = liquidityToAmounts(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper
  );

  // Get token info for decimals
  const token0Info = getTokenInfo(token0Address, chainId);
  const token1Info = getTokenInfo(token1Address, chainId);

  // Fetch prices in parallel
  const [price0, price1] = await Promise.all([
    getTokenPriceUSD(token0Address, chainId),
    getTokenPriceUSD(token1Address, chainId),
  ]);

  // Format amounts as strings
  const token0AmountFormatted = formatTokenAmount(amount0, token0Info.decimals);
  const token1AmountFormatted = formatTokenAmount(amount1, token1Info.decimals);

  // Calculate USD values
  let token0ValueUSD: number | null = null;
  let token1ValueUSD: number | null = null;
  let totalValueUSD: number | null = null;
  let pendingFeesUSD: number | null = null;
  let collectedFeesUSD: number | null = null;

  if (price0.priceUSD !== null) {
    const amount0Decimal = Number(amount0) / (10 ** token0Info.decimals);
    token0ValueUSD = amount0Decimal * price0.priceUSD;
  }

  if (price1.priceUSD !== null) {
    const amount1Decimal = Number(amount1) / (10 ** token1Info.decimals);
    token1ValueUSD = amount1Decimal * price1.priceUSD;
  }

  if (token0ValueUSD !== null && token1ValueUSD !== null) {
    totalValueUSD = token0ValueUSD + token1ValueUSD;
  }

  // Calculate pending fees USD
  if (pendingFees && price0.priceUSD !== null && price1.priceUSD !== null) {
    const fees0Decimal = Number(pendingFees.amount0) / (10 ** token0Info.decimals);
    const fees1Decimal = Number(pendingFees.amount1) / (10 ** token1Info.decimals);
    pendingFeesUSD = (fees0Decimal * price0.priceUSD) + (fees1Decimal * price1.priceUSD);
  }

  // Calculate collected fees USD
  if (collectedFees && price0.priceUSD !== null && price1.priceUSD !== null) {
    const fees0Decimal = Number(collectedFees.amount0) / (10 ** token0Info.decimals);
    const fees1Decimal = Number(collectedFees.amount1) / (10 ** token1Info.decimals);
    collectedFeesUSD = (fees0Decimal * price0.priceUSD) + (fees1Decimal * price1.priceUSD);
  }

  return {
    token0Amount: token0AmountFormatted,
    token1Amount: token1AmountFormatted,
    token0PriceUSD: price0.priceUSD,
    token1PriceUSD: price1.priceUSD,
    token0ValueUSD,
    token1ValueUSD,
    totalValueUSD,
    pendingFeesUSD,
    collectedFeesUSD,
  };
}

/**
 * Format token amount to human-readable string
 */
function formatTokenAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;

  if (remainder === 0n) {
    return whole.toString();
  }

  const remainderStr = remainder.toString().padStart(decimals, '0');
  const trimmed = remainderStr.replace(/0+$/, '');

  return `${whole}.${trimmed}`;
}

// ============ APY Calculation ============

export interface USDMetrics {
  positionValueUSD: number | null;
  totalFeesEarnedUSD: number | null;
  pendingFeesUSD: number | null;
  apyUSD: number | null;
  dailyFeeRateUSD: number | null;
  priceError?: string;
}

/**
 * Calculate USD-based APY for a position
 */
export async function calculateUSDMetrics(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  token0Address: string,
  token1Address: string,
  chainId: number,
  pendingFees: { amount0: bigint; amount1: bigint },
  collectedFees: { amount0: bigint; amount1: bigint },
  createdAtTimestamp: number
): Promise<USDMetrics> {
  // Calculate position value
  const usdValues = await calculatePositionValueUSD(
    liquidity,
    sqrtPriceX96,
    tickLower,
    tickUpper,
    token0Address,
    token1Address,
    chainId,
    pendingFees,
    collectedFees
  );

  // Calculate total fees (pending + collected)
  const totalFeesEarnedUSD = (usdValues.pendingFeesUSD ?? 0) + (usdValues.collectedFeesUSD ?? 0);

  // Calculate APY if we have position value
  let apyUSD: number | null = null;
  let dailyFeeRateUSD: number | null = null;

  if (usdValues.totalValueUSD !== null && usdValues.totalValueUSD > 0) {
    const now = Math.floor(Date.now() / 1000);
    const daysActive = Math.max(1, (now - createdAtTimestamp) / 86400);

    // APY = (totalFees / positionValue) * (365 / daysActive) * 100
    apyUSD = (totalFeesEarnedUSD / usdValues.totalValueUSD) * (365 / daysActive) * 100;

    // Daily fee rate
    dailyFeeRateUSD = totalFeesEarnedUSD / daysActive;
  }

  const hasPriceError = usdValues.token0PriceUSD === null || usdValues.token1PriceUSD === null;

  return {
    positionValueUSD: usdValues.totalValueUSD,
    totalFeesEarnedUSD: totalFeesEarnedUSD > 0 ? totalFeesEarnedUSD : null,
    pendingFeesUSD: usdValues.pendingFeesUSD,
    apyUSD,
    dailyFeeRateUSD,
    priceError: hasPriceError ? 'Some token prices unavailable' : undefined,
  };
}

// ============ Exports ============

export { getTokenInfo, isStablecoin, PRICE_CACHE_TTL };
