'use client'

import { useEffect, useState } from 'react'
import { apiService } from '@/lib/services/api'
import { Position } from '@/lib/types'

export const AnalyticsDashboard = () => {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await apiService.getAllPositions()
        setPositions(data)
      } catch (err) {
        console.error('Failed to fetch positions:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const activePositions = positions.filter(p => p.active).length
  const totalPositions = positions.length
  const protocols = [...new Set(positions.map(p => p.protocol))]

  // Calculate estimated TVL (simplified - would need actual token values)
  const estimatedTVL = positions.length * 1000 // Placeholder

  return (
    <div className="analytics-dashboard">
      <div className="dashboard-header">
        <h2>Protocol Overview</h2>
        <p className="dashboard-subtitle">Real-time metrics and insights</p>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">📊</div>
          <div className="metric-content">
            <div className="metric-label">Total Positions</div>
            <div className="metric-value">{loading ? '...' : totalPositions}</div>
            <div className="metric-change positive">
              {activePositions} active
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">💎</div>
          <div className="metric-content">
            <div className="metric-label">Estimated TVL</div>
            <div className="metric-value">
              {loading ? '...' : `$${estimatedTVL.toLocaleString()}`}
            </div>
            <div className="metric-change">Across all pools</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">🔗</div>
          <div className="metric-content">
            <div className="metric-label">Supported Protocols</div>
            <div className="metric-value">{loading ? '...' : protocols.length}</div>
            <div className="metric-change">
              {protocols.join(', ') || 'None'}
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">⚡</div>
          <div className="metric-content">
            <div className="metric-label">Active Rate</div>
            <div className="metric-value">
              {loading ? '...' : totalPositions > 0 
                ? `${Math.round((activePositions / totalPositions) * 100)}%`
                : '0%'}
            </div>
            <div className="metric-change positive">
              {activePositions} / {totalPositions} positions
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

