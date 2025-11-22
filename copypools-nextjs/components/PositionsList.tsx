'use client'

import { useEffect, useState } from 'react'
import { apiService } from '@/lib/services/api'
import { Position } from '@/lib/types'
import { useWallet } from '@/lib/hooks/useWallet'
import { ContractService } from '@/lib/services/contracts'

interface PositionsListProps {
  onSelectPosition: (position: Position) => void
  showAll?: boolean
}

export const PositionsList = ({ onSelectPosition, showAll = true }: PositionsListProps) => {
  const { address, provider } = useWallet()
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterOwner, setFilterOwner] = useState('')
  const [showMyPositions, setShowMyPositions] = useState(!showAll)
  const [useDirectRead, setUseDirectRead] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterProtocol, setFilterProtocol] = useState<string>('all')

  // Direct contract reading
  const fetchPositionsFromContract = async () => {
    if (!provider || !address) {
      setPositions([])
      return
    }

    try {
      setLoading(true)
      setError(null)

      const contractService = new ContractService(provider)
      const loadedPositions: Position[] = []

      // Read positions 1-20 (you can adjust this range)
      for (let i = 1; i <= 20; i++) {
        try {
          const pos = await contractService.getPosition(BigInt(i))

          // Skip inactive positions
          if (!pos.active) {
            continue
          }

          // Filter by owner if needed
          if (showMyPositions && pos.owner.toLowerCase() !== address.toLowerCase()) {
            continue
          }

          // Get additional details from adapter
          try {
            const adapterPos = await contractService.getAdapterPosition(pos.dexTokenId)
            loadedPositions.push({
              id: `contract-${i}`,
              positionId: i.toString(),
              protocol: pos.protocol,
              dexTokenId: pos.dexTokenId.toString(),
              owner: pos.owner,
              token0: pos.token0,
              token1: pos.token1,
              active: pos.active,
              tickLower: Number(adapterPos.tickLower),
              tickUpper: Number(adapterPos.tickUpper),
              liquidity: adapterPos.liquidity.toString(),
              lastCompoundTxHash: null,
              lastCompoundAt: null,
              compoundCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            })
          } catch {
            // If adapter read fails, add basic position info
            loadedPositions.push({
              id: `contract-${i}`,
              positionId: i.toString(),
              protocol: pos.protocol,
              dexTokenId: pos.dexTokenId.toString(),
              owner: pos.owner,
              token0: pos.token0,
              token1: pos.token1,
              active: pos.active,
              tickLower: 0,
              tickUpper: 0,
              liquidity: '0',
              lastCompoundTxHash: null,
              lastCompoundAt: null,
              compoundCount: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            })
          }
        } catch {
          // Position doesn't exist, continue
          continue
        }
      }

      setPositions(loadedPositions)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch positions from contract')
    } finally {
      setLoading(false)
    }
  }

  const fetchPositions = async () => {
    if (useDirectRead) {
      await fetchPositionsFromContract()
      return
    }

    try {
      setLoading(true)
      setError(null)
      const owner = showMyPositions && address ? address : (filterOwner || undefined)
      const data = await apiService.getAllPositions(owner)
      setPositions(data)
    } catch (err: any) {
      // If API fails, fallback to direct contract reading
      console.error('API failed, falling back to direct contract reading:', err)
      setError('Backend unavailable - reading directly from contract...')
      setUseDirectRead(true)
      await fetchPositionsFromContract()
    } finally {
      if (!useDirectRead) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    fetchPositions()
  }, [filterOwner, showMyPositions, address, useDirectRead])

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
  }

  // Get unique protocols for filter
  const uniqueProtocols = [...new Set(positions.map(p => p.protocol))]

  // Filter positions based on search and filters
  const filteredPositions = positions.filter(position => {
    const matchesSearch = !searchQuery || 
      position.positionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      position.owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
      position.token0.toLowerCase().includes(searchQuery.toLowerCase()) ||
      position.token1.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesProtocol = filterProtocol === 'all' || position.protocol === filterProtocol
    
    return matchesSearch && matchesProtocol
  })

  return (
    <div className="positions-list">
      <div className="list-header">
        <div>
          <h2>{showAll ? 'All Positions' : 'My Positions'}</h2>
          <p className="list-subtitle">
            {filteredPositions.length} {filteredPositions.length === 1 ? 'position' : 'positions'} found
          </p>
        </div>
        <div className="header-buttons">
          <button
            onClick={() => {
              setUseDirectRead(!useDirectRead)
              fetchPositions()
            }}
            className="toggle-button"
            title={useDirectRead ? 'Switch to API' : 'Switch to Direct Contract Reading'}
          >
            {useDirectRead ? '📡 Direct' : '🌐 API'}
          </button>
          <button onClick={fetchPositions} className="refresh-button">
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search by position ID, owner, or token address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filters">
          {showAll && (
            <div className="filter-group">
              <label>
                <input
                  type="checkbox"
                  checked={showMyPositions}
                  onChange={(e) => {
                    setShowMyPositions(e.target.checked)
                    if (e.target.checked) setFilterOwner('')
                  }}
                  disabled={!address}
                />
                My Positions Only
              </label>
            </div>
          )}

          <div className="filter-group">
            <select
              value={filterProtocol}
              onChange={(e) => setFilterProtocol(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Protocols</option>
              {uniqueProtocols.map(protocol => (
                <option key={protocol} value={protocol}>{protocol}</option>
              ))}
            </select>
          </div>

          {!showMyPositions && (
            <div className="filter-group">
              <input
                type="text"
                placeholder="Filter by owner address"
                value={filterOwner}
                onChange={(e) => {
                  setFilterOwner(e.target.value)
                  setShowMyPositions(false)
                }}
                className="filter-input"
              />
            </div>
          )}
        </div>
      </div>

      {loading && <div className="loading">Loading positions...</div>}
      {error && <div className="error">Error: {error}</div>}

      {!loading && !error && (
        <div className="positions-grid">
          {filteredPositions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <h3>No positions found</h3>
              <p>Try adjusting your filters or create a new position</p>
            </div>
          ) : (
            filteredPositions.map((position) => (
              <div
                key={position.positionId}
                className={`position-card ${position.active ? 'active' : 'inactive'}`}
                onClick={() => onSelectPosition(position)}
              >
                <div className="position-card-header">
                  <div className="position-id-section">
                    <span className="position-icon">💼</span>
                    <div>
                      <h3>Position #{position.positionId}</h3>
                      <span className="protocol-badge">{position.protocol}</span>
                    </div>
                  </div>
                  <span className={`status-badge ${position.active ? 'active' : 'inactive'}`}>
                    {position.active ? '● Active' : '○ Inactive'}
                  </span>
                </div>

                <div className="position-tokens">
                  <div className="token-pair">
                    <div className="token-item">
                      <div className="token-avatar">T0</div>
                      <span className="token-address">{formatAddress(position.token0)}</span>
                    </div>
                    <div className="token-divider">/</div>
                    <div className="token-item">
                      <div className="token-avatar">T1</div>
                      <span className="token-address">{formatAddress(position.token1)}</span>
                    </div>
                  </div>
                </div>

                <div className="position-metrics">
                  {position.tickLower !== undefined && (
                    <div className="metric-item">
                      <span className="metric-label">Range</span>
                      <span className="metric-value">
                        [{position.tickLower}, {position.tickUpper}]
                      </span>
                    </div>
                  )}
                  {position.liquidity && (
                    <div className="metric-item">
                      <span className="metric-label">Liquidity</span>
                      <span className="metric-value">{position.liquidity}</span>
                    </div>
                  )}
                </div>

                <div className="position-footer">
                  <div className="owner-info">
                    <span className="owner-label">Owner:</span>
                    <span className="owner-address">{formatAddress(position.owner)}</span>
                  </div>
                  <div className="view-details">View Details →</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
