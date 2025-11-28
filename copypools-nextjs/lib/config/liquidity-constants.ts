/**
 * Constants for liquidity management
 */

// Uniswap V4 Pool Manager address (Sepolia)
export const POOL_MANAGER_ADDRESS = '0x8C4BcBE6b9eF47855f97E675296FA3F6fafa5F1A'

// Minimum tick and maximum tick
export const MIN_TICK = -887272
export const MAX_TICK = 887272

// Tick spacing by fee tier
export const TICK_SPACINGS: Record<string, number> = {
  '500': 10,     // 0.05% fee
  '3000': 60,    // 0.3% fee
  '10000': 200,  // 1% fee
}

// Fee tier options
export const FEE_OPTIONS = [
  {
    value: '500',
    label: '0.05%',
    description: 'Best for stable pairs',
    badge: 'Stable',
    tickSpacing: 10
  },
  {
    value: '3000',
    label: '0.3%',
    description: 'Best for most pairs',
    badge: 'Standard',
    tickSpacing: 60
  },
  {
    value: '10000',
    label: '1%',
    description: 'Best for exotic pairs',
    badge: 'Exotic',
    tickSpacing: 200
  },
]

// Price range presets (ticks divisible by 60 for 0.3% fee tier)
export const PRICE_RANGE_PRESETS = [
  {
    label: 'Full Range',
    tickLower: '-887220',
    tickUpper: '887220',
    description: 'Passive strategy - earn fees on all price movements',
    icon: '🌊'
  },
  {
    label: 'Wide Range',
    tickLower: '-200040',
    tickUpper: '200040',
    description: 'Balanced exposure - moderate capital efficiency',
    icon: '⚖️'
  },
  {
    label: 'Concentrated',
    tickLower: '-50040',
    tickUpper: '50040',
    description: 'Active management - high capital efficiency',
    icon: '🎯'
  },
  {
    label: 'Custom',
    tickLower: '',
    tickUpper: '',
    description: 'Set your own price range',
    icon: '🔧'
  },
]

// Token pair configuration
export const TOKEN_PAIRS = [
  {
    name: 'WETH/USDC',
    token0: '0x8B86719bEeCd8004569F429549177B9B25c6555a', // WETH on Sepolia
    token1: '0xbaa74e10F7edbC3FCDA7508C27A8F5599d79b09c', // USDC on Sepolia
    symbol0: 'WETH',
    symbol1: 'USDC',
    decimals0: 18,
    decimals1: 6
  }
]

// Validation limits
export const VALIDATION = {
  MIN_LIQUIDITY: 1000n,
  MAX_PRICE_RATIO: 1000, // Max price range width (max/min)
  MIN_PRICE_RATIO: 1.001, // Min price range width (1% minimum)
  DUST_THRESHOLD: 0.000001, // Minimum amount to consider
  BALANCE_BUFFER: 0.99, // Warn if using >99% of balance
}

// Transaction settings
export const TRANSACTION = {
  DEFAULT_SLIPPAGE: 0.5, // 0.5%
  DEFAULT_DEADLINE: 20, // 20 minutes
  GAS_LIMIT_BUFFER: 1.2, // 20% buffer on gas estimates
}

// UI settings
export const UI = {
  POOL_FETCH_INTERVAL: 30000, // Refresh pool state every 30s
  DEBOUNCE_DELAY: 500, // Debounce user input
  MAX_DECIMALS_DISPLAY: 6, // Max decimals to show in UI
}

// Error messages
export const ERROR_MESSAGES = {
  WALLET_NOT_CONNECTED: 'Please connect your wallet to continue',
  INVALID_AMOUNT: 'Please enter a valid amount',
  INSUFFICIENT_BALANCE: 'Insufficient balance',
  INVALID_PRICE_RANGE: 'Invalid price range',
  POOL_NOT_FOUND: 'Pool does not exist or is not initialized',
  TRANSACTION_FAILED: 'Transaction failed. Please try again.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
}
