'use client'

import { ethers } from 'ethers'

// Uniswap V3 Pool ABI (minimal for TWAP)
const POOL_V3_ABI = [
  'function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
]

// Uniswap V4 Pool Manager ABI (for TWAP via state)
const POOL_V4_MANAGER_ABI = [
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function observe(bytes32 poolId, uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)',
]

// Chainlink Price Feed ABI (fallback)
const CHAINLINK_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
]

// Known token addresses on Sepolia
const WETH_SEPOLIA = '0x8B86719bEeCd8004569F429549177B9B25c6555a'
const USDC_SEPOLIA = '0xbaa74e10F7edbC3FCDA7508C27A8F5599d79b09c'

// Chainlink ETH/USD price feed on Sepolia
const ETH_USD_FEED_SEPOLIA = '0x694AA1769357215DE4FAC081bf1f309aDC325306'

// Uniswap V4 PoolManager address - Official Sepolia deployment
const V4_POOL_MANAGER_SEPOLIA = '0x8C4BcBE6b9eF47855f97E675296FA3F6fafa5F1A'

export interface TokenPrice {
  token: string
  priceUSD: number
  source: 'TWAP_V3' | 'TWAP_V4' | 'SPOT_V4' | 'CHAINLINK' | 'FALLBACK'
  timestamp: number
}

export class PriceOracleService {
  private provider: ethers.JsonRpcProvider
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map()
  private readonly CACHE_DURATION = 60000 // 1 minute cache

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl)
  }

  /**
   * Get token price in USD using TWAP from Uniswap V3 pool
   */
  async getTokenPriceTWAPV3(
    poolAddress: string,
    tokenAddress: string,
    twapPeriod: number = 1800 // 30 minutes default
  ): Promise<number> {
    try {
      const pool = new ethers.Contract(poolAddress, POOL_V3_ABI, this.provider)

      // Get current and historical observations
      const secondsAgo = [twapPeriod, 0]
      const [tickCumulatives] = await pool.observe(secondsAgo)

      // Calculate TWAP tick
      const tickCumulativeDelta = tickCumulatives[1] - tickCumulatives[0]
      const timeWeightedAverageTick = Number(tickCumulativeDelta) / twapPeriod

      // Convert tick to price
      // price = 1.0001 ^ tick
      const price = Math.pow(1.0001, timeWeightedAverageTick)

      // Determine if we need to invert based on token position
      const token0 = await pool.token0()
      const isToken0 = tokenAddress.toLowerCase() === token0.toLowerCase()

      return isToken0 ? price : 1 / price
    } catch (error) {
      console.error('V3 TWAP fetch failed:', error)
      throw error
    }
  }

  /**
   * Get token price in USD using TWAP from Uniswap V4 pool
   * V4 uses PoolManager contract instead of individual pool contracts
   */
  async getTokenPriceTWAPV4(
    poolManagerAddress: string,
    poolId: string,
    tokenAddress: string,
    token0Address: string,
    twapPeriod: number = 1800 // 30 minutes default
  ): Promise<number> {
    try {
      const poolManager = new ethers.Contract(
        poolManagerAddress,
        POOL_V4_MANAGER_ABI,
        this.provider
      )

      // Get current and historical observations using poolId
      const secondsAgo = [twapPeriod, 0]
      const poolIdBytes = ethers.id(poolId) // Convert to bytes32

      try {
        const [tickCumulatives] = await poolManager.observe(poolIdBytes, secondsAgo)

        // Calculate TWAP tick
        const tickCumulativeDelta = tickCumulatives[1] - tickCumulatives[0]
        const timeWeightedAverageTick = Number(tickCumulativeDelta) / twapPeriod

        // Convert tick to price
        const price = Math.pow(1.0001, timeWeightedAverageTick)

        // Determine if we need to invert based on token position
        const isToken0 = tokenAddress.toLowerCase() === token0Address.toLowerCase()

        return isToken0 ? price : 1 / price
      } catch (observeError) {
        // If observe() is not available, fall back to current price from slot0
        console.warn('V4 TWAP observe not available, using current price:', observeError)
        const slot0 = await poolManager.getSlot0(poolIdBytes)
        const currentTick = slot0[1] // tick is second element
        const price = Math.pow(1.0001, Number(currentTick))

        const isToken0 = tokenAddress.toLowerCase() === token0Address.toLowerCase()
        return isToken0 ? price : 1 / price
      }
    } catch (error) {
      console.error('V4 TWAP fetch failed:', error)
      throw error
    }
  }

  /**
   * Get current spot price from V4 pool (no TWAP, just current price)
   */
  async getV4SpotPrice(
    poolManagerAddress: string,
    poolId: string,
    tokenAddress: string,
    token0Address: string
  ): Promise<number> {
    try {
      const poolManager = new ethers.Contract(
        poolManagerAddress,
        POOL_V4_MANAGER_ABI,
        this.provider
      )

      const poolIdBytes = ethers.id(poolId)
      const slot0 = await poolManager.getSlot0(poolIdBytes)
      const currentTick = slot0[1]

      const price = Math.pow(1.0001, Number(currentTick))
      const isToken0 = tokenAddress.toLowerCase() === token0Address.toLowerCase()

      return isToken0 ? price : 1 / price
    } catch (error) {
      console.error('V4 spot price fetch failed:', error)
      throw error
    }
  }

  /**
   * Get ETH price from Chainlink oracle
   */
  async getETHPriceChainlink(): Promise<number> {
    try {
      const priceFeed = new ethers.Contract(
        ETH_USD_FEED_SEPOLIA,
        CHAINLINK_ABI,
        this.provider
      )

      const [, answer, , ,] = await priceFeed.latestRoundData()
      const decimals = await priceFeed.decimals()

      // Convert to USD (Chainlink uses 8 decimals for USD pairs)
      return Number(answer) / Math.pow(10, Number(decimals))
    } catch (error) {
      console.error('Chainlink fetch failed:', error)
      throw error
    }
  }

  /**
   * Get token price with fallback strategy
   */
  async getTokenPrice(tokenAddress: string): Promise<TokenPrice> {
    // Check cache first
    const cached = this.priceCache.get(tokenAddress.toLowerCase())
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return {
        token: tokenAddress,
        priceUSD: cached.price,
        source: 'FALLBACK',
        timestamp: cached.timestamp,
      }
    }

    try {
      const normalizedAddress = tokenAddress.toLowerCase()
      let price: number
      let source: 'TWAP' | 'CHAINLINK' | 'FALLBACK'

      // WETH: Use Chainlink ETH/USD feed
      if (normalizedAddress === WETH_SEPOLIA.toLowerCase()) {
        price = await this.getETHPriceChainlink()
        source = 'CHAINLINK'
      }
      // USDC: Assume $1 (stablecoin)
      else if (normalizedAddress === USDC_SEPOLIA.toLowerCase()) {
        price = 1.0
        source = 'FALLBACK'
      }
      // Other tokens: Try to use TWAP from WETH pair
      else {
        // For now, fallback to fixed price
        // In production, query the WETH/TOKEN pool for TWAP
        price = 1.0
        source = 'FALLBACK'
      }

      // Cache the result
      this.priceCache.set(normalizedAddress, {
        price,
        timestamp: Date.now(),
      })

      return {
        token: tokenAddress,
        priceUSD: price,
        source,
        timestamp: Date.now(),
      }
    } catch (error) {
      console.error(`Failed to get price for ${tokenAddress}:`, error)

      // Return fallback price
      return {
        token: tokenAddress,
        priceUSD: 1.0,
        source: 'FALLBACK',
        timestamp: Date.now(),
      }
    }
  }

  /**
   * Calculate position value from liquidity
   * This requires tick math to convert liquidity to token amounts
   */
  calculatePositionValue(
    liquidity: bigint,
    tickLower: number,
    tickUpper: number,
    currentTick: number,
    token0Price: number,
    token1Price: number
  ): number {
    // Simplified calculation
    // In production, use @uniswap/v3-sdk or manual tick math

    // Get sqrt prices at ticks
    const sqrtPriceLower = this.getSqrtRatioAtTick(tickLower)
    const sqrtPriceUpper = this.getSqrtRatioAtTick(tickUpper)
    const sqrtPriceCurrent = this.getSqrtRatioAtTick(currentTick)

    let amount0 = 0n
    let amount1 = 0n

    if (currentTick < tickLower) {
      // All liquidity in token0
      amount0 = this.getAmount0Delta(sqrtPriceLower, sqrtPriceUpper, liquidity, false)
    } else if (currentTick < tickUpper) {
      // Liquidity split between both tokens
      amount0 = this.getAmount0Delta(sqrtPriceCurrent, sqrtPriceUpper, liquidity, false)
      amount1 = this.getAmount1Delta(sqrtPriceLower, sqrtPriceCurrent, liquidity, false)
    } else {
      // All liquidity in token1
      amount1 = this.getAmount1Delta(sqrtPriceLower, sqrtPriceUpper, liquidity, false)
    }

    // Convert to USD value
    const value0 = (Number(amount0) / 1e18) * token0Price // Assuming 18 decimals for WETH
    const value1 = (Number(amount1) / 1e6) * token1Price // Assuming 6 decimals for USDC

    return value0 + value1
  }

  private getSqrtRatioAtTick(tick: number): bigint {
    const absTick = Math.abs(tick)

    let ratio = (absTick & 0x1) !== 0
      ? BigInt('0xfffcb933bd6fad37aa2d162d1a594001')
      : BigInt('0x100000000000000000000000000000000')

    if ((absTick & 0x2) !== 0) ratio = (ratio * BigInt('0xfff97272373d413259a46990580e213a')) >> 128n
    if ((absTick & 0x4) !== 0) ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) >> 128n
    if ((absTick & 0x8) !== 0) ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) >> 128n
    if ((absTick & 0x10) !== 0) ratio = (ratio * BigInt('0xffcb9843d60f6159c9db58835c926644')) >> 128n
    if ((absTick & 0x20) !== 0) ratio = (ratio * BigInt('0xff973b41fa98c081472e6896dfb254c0')) >> 128n
    if ((absTick & 0x40) !== 0) ratio = (ratio * BigInt('0xff2ea16466c96a3843ec78b326b52861')) >> 128n
    if ((absTick & 0x80) !== 0) ratio = (ratio * BigInt('0xfe5dee046a99a2a811c461f1969c3053')) >> 128n
    if ((absTick & 0x100) !== 0) ratio = (ratio * BigInt('0xfcbe86c7900a88aedcffc83b479aa3a4')) >> 128n
    if ((absTick & 0x200) !== 0) ratio = (ratio * BigInt('0xf987a7253ac413176f2b074cf7815e54')) >> 128n
    if ((absTick & 0x400) !== 0) ratio = (ratio * BigInt('0xf3392b0822b70005940c7a398e4b70f3')) >> 128n
    if ((absTick & 0x800) !== 0) ratio = (ratio * BigInt('0xe7159475a2c29b7443b29c7fa6e889d9')) >> 128n
    if ((absTick & 0x1000) !== 0) ratio = (ratio * BigInt('0xd097f3bdfd2022b8845ad8f792aa5825')) >> 128n
    if ((absTick & 0x2000) !== 0) ratio = (ratio * BigInt('0xa9f746462d870fdf8a65dc1f90e061e5')) >> 128n
    if ((absTick & 0x4000) !== 0) ratio = (ratio * BigInt('0x70d869a156d2a1b890bb3df62baf32f7')) >> 128n
    if ((absTick & 0x8000) !== 0) ratio = (ratio * BigInt('0x31be135f97d08fd981231505542fcfa6')) >> 128n
    if ((absTick & 0x10000) !== 0) ratio = (ratio * BigInt('0x9aa508b5b7a84e1c677de54f3e99bc9')) >> 128n
    if ((absTick & 0x20000) !== 0) ratio = (ratio * BigInt('0x5d6af8dedb81196699c329225ee604')) >> 128n
    if ((absTick & 0x40000) !== 0) ratio = (ratio * BigInt('0x2216e584f5fa1ea926041bedfe98')) >> 128n
    if ((absTick & 0x80000) !== 0) ratio = (ratio * BigInt('0x48a170391f7dc42444e8fa2')) >> 128n

    if (tick > 0) ratio = (BigInt(2) ** BigInt(256) - BigInt(1)) / ratio

    return (ratio >> 32n) + (ratio % (BigInt(1) << BigInt(32)) === BigInt(0) ? BigInt(0) : BigInt(1))
  }

  private getAmount0Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean
  ): bigint {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      ;[sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]
    }

    const numerator1 = liquidity << 96n
    const numerator2 = sqrtRatioBX96 - sqrtRatioAX96

    return roundUp
      ? (numerator1 * numerator2) / sqrtRatioBX96 / sqrtRatioAX96 + 1n
      : (numerator1 * numerator2) / sqrtRatioBX96 / sqrtRatioAX96
  }

  private getAmount1Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean
  ): bigint {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      ;[sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96]
    }

    return roundUp
      ? (liquidity * (sqrtRatioBX96 - sqrtRatioAX96)) / (BigInt(1) << BigInt(96)) + 1n
      : (liquidity * (sqrtRatioBX96 - sqrtRatioAX96)) / (BigInt(1) << BigInt(96))
  }
}

// Singleton instance
let priceOracleInstance: PriceOracleService | null = null

export function getPriceOracle(): PriceOracleService {
  if (!priceOracleInstance) {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/MS9pGRxd1Jh3rhVjyIkFzVfG1g3BcTk3'
    priceOracleInstance = new PriceOracleService(rpcUrl)
  }
  return priceOracleInstance
}
