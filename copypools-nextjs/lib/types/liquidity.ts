/**
 * Type definitions for liquidity management
 */

export interface TokenInfo {
  address: string
  name: string
  symbol: string
  decimals: number
}

export interface PoolState {
  sqrtPriceX96: bigint
  tick: number
  price: number
  initialized: boolean
  liquidity: bigint
}

export interface PriceRange {
  minPrice: string
  maxPrice: string
  tickLower: number
  tickUpper: number
}

export interface LiquidityPosition {
  token0: TokenInfo
  token1: TokenInfo
  amount0: string
  amount1: string
  priceRange: PriceRange
  expectedLiquidity: bigint
  feeTier: number
}

export interface ValidationError {
  field: string
  message: string
  type: 'error' | 'warning'
}

export interface TransactionState {
  loading: boolean
  error: string | null
  success: string | null
  step: string
  hash?: string
}
