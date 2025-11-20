'use client'

import { useEffect, useState } from 'react'
import { apiService } from '@/lib/services/api'
import { HealthStatus } from '@/lib/types'

export const HealthCheck = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiService.getHealthStatus()
      setHealth(data)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch health status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [])

  if (loading && !health) return <div className="loading">Loading health status...</div>
  if (error) return <div className="error">Error: {error}</div>
  if (!health) return null

  return (
    <div className="health-check">
      <h2>Backend Health Status</h2>
      <div className={`status-indicator ${health.status}`}>
        {health.status.toUpperCase()}
      </div>

      <div className="health-details">
        <div className="health-section">
          <h3>Blockchain</h3>
          <p>Connected: {health.blockchain.connected ? '✅' : '❌'}</p>
          {health.blockchain.blockNumber && (
            <p>Block Number: {health.blockchain.blockNumber}</p>
          )}
          {health.blockchain.gasPrice && (
            <p>Gas Price: {health.blockchain.gasPrice} wei</p>
          )}
        </div>

        {health.database && (
          <div className="health-section">
            <h3>Database</h3>
            <p>Total Positions: {health.database.totalPositions}</p>
            <p>Active Positions: {health.database.activePositions}</p>
          </div>
        )}

        {health.error && (
          <div className="health-error">
            <strong>Error:</strong> {health.error}
          </div>
        )}
      </div>

      <button onClick={fetchHealth} className="refresh-button">
        Refresh
      </button>
    </div>
  )
}
