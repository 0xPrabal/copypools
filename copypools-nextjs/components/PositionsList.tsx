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

  const heroTitle = showAll ? 'Discover liquidity positions' : 'Your active strategies'
  const heroSubtitle = showAll
    ? 'Scan indexed Uniswap v4 positions or import an existing vault.'
    : 'Track, manage, and compound all of your CopyPools positions from one place.'

  const tokenBadge = (address: string) => address.slice(2, 6).toUpperCase()
  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`

  const fetchPositions = async () => {
    try {
      setLoading(true)
      setError(null)
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
        // Continue without TVL data - component will show placeholder
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
      <div className="positions-hero">
        <div className="positions-hero-text">
          <span className="hero-pill">{showAll ? 'Discover' : 'Portfolio'}</span>
          <h2>{heroTitle}</h2>
          <p>{heroSubtitle}</p>
        </div>
        <div className="positions-summary-grid">
          <div className="summary-card">
            <label>Total positions</label>
            <strong>{summary.total}</strong>
            <span>{summary.active} active</span>
          </div>
          <div className="summary-card">
            <label>Estimated TVL</label>
            <strong>{formatCurrency(summary.estimatedTVL)}</strong>
            <span>Across filtered set</span>
          </div>
          <div className="summary-card">
            <label>Status</label>
            <strong>{summary.active} / {summary.total}</strong>
            <span>{summary.inactive} inactive</span>
          </div>
        </div>
      </div>

      <div className="positions-toolbar">
        <div className="toolbar-left">
          {showAll && address && (
            <div className="toggle-pill">
              <button
                className={showMyPositions ? 'active' : ''}
                onClick={() => setShowMyPositions(true)}
              >
                My positions
              </button>
              <button
                className={!showMyPositions ? 'active' : ''}
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
          <div className="search-input-wrapper">
            <span>🔍</span>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by owner, token or position id"
            />
          </div>
          <select value={filterProtocol} onChange={(e) => setFilterProtocol(e.target.value)}>
            <option value="all">All protocols</option>
            {uniqueProtocols.map((protocol) => (
              <option key={protocol} value={protocol}>
                {protocol}
              </option>
            ))}
          </select>
          {!showMyPositions && (
            <input
              placeholder="Filter owner"
              value={filterOwner}
              onChange={(e) => setFilterOwner(e.target.value)}
            />
          )}
          <button className="pill-action" onClick={fetchPositions}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="positions-loading">
          <div className="skeleton" style={{ width: '100%', height: '160px' }}></div>
        </div>
      )}

      {!loading && error && <div className="error-banner">{error}</div>}

      {!loading && !error && (
        <div className="positions-grid">
          {filteredPositions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <h3>No positions</h3>
              <p>Try adjusting filters or creating a new position.</p>
            </div>
          ) : (
            filteredPositions.map((position) => (
              <article
                key={position.positionId}
                className={`position-card ${position.active ? 'active' : 'inactive'}`}
                onClick={() => onSelectPosition(position)}
              >
                <header className="position-card-header">
                  <div className="token-chips">
                    <span>{tokenBadge(position.token0)}</span>
                    <span>{tokenBadge(position.token1)}</span>
                  </div>
                  <div className={`status-dot ${position.active ? 'on' : 'off'}`}></div>
                </header>

                <div className="position-card-body">
                  <div>
                    <p className="position-label">Position #{position.positionId}</p>
                    <h3>{position.protocol}</h3>
                    <p className="position-owner">Owner {formatAddress(position.owner)}</p>
                  </div>
                  <div className="range-pill">
                    Range {position.tickLower ?? '-'} / {position.tickUpper ?? '-'}
                  </div>
                </div>

                <div className="position-card-metrics">
                  <div>
                    <span>Liquidity</span>
                    <strong>{position.liquidity || '—'}</strong>
                  </div>
                  <div>
                    <span>{positionValues.get(position.positionId) ? 'Est. Value' : 'DEX token'}</span>
                    <strong>
                      {positionValues.get(position.positionId)
                        ? formatCurrency(positionValues.get(position.positionId)!)
                        : position.dexTokenId}
                    </strong>
                  </div>
                </div>

                <footer className="position-card-footer">
                  <button className="btn-outline">Manage</button>
                  <span className="view-details">View details →</span>
                </footer>
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
