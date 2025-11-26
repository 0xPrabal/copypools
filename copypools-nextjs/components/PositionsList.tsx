'use client'

import { useEffect, useMemo, useState } from 'react'

import { useWallet } from '@/lib/hooks/useWallet'
import { apiService } from '@/lib/services/api'
import { Position } from '@/lib/types'

interface PositionsListProps {
  onSelectPosition: (position: Position) => void
  showAll?: boolean
}

export const PositionsList = ({ onSelectPosition, showAll = true }: PositionsListProps) => {
  const { address } = useWallet()
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterOwner, setFilterOwner] = useState('')
  const [showMyPositions, setShowMyPositions] = useState(!showAll)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterProtocol, setFilterProtocol] = useState<string>('all')
  const [positionValues, setPositionValues] = useState<Map<string, number>>(new Map())

  const heroTitle = showAll ? 'Discover Strategies' : 'My Liquidity Positions'
  const heroSubtitle = showAll
    ? 'Scan indexed Uniswap v4 positions or import an existing vault to copy.'
    : 'Track, manage, and compound all of your CopyPools positions from one place.'

  const tokenBadge = (address: string) => address.slice(2, 6).toUpperCase()
  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`

  const fetchPositions = async () => {
    try {
      setLoading(true)
      setError(null)

      // If on "My Positions" tab without wallet, don't fetch anything
      if (!showAll && !address) {
        setPositions([])
        setLoading(false)
        return
      }

      const owner = showMyPositions && address ? address : filterOwner || undefined
      const data = await apiService.getAllPositions(owner)
      setPositions(data)

      // Fetch real TVL data for positions
      try {
        const tvlData = await apiService.getTVLData()
        const valueMap = new Map<string, number>()

        // Map position IDs to their USD values from analytics
        if (tvlData?.positions) {
          for (const pos of tvlData.positions) {
            const posId = pos.positionId
            if (posId) {
              valueMap.set(posId, pos.estimatedValueUSD || 0)
            }
          }
        }
        setPositionValues(valueMap)
      } catch (err) {
        console.warn('Failed to fetch TVL data:', err)
      }
    } catch (err: any) {
      console.error('API failed:', err)
      setError('Failed to load positions from backend API')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPositions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterOwner, showMyPositions, address])

  const uniqueProtocols = [...new Set(positions.map((p) => p.protocol))]

  const filteredPositions = positions.filter((position) => {
    const matchesSearch =
      !searchQuery ||
      position.positionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      position.owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
      position.token0.toLowerCase().includes(searchQuery.toLowerCase()) ||
      position.token1.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesProtocol = filterProtocol === 'all' || position.protocol === filterProtocol
    return matchesSearch && matchesProtocol
  })

  const summary = useMemo(() => {
    const total = filteredPositions.length
    const active = filteredPositions.filter((p) => p.active).length
    const inactive = total - active

    // Calculate real TVL from position values
    const realTVL = filteredPositions.reduce((sum, pos) => {
      const value = positionValues.get(pos.positionId) || 0
      return sum + value
    }, 0)

    return { total, active, inactive, estimatedTVL: realTVL }
  }, [filteredPositions, positionValues])

  return (
    <section className="positions-section">
      <div className="hero-section" style={{ padding: '2.5rem' }}>
        <div className="hero-gradient" style={!showAll ? { filter: 'hue-rotate(45deg) saturate(1.2)' } : undefined} />
        <div className="hero-content">
          <div>
            <span className="hero-pill" style={!showAll ? { color: 'var(--accent-secondary)', borderColor: 'var(--accent-secondary)' } : undefined}>
              {showAll ? 'Explore' : 'Personal Assets'}
            </span>
            <h1>{heroTitle}</h1>
            <p>{heroSubtitle}</p>
          </div>
          <div className="hero-stats-grid">
            <div className="hero-stat-card">
              <label>Total Positions</label>
              <strong>{summary.total}</strong>
              <span>{summary.active} active</span>
            </div>
            <div className="hero-stat-card">
              <label>Total Value</label>
              <strong>{formatCurrency(summary.estimatedTVL)}</strong>
              <span>Estimated USD</span>
            </div>
            <div className="hero-stat-card">
              <label>Efficiency</label>
              <strong>{summary.total > 0 ? Math.round((summary.active / summary.total) * 100) : 0}%</strong>
              <span>Active rate</span>
            </div>
          </div>
        </div>
      </div>

      <div className="positions-toolbar glow-on-hover">
        <div className="toolbar-left">
          {showAll && address && (
            <div className="chip-list">
              <button
                className={`chip ${showMyPositions ? 'active' : ''}`}
                onClick={() => setShowMyPositions(true)}
              >
                My positions
              </button>
              <button
                className={`chip ${!showMyPositions ? 'active' : ''}`}
                onClick={() => {
                  setShowMyPositions(false)
                  setFilterOwner('')
                }}
              >
                All indexed
              </button>
            </div>
          )}
        </div>
        <div className="toolbar-actions">
          <div className="search-container" style={{ width: 'auto', flex: 1 }}>
            <input
              className="search-input-field"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by owner, token or position id"
            />
            <span className="search-icon-overlay">🔍</span>
          </div>
          
          <select 
            className="filter-select" 
            value={filterProtocol} 
            onChange={(e) => setFilterProtocol(e.target.value)}
          >
            <option value="all">All protocols</option>
            {uniqueProtocols.map((protocol) => (
              <option key={protocol} value={protocol}>
                {protocol}
              </option>
            ))}
          </select>
          
          {!showMyPositions && (
            <input
              className="filter-select"
              style={{ width: '180px' }}
              placeholder="Filter owner"
              value={filterOwner}
              onChange={(e) => setFilterOwner(e.target.value)}
            />
          )}
          
          <button className="btn-outline btn-icon" onClick={fetchPositions} title="Refresh">
            🔄
          </button>
        </div>
      </div>

      {loading && (
        <div className="positions-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: '280px', borderRadius: '24px' }} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
          <button className="retry-btn" onClick={fetchPositions}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <div className="positions-grid">
          {filteredPositions.length === 0 ? (
            <div className="glass-card empty-state" style={{ gridColumn: '1 / -1', padding: '4rem 2rem', textAlign: 'center' }}>
              {!showAll && !address ? (
                <>
                  <div className="empty-icon" style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔐</div>
                  <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Connect Your Wallet</h3>
                  <p className="text-secondary">Connect your wallet to view and manage your liquidity positions.</p>
                  <div style={{ marginTop: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    <p>Click the "Connect Wallet" button in the top right corner to get started.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="empty-icon" style={{ fontSize: '4rem', marginBottom: '1rem' }}>📭</div>
                  <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>No positions found</h3>
                  <p className="text-secondary">Try adjusting filters or creating a new position.</p>
                  <button className="btn-primary" style={{ marginTop: '1.5rem' }} onClick={() => setFilterProtocol('all')}>
                    Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            filteredPositions.map((position) => (
              <article
                key={position.positionId}
                className={`position-card ${position.active ? 'active' : 'inactive'}`}
                style={{ 
                  gap: '1rem',
                  borderColor: position.active ? 'rgba(16, 185, 129, 0.2)' : 'var(--border-color)',
                  boxShadow: position.active ? '0 0 20px rgba(16, 185, 129, 0.05)' : 'none'
                }}
                onClick={() => onSelectPosition(position)}
              >
                <header className="position-card-header" style={{ marginBottom: '0.5rem' }}>
                  <div className="token-pair-display" style={{ gap: '0.75rem' }}>
                    <div className="avatar-group">
                      <div className="token-avatar-img" style={{ width: '36px', height: '36px', fontSize: '0.8rem', fontWeight: 800 }}>
                        {tokenBadge(position.token0)[0]}
                      </div>
                      <div className="token-avatar-img" style={{ width: '36px', height: '36px', fontSize: '0.8rem', fontWeight: 800 }}>
                        {tokenBadge(position.token1)[0]}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                        {tokenBadge(position.token0)}/{tokenBadge(position.token1)}
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <span className={`status-dot ${position.active ? 'on' : 'off'}`} />
                        <span className="text-secondary" style={{ fontSize: '0.75rem', fontWeight: 500 }}>
                          #{position.positionId} • {position.protocol}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="badge" style={{ 
                    background: position.active ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                    color: position.active ? 'var(--accent-success)' : 'var(--text-secondary)',
                    fontSize: '0.7rem',
                    padding: '0.25rem 0.6rem'
                  }}>
                    {position.active ? 'Running' : 'Paused'}
                  </div>
                </header>

                <div className="position-card-metrics" style={{ 
                  background: 'rgba(0,0,0,0.2)', 
                  border: '1px solid rgba(255,255,255,0.03)',
                  padding: '1rem'
                }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Liquidity</span>
                    <strong className="font-mono" style={{ fontSize: '1.1rem', marginTop: '0.25rem' }}>
                      {position.liquidity ? formatCompact(position.liquidity) : '—'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>
                      {positionValues.get(position.positionId) ? 'Est. Value' : 'Token ID'}
                    </span>
                    <strong className="font-mono text-primary" style={{ fontSize: '1.1rem', marginTop: '0.25rem' }}>
                      {positionValues.get(position.positionId)
                        ? formatCurrency(positionValues.get(position.positionId)!)
                        : position.dexTokenId}
                    </strong>
                  </div>
                </div>

                <div style={{ 
                  marginTop: 'auto', 
                  paddingTop: '0.75rem', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center' 
                }}>
                  <div className="range-pill" style={{ 
                    fontSize: '0.75rem', 
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    color: 'var(--text-secondary)'
                  }}>
                    <span style={{ opacity: 0.7 }}>Tick:</span> <span className="font-mono">{position.tickLower ?? '-'} ↔ {position.tickUpper ?? '-'}</span>
                  </div>
                  <span className="text-primary" style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', opacity: 0.8 }}>
                    Manage
                  </span>
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  )
}

const formatCurrency = (value: number) => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

const formatCompact = (val: string) => {
  try {
    const num = parseFloat(val) / 1e18 // Assuming 18 decimals roughly
    if (num < 0.0001) return '< 0.0001'
    if (num > 1000) return `${(num / 1000).toFixed(1)}k`
    return num.toFixed(2)
  } catch {
    return val.substring(0, 6) + '...'
  }
}
