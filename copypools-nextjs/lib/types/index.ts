export interface Position {
  positionId: string
  protocol: string
  dexTokenId: string
  owner: string
  token0: string
  token1: string
  active: boolean
  tickLower?: number
  tickUpper?: number
  liquidity?: string
  createdAt?: string
  updatedAt?: string
}

export interface Transaction {
  id: number
  positionId: string
  type: 'MOVE_RANGE' | 'CLOSE_POSITION' | 'COMPOUND'
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  txHash?: string
  blockNumber?: number
  gasUsed?: string
  errorMessage?: string
  metadata?: any
  createdAt: string
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy'
  blockchain: {
    connected: boolean
    blockNumber?: number
    gasPrice?: string
  }
  database?: {
    totalPositions: number
    activePositions: number
  }
  error?: string
  timestamp: string
}

export interface WalletState {
  address: string | null
  chainId: number | null
  isConnected: boolean
  isConnecting: boolean
}

export interface TimelineEvent {
  type: 'RANGE_MOVE' | 'COMPOUND' | 'CLOSE'
  timestamp: Date
  txHash?: string
  blockNumber?: number
  [key: string]: any
}

export interface RangeMoveEvent {
  oldPositionId: string
  newPositionId: string
  newTickLower: number
  newTickUpper: number
  txHash: string
  blockNumber: number
  timestamp: Date
}

export interface CompoundEvent {
  positionId: string
  addedLiquidity: string
  txHash: string
  blockNumber: number
  timestamp: Date
}

export interface CloseEvent {
  positionId: string
  amount0: string
  amount1: string
  txHash: string
  blockNumber: number
  timestamp: Date
}
