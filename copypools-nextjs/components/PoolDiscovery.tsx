'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'ethers'

import { AddLiquidity } from '@/components/AddLiquidity'
import { useWallet } from '@/lib/hooks/useWallet'
import { apiService } from '@/lib/services/api'
import { ContractService } from '@/lib/services/contracts'
import { TokenInfoService, TokenInfo } from '@/lib/services/tokenInfo'
import { Position } from '@/lib/types'

const FILTER_CHIPS = [
  { id: 'all', label: 'All pools' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'New pools' },
  { id: 'loan', label: 'Loan' },
]

const TIMEFRAME_OPTIONS: Array<'1d' | '1w' | '1m' | '1y'> = ['1d', '1w', '1m', '1y']

interface Pool {
  id: string
  token0: string
  token1: string
  token0Info?: TokenInfo
  token1Info?: TokenInfo
  feeTier: string
  feePercent: string
  tvl: number
  volume1d: number
  fees1d: number
  feesPerTvl1d: number
  age: number
  feesApr1d: number
  rewardsApr1d: number | null
  protocol: string
  badges?: string[]
  positionCount: number
  totalLiquidity: string
}

export const PoolDiscovery = () => {
  const { provider } = useWallet()

  const [pools, setPools] = useState<Pool[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedNetwork, setSelectedNetwork] = useState('any')
  const [selectedTokens, setSelectedTokens] = useState('any')
  const [activeChip, setActiveChip] = useState('all')
  const [timeframe, setTimeframe] = useState<'1d' | '1w' | '1m' | '1y'>('1d')
  const [expandedPool, setExpandedPool] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)
  const [tokenInfoMap, setTokenInfoMap] = useState<Map<string, TokenInfo>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortConfig, setSortConfig] = useState<{ key: keyof Pool; direction: 'asc' | 'desc' }>({
    key: 'tvl',
    direction: 'desc',
  })
  const [positionTVLMap, setPositionTVLMap] = useState<Map<string, number>>(new Map())

  const stats = useMemo(() => {
    const totalTVL = pools.reduce((sum, pool) => sum + pool.tvl, 0)
    const totalVolume = pools.reduce((sum, pool) => sum + pool.volume1d, 0)
    const activePositions = pools.reduce((sum, pool) => sum + pool.positionCount, 0)
    return { totalTVL, totalVolume, activePositions }
  }, [pools])

  useEffect(() => {
    fetchPools()
  }, [])

  useEffect(() => {
    if (!provider) return

    const interval = setInterval(() => {
      fetchPools()
    }, 30000)

    return () => clearInterval(interval)
  }, [provider])

  const fetchPools = async () => {
    try {
      if (pools.length === 0) setLoading(true)

      const positions = await apiService.getAllPositions()
      const tokenAddresses = new Set<string>()
      positions.forEach((pos) => {
        tokenAddresses.add(pos.token0)
        tokenAddresses.add(pos.token1)
      })

      // Fetch TVL data for real USD values
      try {
        const tvlData = await apiService.getTVLData()
        const tvlMap = new Map<string, number>()
        if (tvlData?.positions) {
          tvlData.positions.forEach((pos: any) => {
            tvlMap.set(pos.positionId, pos.estimatedValueUSD || 0)
          })
        }
        setPositionTVLMap(tvlMap)
      } catch (err) {
        console.warn('Failed to fetch TVL data:', err)
      }

      if (provider) {
        const tokenInfoService = new TokenInfoService(provider)
        const tokenMap = await tokenInfoService.getMultipleTokenInfo(Array.from(tokenAddresses))
        setTokenInfoMap(tokenMap)
      }

      const poolMap = new Map<
        string,
        {
          positions: Position[]
          token0: string
          token1: string
          protocol: string
        }
      >()

      positions.forEach((pos) => {
        const poolKey = `${pos.token0.toLowerCase()}-${pos.token1.toLowerCase()}-${pos.protocol}`
        if (!poolMap.has(poolKey)) {
          poolMap.set(poolKey, {
            positions: [],
            token0: pos.token0,
            token1: pos.token1,
            protocol: pos.protocol,
          })
        }
        poolMap.get(poolKey)!.positions.push(pos)
      })

      const nextPools: Pool[] = []

      for (const [poolKey, poolData] of poolMap.entries()) {
        const activePositions = poolData.positions.filter((p) => p.active)
        if (activePositions.length === 0) continue

        const feeTier = poolData.protocol.includes('0.05')
          ? '0.05%'
          : poolData.protocol.includes('0.3')
            ? '0.3%'
            : poolData.protocol.includes('1')
              ? '1%'
              : '0.05%'

        let totalLiquidity = 0n
        let totalLiquidityStr = '0'

        try {
          // Use liquidity data from API instead of direct contract reads
          for (const pos of activePositions) {
            // Check if liquidity exists and is a valid non-zero value
            if (pos.liquidity && pos.liquidity !== '0' && pos.liquidity !== 'null' && pos.liquidity !== 'undefined') {
              try {
                totalLiquidity += BigInt(pos.liquidity)
              } catch (e) {
                console.warn(`Invalid liquidity value for position ${pos.positionId}:`, pos.liquidity)
              }
            }
          }
          totalLiquidityStr = totalLiquidity.toString()
        } catch (err) {
          console.warn('Error calculating liquidity', err)
        }

        const token0Info = tokenInfoMap.get(poolData.token0.toLowerCase())
        const token1Info = tokenInfoMap.get(poolData.token1.toLowerCase())

        const oldestPosition = activePositions.reduce((oldest: Position | null, current) => {
          if (!oldest || !oldest.createdAt) return current
          if (!current.createdAt) return oldest
          return new Date(current.createdAt) < new Date(oldest.createdAt) ? current : oldest
        }, activePositions[0])

        const age = oldestPosition?.createdAt
          ? Math.max(0, Math.floor((Date.now() - new Date(oldestPosition.createdAt).getTime()) / (1000 * 60 * 60 * 24)))
          : 0

        // Calculate real TVL from position USD values
        const realTvl = activePositions.reduce((sum, pos) => {
          return sum + (positionTVLMap.get(pos.positionId) || 0)
        }, 0)

        // Use real TVL if available, otherwise fallback to estimation
        const estimatedTvl = realTvl > 0
          ? realTvl
          : totalLiquidity > 0n
            ? (Number(totalLiquidity) / 1e18) * 2000
            : activePositions.length * 100000

        const feesApr1d = estimatedTvl > 0 && activePositions.length > 0
          ? Math.min(500, Math.max(0, (activePositions.length * 100) / estimatedTvl * 365))
          : 0

        nextPools.push({
          id: poolKey,
          token0: poolData.token0,
          token1: poolData.token1,
          token0Info,
          token1Info,
          feeTier,
          feePercent: feeTier,
          tvl: estimatedTvl,
          volume1d: estimatedTvl * 2,
          fees1d: estimatedTvl * 0.001,
          feesPerTvl1d: 0.001,
          age,
          feesApr1d,
          rewardsApr1d: null,
          protocol: poolData.protocol,
          badges: ['v4'],
          positionCount: activePositions.length,
          totalLiquidity: totalLiquidityStr,
        })
      }

      nextPools.sort((a, b) => b.tvl - a.tvl)
      setPools(nextPools)
    } catch (err) {
      console.error('Failed to fetch pools', err)
      setError(err instanceof Error ? err.message : 'Failed to load pools')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
    if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
    return `$${value.toFixed(2)}`
  }

  const formatPercent = (value: number) => `${value.toFixed(2)}%`
  const formatAge = (days: number) => `${days}d`

  const getTokenSymbol = (address: string, pool?: Pool) => {
    const lower = address.toLowerCase()
    if (pool) {
      if (lower === pool.token0.toLowerCase() && pool.token0Info) return pool.token0Info.symbol
      if (lower === pool.token1.toLowerCase() && pool.token1Info) return pool.token1Info.symbol
    }
    const info = tokenInfoMap.get(lower)
    if (info) return info.symbol
    return TokenInfoService.getTokenSymbol(address)
  }

  const getTokenName = (address: string, pool?: Pool) => {
    const lower = address.toLowerCase()
    if (pool) {
      if (lower === pool.token0.toLowerCase() && pool.token0Info) return pool.token0Info.name
      if (lower === pool.token1.toLowerCase() && pool.token1Info) return pool.token1Info.name
    }
    const info = tokenInfoMap.get(lower)
    if (info) return info.name
    return `Token ${address.substring(0, 6)}`
  }

  const requestSort = (key: keyof Pool) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key, direction: 'desc' }
    })
  }

  const sortIcon = (key: keyof Pool) => {
    if (sortConfig.key !== key) return null
    return <span className="sort-icon">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
  }

  const filteredPools = useMemo(() => {
    let data = [...pools]

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      data = data.filter((pool) => {
        const symbols = [
          getTokenSymbol(pool.token0, pool).toLowerCase(),
          getTokenSymbol(pool.token1, pool).toLowerCase(),
          getTokenName(pool.token0, pool).toLowerCase(),
          getTokenName(pool.token1, pool).toLowerCase(),
        ]
        return symbols.some((value) => value.includes(query))
      })
    }

    if (activeChip === 'rewards') {
      data = data.filter((pool) => pool.rewardsApr1d && pool.rewardsApr1d > 0)
    } else if (activeChip === 'trending') {
      data = data.filter((pool) => pool.volume1d > pool.tvl * 0.6)
    } else if (activeChip === 'new') {
      data = data.filter((pool) => pool.age <= 90)
    } else if (activeChip === 'loan') {
      data = data.filter((_, index) => index % 2 === 0)
    }

    if (sortConfig) {
      data.sort((a, b) => {
        const valA = a[sortConfig.key]
        const valB = b[sortConfig.key]
        if (valA === undefined || valA === null || valB === undefined || valB === null) return 0
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
      })
    }

    return data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, searchQuery, activeChip, sortConfig, tokenInfoMap])

  const handleExpand = (poolId: string) => {
    setExpandedPool((prev) => (prev === poolId ? null : poolId))
  }

  const SkeletonRow = () => (
    <tr>
      <td><div className="skeleton" style={{ width: '180px', height: '40px' }} /></td>
      <td><div className="skeleton skeleton-text" /></td>
      <td><div className="skeleton skeleton-text" /></td>
      <td><div className="skeleton skeleton-text" /></td>
      <td><div className="skeleton skeleton-text" style={{ width: '60px' }} /></td>
      <td><div className="skeleton skeleton-text" style={{ width: '40px' }} /></td>
      <td />
    </tr>
  )

  if (showCreateForm && selectedPool) {
    return (
      <div className="pool-discovery">
        <div className="discovery-header">
          <div className="discovery-title">
            <h1>Create new position</h1>
            <p>Provide liquidity to earn trading fees</p>
          </div>
          <button className="btn-primary" onClick={() => { setShowCreateForm(false); setSelectedPool(null) }}>
            ← Back to pools
          </button>
        </div>
        <div className="create-form-wrapper">
          <AddLiquidity
            preSelectedPool={{
              token0: selectedPool.token0,
              token1: selectedPool.token1,
              feeTier: selectedPool.feeTier,
            }}
            onSuccess={() => {
              setShowCreateForm(false)
              setSelectedPool(null)
              fetchPools()
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="pool-discovery">
      <section className="hero-section">
        <div className="hero-content">
          <div>
            <span className="hero-pill">Uniswap v4</span>
            <h1>Create position</h1>
            <p>Explore pools, inspect capital efficiency, and deploy liquidity with the same polish as Revert Finance.</p>
            <div className="hero-actions">
              <button className="btn-gradient" onClick={() => setShowCreateForm(true)}>+ New position</button>
              <button className="btn-outline">Import position</button>
            </div>
          </div>
          <div className="hero-stats-grid">
            <div className="hero-stat-card">
              <label>Total TVL</label>
              <strong>{formatCurrency(stats.totalTVL)}</strong>
              <span>Across CopyPools</span>
            </div>
            <div className="hero-stat-card">
              <label>24h Volume</label>
              <strong>{formatCurrency(stats.totalVolume)}</strong>
              <span>Tracked pools</span>
            </div>
            <div className="hero-stat-card">
              <label>Active Positions</label>
              <strong>{stats.activePositions}</strong>
              <span>On-chain sync</span>
            </div>
          </div>
        </div>
        <div className="hero-gradient" />
      </section>

      <div className="controls-row">
        <div className="chip-list">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.id}
              className={`chip ${activeChip === chip.id ? 'active' : ''}`}
              onClick={() => setActiveChip(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="filters">
          <div className="search-container">
            <input
              className="search-input-field"
              placeholder="Search tokens or pairs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <span className="search-icon-overlay">🔍</span>
          </div>

          <select className="filter-select" value={selectedNetwork} onChange={(e) => setSelectedNetwork(e.target.value)}>
            <option value="any">Any network</option>
            <option value="ethereum">Ethereum</option>
            <option value="sepolia">Sepolia</option>
          </select>

          <select className="filter-select" value={selectedTokens} onChange={(e) => setSelectedTokens(e.target.value)}>
            <option value="any">Any tokens</option>
            <option value="weth">WETH</option>
            <option value="usdc">USDC</option>
          </select>

          <div className="pill-tabs">
            {TIMEFRAME_OPTIONS.map((t) => (
              <button
                key={t}
                className={`pill-tab ${timeframe === t ? 'active' : ''}`}
                onClick={() => setTimeframe(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
          <button className="retry-btn" onClick={() => { setError(null); fetchPools() }}>Retry</button>
        </div>
      )}

      <div className="pools-table-container">
        <table className="pools-table">
          <thead>
            <tr>
              <th>Pool</th>
              <th onClick={() => requestSort('tvl')}>TVL {sortIcon('tvl')}</th>
              <th onClick={() => requestSort('volume1d')}>Volume {sortIcon('volume1d')}</th>
              <th onClick={() => requestSort('fees1d')}>Fees {sortIcon('fees1d')}</th>
              <th onClick={() => requestSort('feesApr1d')}>APR {sortIcon('feesApr1d')}</th>
              <th onClick={() => requestSort('age')}>Age {sortIcon('age')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, idx) => <SkeletonRow key={idx} />)
              : filteredPools.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state-cell">
                    <div className="empty-state">
                      <div className="empty-icon">🌊</div>
                      <h3>No pools found</h3>
                      <p>Try adjusting filters or search.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredPools.map((pool) => {
                  const sym0 = getTokenSymbol(pool.token0, pool)
                  const sym1 = getTokenSymbol(pool.token1, pool)
                  const tvlShare = stats.totalTVL > 0 ? Math.min(100, (pool.tvl / stats.totalTVL) * 100) : 0
                  return (
                    <>
                      <tr key={pool.id} onClick={() => handleExpand(pool.id)}>
                        <td>
                          <div className="token-pair-display">
                            <div className="avatar-group">
                              <div className="token-avatar-img">{sym0[0]}</div>
                              <div className="token-avatar-img">{sym1[0]}</div>
                            </div>
                            <div className="pool-info">
                              <div className="pool-title">
                                {sym0}/{sym1}
                                <span className="fee-badge">{pool.feeTier}</span>
                              </div>
                              <div className="pool-subtitle">{pool.protocol}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="font-mono">{formatCurrency(pool.tvl)}</span>
                          <div className="metric-bar-container">
                            <div className="metric-bar-fill" style={{ width: `${tvlShare}%` }} />
                          </div>
                        </td>
                        <td><span className="font-mono">{formatCurrency(pool.volume1d)}</span></td>
                        <td><span className="font-mono">{formatCurrency(pool.fees1d)}</span></td>
                        <td>
                          <span className={`font-mono ${pool.feesApr1d > 20 ? 'text-success' : ''}`}>
                            {formatPercent(pool.feesApr1d)}
                          </span>
                        </td>
                        <td>{formatAge(pool.age)}</td>
                        <td>
                          <button className="expand-button">{expandedPool === pool.id ? '▲' : '▼'}</button>
                        </td>
                      </tr>
                      {expandedPool === pool.id && (
                        <tr className="expanded-content-row">
                          <td colSpan={7} className="p-0">
                            <div className="expanded-row-content">
                              <div className="pool-dashboard">
                                <div className="dashboard-main">
                                  <div className="dashboard-stats">
                                    <div className="dashboard-card">
                                      <h4>Total liquidity</h4>
                                      <div className="value">
                                        {pool.totalLiquidity ? parseFloat(formatUnits(pool.totalLiquidity, 18)).toFixed(4) : '0'}
                                      </div>
                                    </div>
                                    <div className="dashboard-card">
                                      <h4>Active positions</h4>
                                      <div className="value">{pool.positionCount}</div>
                                    </div>
                                    <div className="dashboard-card">
                                      <h4>Fees/TVL</h4>
                                      <div className="value">{(pool.feesPerTvl1d * 100).toFixed(3)}%</div>
                                    </div>
                                    <div className="dashboard-card">
                                      <h4>Pool efficiency</h4>
                                      <div className="value text-success">High</div>
                                    </div>
                                  </div>
                                </div>
                                <div className="action-card">
                                  <h3>Ready to earn?</h3>
                                  <p>Provide liquidity to {sym0}/{sym1} and start earning trading fees immediately.</p>
                                  <button
                                    className="btn-gradient"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedPool(pool)
                                      setShowCreateForm(true)
                                      setExpandedPool(null)
                                    }}
                                  >
                                    Create position
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })
              )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
