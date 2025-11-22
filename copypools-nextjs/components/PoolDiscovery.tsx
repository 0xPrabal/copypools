'use client'

import { useState, useEffect } from 'react'
import { apiService } from '@/lib/services/api'
import { Position } from '@/lib/types'
import { AddLiquidity } from './AddLiquidity'

interface Pool {
  id: string
  token0: string
  token1: string
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
}

export const PoolDiscovery = () => {
  const [pools, setPools] = useState<Pool[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedNetwork, setSelectedNetwork] = useState('any')
  const [selectedTokens, setSelectedTokens] = useState('any')
  const [activeTab, setActiveTab] = useState<'rewards' | 'trending' | 'new' | 'all'>('all')
  const [timeframe, setTimeframe] = useState<'1d' | '1w' | '1m' | '1y'>('1d')
  const [expandedPool, setExpandedPool] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)

  useEffect(() => {
    fetchPools()
  }, [activeTab, timeframe])

  const fetchPools = async () => {
    try {
      setLoading(true)
      // Get all positions to derive pools
      const positions = await apiService.getAllPositions()
      
      // Group positions by pool (token0, token1, fee tier)
      const poolMap = new Map<string, Pool>()
      
      positions.forEach((pos) => {
        const poolKey = `${pos.token0}-${pos.token1}-${pos.protocol}`
        
        if (!poolMap.has(poolKey)) {
          // Create pool entry
          const feeTier = pos.protocol.includes('0.05') ? '0.05%' : 
                         pos.protocol.includes('0.3') ? '0.3%' : 
                         pos.protocol.includes('1') ? '1%' : '0.05%'
          
          poolMap.set(poolKey, {
            id: poolKey,
            token0: pos.token0,
            token1: pos.token1,
            feeTier,
            feePercent: feeTier,
            tvl: 0,
            volume1d: 0,
            fees1d: 0,
            feesPerTvl1d: 0,
            age: 0,
            feesApr1d: 0,
            rewardsApr1d: null,
            protocol: pos.protocol,
            badges: ['v4'],
          })
        }
      })

      // Convert to array and add mock data for demonstration
      // In production, this would come from pool analytics
      const poolsArray = Array.from(poolMap.values()).map((pool, index) => ({
        ...pool,
        tvl: Math.random() * 100000000 + 1000000,
        volume1d: Math.random() * 500000000 + 50000000,
        fees1d: Math.random() * 500000 + 10000,
        feesPerTvl1d: Math.random() * 0.01,
        age: Math.floor(Math.random() * 2000) + 100,
        feesApr1d: Math.random() * 200 + 10,
        rewardsApr1d: Math.random() > 0.5 ? Math.random() * 50 + 5 : null,
      }))

      // Sort by TVL descending
      poolsArray.sort((a, b) => b.tvl - a.tvl)
      
      setPools(poolsArray)
    } catch (err) {
      console.error('Failed to fetch pools:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`
    }
    return `$${value.toFixed(2)}`
  }

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`
  }

  const formatAge = (days: number) => {
    return `${days} d`
  }

  const getTokenSymbol = (address: string) => {
    // In production, you'd fetch token info
    const commonTokens: Record<string, string> = {
      '0x8B86719bEeCd8004569F429549177B9B25c6555a': 'WETH',
      '0xbaa74e10F7edbC3FCDA7508C27A8F5599d79b09c': 'USDC',
    }
    return commonTokens[address.toLowerCase()] || address.substring(0, 6) + '...'
  }

  const handleExpand = (poolId: string) => {
    setExpandedPool(expandedPool === poolId ? null : poolId)
  }

  // Show form when pool is selected
  if (showCreateForm && selectedPool) {
    return (
      <div className="pool-discovery">
        <div className="form-header">
          <div>
            <h1>Create New Position</h1>
            <p className="header-subtitle">Provide liquidity to earn trading fees</p>
          </div>
          <button
            onClick={() => {
              setShowCreateForm(false)
              setSelectedPool(null)
            }}
            className="close-form-btn"
          >
            ← Back to Pools
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
      <div className="discovery-header">
        <div className="header-top">
          <div className="header-title-section">
            <h1>Create position</h1>
            <p className="header-subtitle">
              Explore and filter liquidity pools to find opportunities and create positions.
            </p>
          </div>
          <div className="header-stats">
            <div className="stat-item">
              <span className="stat-label">Showing pools on</span>
              <span className="stat-value">{pools.length} exchanges</span>
            </div>
          </div>
        </div>

        <div className="filters-section">
          <div className="filter-group">
            <select
              value={selectedNetwork}
              onChange={(e) => setSelectedNetwork(e.target.value)}
              className="filter-select"
            >
              <option value="any">Any network</option>
              <option value="ethereum">Ethereum</option>
              <option value="sepolia">Sepolia</option>
            </select>
          </div>

          <div className="filter-group">
            <select
              value={selectedTokens}
              onChange={(e) => setSelectedTokens(e.target.value)}
              className="filter-select"
            >
              <option value="any">Any tokens</option>
              <option value="weth">WETH</option>
              <option value="usdc">USDC</option>
            </select>
          </div>

          <button className="filters-button">+ filters</button>
        </div>

        <div className="tabs-section">
          <div className="discovery-tabs">
            <button
              className={`discovery-tab ${activeTab === 'rewards' ? 'active' : ''}`}
              onClick={() => setActiveTab('rewards')}
            >
              Rewards
            </button>
            <button
              className={`discovery-tab ${activeTab === 'trending' ? 'active' : ''}`}
              onClick={() => setActiveTab('trending')}
            >
              Trending
            </button>
            <button
              className={`discovery-tab ${activeTab === 'new' ? 'active' : ''}`}
              onClick={() => setActiveTab('new')}
            >
              New pools
            </button>
            <button
              className={`discovery-tab ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All
            </button>
          </div>

          <div className="timeframe-selector">
            <button
              className={`timeframe-btn ${timeframe === '1d' ? 'active' : ''}`}
              onClick={() => setTimeframe('1d')}
            >
              1d
            </button>
            <button
              className={`timeframe-btn ${timeframe === '1w' ? 'active' : ''}`}
              onClick={() => setTimeframe('1w')}
            >
              1w
            </button>
            <button
              className={`timeframe-btn ${timeframe === '1m' ? 'active' : ''}`}
              onClick={() => setTimeframe('1m')}
            >
              1m
            </button>
            <button
              className={`timeframe-btn ${timeframe === '1y' ? 'active' : ''}`}
              onClick={() => setTimeframe('1y')}
            >
              1y
            </button>
          </div>
        </div>

        <div className="info-banner">
          <span className="info-icon">ℹ️</span>
          <span>Expand a pool row to create a new position.</span>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Loading pools...</div>
      ) : (
        <div className="pools-table-container">
          <table className="pools-table">
            <thead>
              <tr>
                <th>pool/fee tier</th>
                <th>TVL</th>
                <th>
                  volume <span className={`timeframe-badge ${timeframe === '1d' ? 'active' : ''}`}>{timeframe}</span>
                </th>
                <th>
                  fees <span className={`timeframe-badge ${timeframe === '1d' ? 'active' : ''}`}>{timeframe}</span>
                </th>
                <th>
                  fees/TVL <span className={`timeframe-badge ${timeframe === '1d' ? 'active' : ''}`}>{timeframe}</span>
                </th>
                <th>age</th>
                <th>
                  fees APR <span className={`timeframe-badge ${timeframe === '1d' ? 'active' : ''}`}>{timeframe}</span>
                </th>
                <th>
                  rewards APR <span className={`timeframe-badge ${timeframe === '1d' ? 'active' : ''}`}>{timeframe}</span>
                </th>
                <th>expand</th>
              </tr>
            </thead>
            <tbody>
              {pools.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state-cell">
                    <div className="empty-state">
                      <div className="empty-icon">📊</div>
                      <p>No pools found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                pools.map((pool) => (
                  <>
                    <tr
                      key={pool.id}
                      className={`pool-row ${expandedPool === pool.id ? 'expanded' : ''}`}
                      onClick={() => handleExpand(pool.id)}
                    >
                      <td className="pool-name-cell">
                        <div className="pool-name">
                          <div className="pool-badges">
                            <span className="status-dot"></span>
                            {pool.badges?.map((badge, i) => (
                              <span key={i} className="pool-badge">{badge}</span>
                            ))}
                          </div>
                          <div className="pool-pair">
                            {getTokenSymbol(pool.token0)}/{getTokenSymbol(pool.token1)} {pool.feeTier}
                          </div>
                        </div>
                      </td>
                      <td>{formatCurrency(pool.tvl)}</td>
                      <td>{formatCurrency(pool.volume1d)}</td>
                      <td>{formatCurrency(pool.fees1d)}</td>
                      <td>{pool.feesPerTvl1d.toFixed(6)}</td>
                      <td>{formatAge(pool.age)}</td>
                      <td className={pool.feesApr1d > 50 ? 'high-apr' : ''}>
                        {formatPercent(pool.feesApr1d)}
                      </td>
                      <td>
                        {pool.rewardsApr1d ? (
                          <span className="rewards-apr">
                            OR {formatPercent(pool.rewardsApr1d)}
                            <span className="token-icon">🪙</span>
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td>
                        <button className="expand-button">
                          {expandedPool === pool.id ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    {expandedPool === pool.id && (
                      <tr className="expanded-content-row">
                        <td colSpan={9}>
                          <div className="expanded-content">
                            <div className="expanded-info">
                              <h3>Create Position in {getTokenSymbol(pool.token0)}/{getTokenSymbol(pool.token1)} {pool.feeTier}</h3>
                              <p>Pool Details:</p>
                              <ul>
                                <li>Protocol: {pool.protocol}</li>
                                <li>Fee Tier: {pool.feeTier}</li>
                                <li>TVL: {formatCurrency(pool.tvl)}</li>
                                <li>Fees APR: {formatPercent(pool.feesApr1d)}</li>
                              </ul>
                              <button
                                className="create-position-btn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedPool(pool)
                                  setShowCreateForm(true)
                                  setExpandedPool(null)
                                }}
                              >
                                Create Position
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

