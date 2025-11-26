import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Token metadata for price lookups
 */
export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  coingeckoId: string;
  mainnetAddress: string;
}

/**
 * Price cache entry
 */
interface PriceCache {
  price: number;
  timestamp: number;
}

/**
 * Production-ready price service for testnet and mainnet
 *
 * Features:
 * - Token address mapping (testnet → mainnet)
 * - Coingecko API integration with error handling
 * - In-memory caching (60s TTL)
 * - Batch price fetching
 * - Fallback prices for reliability
 */
@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);
  private readonly cache = new Map<string, PriceCache>();
  private readonly CACHE_TTL = 60000; // 60 seconds
  private readonly isTestnet: boolean;

  /**
   * Token registry: Maps testnet addresses to mainnet token metadata
   * For mainnet deployment, use mainnet addresses directly
   */
  private readonly TOKEN_REGISTRY: Record<string, TokenMetadata> = {
    // Sepolia WETH → Mainnet WETH metadata
    '0x8b86719beecd8004569f429549177b9b25c6555a': {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      coingeckoId: 'weth',
      mainnetAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    },

    // Sepolia USDC → Mainnet USDC metadata
    '0xbaa74e10f7edbc3fcda7508c27a8f5599d79b09c': {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      coingeckoId: 'usd-coin',
      mainnetAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
  };

  /**
   * Fallback prices used when all APIs fail
   * Provides reasonable defaults for demo reliability
   */
  private readonly FALLBACK_PRICES: Record<string, number> = {
    'weth': 3500,
    'usd-coin': 1.0,
  };

  constructor(private readonly config: ConfigService) {
    const chainId = this.config.get<number>('CHAIN_ID', 11155111);
    this.isTestnet = chainId !== 1;

    if (this.isTestnet) {
      this.logger.log('🧪 Running in TESTNET mode - using mainnet price mapping');
    } else {
      this.logger.log('🚀 Running in MAINNET mode');
    }
  }

  /**
   * Get price for a single token
   * @param tokenAddress - Token contract address (testnet or mainnet)
   * @returns Price in USD
   */
  async getTokenPrice(tokenAddress: string): Promise<number> {
    const normalized = tokenAddress.toLowerCase();

    // Check cache first (fastest path)
    const cached = this.getCachedPrice(normalized);
    if (cached !== null) {
      this.logger.debug(`Cache hit for ${tokenAddress}: $${cached.toFixed(2)}`);
      return cached;
    }

    // Get token metadata
    const metadata = this.TOKEN_REGISTRY[normalized];
    if (!metadata) {
      this.logger.warn(`Unknown token: ${tokenAddress}`);
      return 0;
    }

    // Fetch price from Coingecko
    try {
      const price = await this.fetchPrice(metadata);
      this.setCachedPrice(normalized, price);
      return price;
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${metadata.symbol}:`, error.message);

      // Return fallback price for reliability
      const fallback = this.FALLBACK_PRICES[metadata.coingeckoId] || 0;
      if (fallback > 0) {
        this.logger.warn(`Using fallback price for ${metadata.symbol}: $${fallback}`);
      }
      return fallback;
    }
  }

  /**
   * Get prices for multiple tokens (optimized batch request)
   * @param addresses - Array of token addresses
   * @returns Record of address → price
   */
  async getTokenPrices(addresses: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};

    // Separate cached vs uncached tokens
    const uncached: string[] = [];

    for (const address of addresses) {
      const normalized = address.toLowerCase();
      const cached = this.getCachedPrice(normalized);

      if (cached !== null) {
        prices[normalized] = cached;
      } else {
        uncached.push(normalized);
      }
    }

    // Batch fetch uncached prices
    if (uncached.length > 0) {
      this.logger.log(`Fetching prices for ${uncached.length} tokens...`);
      const batchPrices = await this.batchFetchPrices(uncached);
      Object.assign(prices, batchPrices);
    }

    return prices;
  }

  /**
   * Get token metadata by address
   * @param tokenAddress - Token contract address
   * @returns Token metadata or null if unknown
   */
  getTokenMetadata(tokenAddress: string): TokenMetadata | null {
    const normalized = tokenAddress.toLowerCase();
    const metadata = this.TOKEN_REGISTRY[normalized] || null;
    this.logger.debug(`getTokenMetadata(${tokenAddress}) => normalized: ${normalized} => found: ${metadata ? metadata.symbol : 'NULL'}`);
    return metadata;
  }

  /**
   * Get all supported tokens
   * @returns Array of supported token metadata
   */
  getSupportedTokens(): TokenMetadata[] {
    return Object.values(this.TOKEN_REGISTRY);
  }

  /**
   * Get all testnet token addresses
   * @returns Array of testnet token addresses
   */
  getTestnetAddresses(): string[] {
    return Object.keys(this.TOKEN_REGISTRY);
  }

  /**
   * Fetch price from Coingecko API
   * @param metadata - Token metadata
   * @returns Price in USD
   * @private
   */
  private async fetchPrice(metadata: TokenMetadata): Promise<number> {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${metadata.coingeckoId}&vs_currencies=usd`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      // Timeout after 5 seconds
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Coingecko API returned ${response.status}`);
    }

    const data = await response.json();
    const price = data[metadata.coingeckoId]?.usd;

    if (typeof price !== 'number' || price <= 0) {
      throw new Error(`Invalid price data for ${metadata.symbol}`);
    }

    this.logger.log(`✓ ${metadata.symbol}: $${price.toFixed(2)}`);
    return price;
  }

  /**
   * Batch fetch prices from Coingecko
   * @param addresses - Array of token addresses
   * @returns Record of address → price
   * @private
   */
  private async batchFetchPrices(addresses: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {};

    // Build Coingecko ID list and mapping
    const coingeckoIds: string[] = [];
    const idToAddress: Record<string, string> = {};

    for (const address of addresses) {
      const metadata = this.TOKEN_REGISTRY[address];
      if (metadata) {
        coingeckoIds.push(metadata.coingeckoId);
        idToAddress[metadata.coingeckoId] = address;
      }
    }

    if (coingeckoIds.length === 0) {
      return prices;
    }

    try {
      // Single batch request for all tokens
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds.join(',')}&vs_currencies=usd`;

      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Coingecko API returned ${response.status}`);
      }

      const data = await response.json();

      // Map prices back to addresses and cache
      for (const [coingeckoId, address] of Object.entries(idToAddress)) {
        const price = data[coingeckoId]?.usd;
        if (typeof price === 'number' && price > 0) {
          prices[address] = price;
          this.setCachedPrice(address, price);

          const metadata = this.TOKEN_REGISTRY[address];
          this.logger.log(`✓ ${metadata.symbol}: $${price.toFixed(2)}`);
        }
      }

      this.logger.log(`Batch fetched ${Object.keys(prices).length}/${addresses.length} prices`);

    } catch (error) {
      this.logger.error('Batch fetch failed, falling back to individual fetches:', error.message);

      // Fallback: fetch individually
      for (const address of addresses) {
        try {
          prices[address] = await this.getTokenPrice(address);
        } catch (err) {
          this.logger.error(`Failed to fetch price for ${address}:`, err.message);

          // Use fallback price
          const metadata = this.TOKEN_REGISTRY[address];
          if (metadata) {
            prices[address] = this.FALLBACK_PRICES[metadata.coingeckoId] || 0;
          }
        }
      }
    }

    return prices;
  }

  /**
   * Get cached price if valid
   * @param address - Token address
   * @returns Cached price or null if expired/missing
   * @private
   */
  private getCachedPrice(address: string): number | null {
    const cached = this.cache.get(address);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) {
      this.cache.delete(address);
      return null;
    }

    return cached.price;
  }

  /**
   * Cache price with timestamp
   * @param address - Token address
   * @param price - Price in USD
   * @private
   */
  private setCachedPrice(address: string, price: number): void {
    this.cache.set(address, {
      price,
      timestamp: Date.now(),
    });
  }
}
