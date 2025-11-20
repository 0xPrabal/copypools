'use client'

import { useEffect, useState } from 'react'
import { apiService } from '@/lib/services/api'
import { Position } from '@/lib/types'
import { useWallet } from '@/lib/hooks/useWallet'
import { ContractService } from '@/lib/services/contracts'

interface PositionsListProps {
  onSelectPosition: (position: Position) => void
}

export const PositionsList = ({ onSelectPosition }: PositionsListProps) => {
  const { address, provider } = useWallet()
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterOwner, setFilterOwner] = useState('')
  const [showMyPositions, setShowMyPositions] = useState(false)
  const [useDirectRead, setUseDirectRead] = useState(false)

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

  return (
    <div className="positions-list">
      <div className="list-header">
        <h2>Positions</h2>
        <div className="header-buttons">
          <button
            onClick={() => {
              setUseDirectRead(!useDirectRead)
              fetchPositions()
            }}
            className="toggle-button"
            title={useDirectRead ? 'Switch to API' : 'Switch to Direct Contract Reading'}
          >
            {useDirectRead ? '📡 Direct Read' : '🌐 API'}
          </button>
          <button onClick={fetchPositions} className="refresh-button">
            Refresh
          </button>
        </div>
      </div>

      <div className="filters">
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
            Show My Positions Only
          </label>
        </div>

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
      </div>

      {loading && <div className="loading">Loading positions...</div>}
      {error && <div className="error">Error: {error}</div>}

      {!loading && !error && (
        <div className="positions-grid">
          {positions.length === 0 ? (
            <div className="empty-state">No positions found</div>
          ) : (
            positions.map((position) => (
              <div
                key={position.positionId}
                className={`position-card ${position.active ? 'active' : 'inactive'}`}
                onClick={() => onSelectPosition(position)}
              >
                <div className="position-header">
                  <h3>Position #{position.positionId}</h3>
                  <span className={`status-badge ${position.active ? 'active' : 'inactive'}`}>
                    {position.active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="position-details">
                  <p><strong>Protocol:</strong> {position.protocol}</p>
                  <p><strong>Owner:</strong> {formatAddress(position.owner)}</p>
                  <p><strong>Token0:</strong> {formatAddress(position.token0)}</p>
                  <p><strong>Token1:</strong> {formatAddress(position.token1)}</p>
                  {position.tickLower !== undefined && (
                    <p><strong>Tick Range:</strong> [{position.tickLower}, {position.tickUpper}]</p>
                  )}
                  {position.liquidity && (
                    <p><strong>Liquidity:</strong> {position.liquidity}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
