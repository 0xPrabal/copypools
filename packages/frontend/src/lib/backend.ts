// Remove trailing slash to prevent double-slash in URLs
const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export interface BotStatus {
  isRunning: boolean;
  lastCheck: string;
  activePositions: number;
  pendingActions: number;
}

export interface PositionCache {
  address: string;
  chainId: number;
  lastScannedBlock: string;
  tokenIds: string[];
  updatedAt: string;
}

// Position data returned by backend API
export interface BackendPosition {
  tokenId: string;
  owner: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  currentTick: number;
  sqrtPriceX96?: string; // Pool's current sqrtPriceX96 for USD calculations
  inRange: boolean;
  poolKey?: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  compoundConfig?: {
    enabled: boolean;
    minCompoundInterval: number;
    minRewardAmount: string;
  } | null;
  rangeConfig?: {
    enabled: boolean;
    lowerDelta: number;
    upperDelta: number;
    rebalanceThreshold: number;
  } | null;
}

export const backendApi = {
  // Get positions by owner address - uses Alchemy NFT API (fast!)
  // Pass chainId to ensure backend returns data for correct chain (or empty if chain not supported)
  async getPositionsByOwner(address: string, enrich = true, chainId?: number): Promise<BackendPosition[]> {
    try {
      const params = new URLSearchParams({ enrich: String(enrich) });
      if (chainId) params.set('chainId', String(chainId));

      const response = await fetch(
        `${BACKEND_URL}/api/positions/owner/${address}?${params.toString()}`
      );
      if (!response.ok) throw new Error('Failed to fetch positions');
      return response.json();
    } catch (error) {
      console.error('Failed to fetch positions from backend:', error);
      return [];
    }
  },

  // Get single position by token ID
  async getPosition(tokenId: string): Promise<BackendPosition | null> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/positions/${tokenId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Failed to fetch position');
      return response.json();
    } catch (error) {
      console.error('Failed to fetch position from backend:', error);
      return null;
    }
  },

  // Position cache APIs
  async getPositionCache(address: string, chainId: number): Promise<PositionCache | null> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/position-cache/${address}/${chainId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Failed to fetch position cache');
      return response.json();
    } catch (error) {
      console.error('Position cache fetch error:', error);
      return null;
    }
  },

  async savePositionCache(
    address: string,
    chainId: number,
    lastScannedBlock: string,
    tokenIds: string[]
  ): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/position-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId, lastScannedBlock, tokenIds }),
      });
      return response.ok;
    } catch (error) {
      console.error('Position cache save error:', error);
      return false;
    }
  },

  async addTokensToCache(
    address: string,
    chainId: number,
    newTokenIds: string[],
    lastScannedBlock: string
  ): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/position-cache/add-tokens`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId, newTokenIds, lastScannedBlock }),
      });
      return response.ok;
    } catch (error) {
      console.error('Add tokens to cache error:', error);
      return false;
    }
  },

  async removeTokensFromCache(
    address: string,
    chainId: number,
    tokenIdsToRemove: string[]
  ): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/position-cache/remove-tokens`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId, tokenIdsToRemove }),
      });
      return response.ok;
    } catch (error) {
      console.error('Remove tokens from cache error:', error);
      return false;
    }
  },

  // Get bot status
  async getBotStatus(): Promise<BotStatus> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/status`);
      if (!response.ok) throw new Error('Failed to fetch bot status');
      return response.json();
    } catch (error) {
      console.error('Backend API error:', error);
      return {
        isRunning: false,
        lastCheck: new Date().toISOString(),
        activePositions: 0,
        pendingActions: 0,
      };
    }
  },

  // Trigger manual compound
  async triggerCompound(tokenId: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/compound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId }),
      });
      return response.json();
    } catch (error) {
      return { success: false, message: 'Failed to trigger compound' };
    }
  },

  // Trigger manual rebalance
  async triggerRebalance(tokenId: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId }),
      });
      return response.json();
    } catch (error) {
      return { success: false, message: 'Failed to trigger rebalance' };
    }
  },

  // ============ Smart Rebalance Analysis ============

  // Get smart analysis for a single position
  async getSmartAnalysis(tokenId: string): Promise<SmartAnalysis | null> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/positions/${tokenId}/smart-analysis`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Failed to fetch analysis');
      return response.json();
    } catch (error) {
      console.error('Smart analysis fetch error:', error);
      return null;
    }
  },

  // Get smart analysis for multiple positions
  async getBatchSmartAnalysis(tokenIds: string[]): Promise<BatchSmartAnalysis | null> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/positions/batch-smart-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIds }),
      });
      if (!response.ok) throw new Error('Failed to fetch batch analysis');
      return response.json();
    } catch (error) {
      console.error('Batch smart analysis fetch error:', error);
      return null;
    }
  },
};

// ============ Smart Analysis Types ============

export interface SmartAnalysis {
  tokenId: string;
  analysis: {
    currentTick: number;
    tickLower: number;
    tickUpper: number;
    rangeCenter: number;
    rangeWidth: number;
    positionInRange: number; // 0-100%
    centerDrift: number; // 0-100%
    tokenComposition: {
      token0Percent: number;
      token1Percent: number;
    };
    inRange: boolean;
    urgency: number;
    action: 'hold' | 'monitor' | 'rebalance_soon' | 'rebalance_now';
    reason: string;
  };
  volatility: {
    tickVolatility: number;
    hourlyChange: number;
    momentum: number;
    trendStrength: number;
    priceDirection: 'rising' | 'falling' | 'stable';
  };
  decision: {
    shouldRebalance: boolean;
    reason: string;
    urgency: number;
    estimatedSavingsBps: number;
    waitRecommendation?: number;
  } | null;
  rangeConfig: {
    enabled: boolean;
    lowerDelta: number;
    upperDelta: number;
    rebalanceThreshold: number;
  } | null;
  lastRebalanceTime: number;
  cooldownRemaining: number;
}

export interface BatchSmartAnalysis {
  positions: Array<{
    tokenId: string;
    centerDrift: number;
    inRange: boolean;
    action: 'hold' | 'monitor' | 'rebalance_soon' | 'rebalance_now';
    urgency: number;
    shouldRebalance: boolean;
    reason: string;
    cooldownRemaining?: number;
    tokenComposition: {
      token0Percent: number;
      token1Percent: number;
    };
    error?: string;
  }>;
}

// ============ V4 Pool Types ============

// Supported chain IDs
export const POOL_CHAIN_IDS = {
  BASE: 8453,
  SEPOLIA: 11155111,
  ETHEREUM: 1,
  ARBITRUM: 42161,
  OPTIMISM: 10,
} as const;

export interface V4PoolItem {
  rank: number;
  id: string;
  chainId: number;
  chainName: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Logo: string | null;
  token1Logo: string | null;
  token0Address: string;
  token1Address: string;
  protocol: string;
  feeTier: string;
  fee: number;
  tickSpacing: number;
  tvlUsd: number;
  poolApr: number;
  rewardApr: number | null;
  volume1dUsd: number;
  volume30dUsd: number;
  volume1dTvlRatio: number;
}

export interface V4PoolsResponse {
  chainId: number;
  chainName: string;
  pools: V4PoolItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type PoolSortField = 'tvl' | 'apr' | 'volume1d' | 'volume30d' | 'fee';

// Fetch V4 pools with pagination
// ============ Token Price Types ============

export interface TokenPrice {
  address: string;
  symbol: string;
  decimals: number;
  priceUSD: number;
  cached: boolean;
  timestamp: number;
  error?: string;
}

// Fetch token prices from backend
export async function fetchTokenPrices(
  tokenAddresses: string[],
  chainId: number
): Promise<TokenPrice[]> {
  try {
    const params = new URLSearchParams({
      tokens: tokenAddresses.join(','),
      chainId: String(chainId),
    });

    const response = await fetch(`${BACKEND_URL}/api/prices?${params.toString()}`);

    if (!response.ok) {
      console.error('Failed to fetch token prices');
      return [];
    }

    const data = await response.json();
    return data.prices || [];
  } catch (error) {
    console.error('Token price fetch error:', error);
    return [];
  }
}

// Fetch V4 pools with pagination
export async function fetchV4Pools(options: {
  chainId?: number;
  page?: number;
  limit?: number;
  sortBy?: PoolSortField;
  sortOrder?: 'asc' | 'desc';
}): Promise<V4PoolsResponse> {
  const {
    chainId = POOL_CHAIN_IDS.BASE,
    page = 1,
    limit = 20,
    sortBy = 'apr',
    sortOrder = 'desc',
  } = options;

  try {
    const params = new URLSearchParams({
      chainId: String(chainId),
      page: String(page),
      limit: String(limit),
      sortBy,
      sortOrder,
    });

    const response = await fetch(`${BACKEND_URL}/api/pools/v4?${params.toString()}`);

    if (!response.ok) {
      throw new Error('Failed to fetch V4 pools');
    }

    return response.json();
  } catch (error) {
    console.error('Failed to fetch V4 pools:', error);
    return {
      chainId,
      chainName: chainId === POOL_CHAIN_IDS.BASE ? 'Base' : 'Unknown',
      pools: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  }
}

// ============ Notification Types ============

export type NotificationType =
  // Automated notifications
  | 'compound_profitable'
  | 'rebalance_needed'
  | 'position_out_of_range'
  | 'high_fees_accumulated'
  | 'gas_price_low'
  | 'position_liquidatable'
  | 'compound_executed'
  | 'rebalance_executed'
  // User action notifications
  | 'position_created'
  | 'liquidity_increased'
  | 'liquidity_decreased'
  | 'fees_collected'
  | 'position_closed'
  | 'auto_compound_enabled'
  | 'auto_compound_disabled'
  | 'auto_range_enabled'
  | 'auto_range_disabled';

export interface Notification {
  id: string;
  type: NotificationType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  positionId?: string;
  owner?: string;
  data?: Record<string, unknown>;
  timestamp: number;
  read: boolean;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

// Fetch notifications for a user
export async function fetchNotifications(
  address: string,
  limit = 10
): Promise<NotificationsResponse> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/notifications/${address}?limit=${limit}`
    );

    if (!response.ok) {
      console.error('Failed to fetch notifications');
      return { notifications: [], unreadCount: 0 };
    }

    return response.json();
  } catch (error) {
    console.error('Notifications fetch error:', error);
    return { notifications: [], unreadCount: 0 };
  }
}

// Create an activity notification for user actions
export async function createActivityNotification(
  address: string,
  params: {
    type: NotificationType;
    title: string;
    message: string;
    positionId?: string;
    txHash?: string;
    data?: Record<string, unknown>;
  }
): Promise<Notification | null> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/notifications/${address}/activity`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      }
    );

    if (!response.ok) {
      console.error('Failed to create activity notification');
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('Activity notification creation error:', error);
    return null;
  }
}
