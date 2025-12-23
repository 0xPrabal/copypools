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
