'use client'

import { useEffect, useMemo, useState } from 'react'

import { apiService } from '@/lib/services/api'
import { Position } from '@/lib/types'

const formatCurrency = (value: number) => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

export const AnalyticsDashboard = () => {
  const [tvlData, setTvlData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch REAL TVL data from analytics endpoint
        const data = await apiService.getTVLData()
        setTvlData(data)
      } catch (err) {
        console.error('Failed to fetch TVL data:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const summary = useMemo(() => {
    if (!tvlData) {
      return {
        total: 0,
        active: 0,
        protocols: [],
        totalTVL: 0,
        averageLiquidity: 0,
      }
    }

    // Extract protocols from positions
    const protocols = [...new Set(tvlData.positions.map((p: any) => p.protocol || 'UNISWAP_V4'))]

    // Calculate average from REAL position values
    const averageValue = tvlData.positionCount > 0
      ? tvlData.totalTVL / tvlData.positionCount
      : 0

    return {
      total: tvlData.positionCount,
      active: tvlData.activePositions,
      protocols,
      totalTVL: tvlData.totalTVL,
      averageLiquidity: averageValue,
    }
  }, [tvlData])

  const metrics = [
    {
      label: 'Indexed positions',
      value: loading ? '…' : summary.total,
      change: loading ? '' : `${summary.active} active`,
      icon: '📊',
    },
    {
      label: 'Protocols tracked',
      value: loading ? '…' : summary.protocols.length,
      change: loading ? '' : summary.protocols.slice(0, 3).join(', ') || '—',
      icon: '🛰️',
    },
    {
      label: 'Total TVL',
      value: loading ? '…' : formatCurrency(summary.totalTVL),
      change: tvlData ? `Updated ${new Date(tvlData.lastUpdated).toLocaleTimeString()}` : 'Real-time TVL',
      icon: '💰',
    },
    {
      label: 'Avg. Liquidity',
      value: loading ? '…' : formatCurrency(summary.averageLiquidity),
      change: 'Per position',
      icon: '⚡',
    },
  ]

  return (
    <section className="analytics-section">
      <div className="analytics-header">
        <div>
          <span className="hero-pill">Discover</span>
          <h2>Protocol overview</h2>
          <p>Live insights from the CopyPools indexer, refreshed every minute.</p>
        </div>
        <button className="btn-outline" onClick={() => window.location.reload()}>
          Refresh
        </button>
      </div>

      <div className="analytics-grid">
        {metrics.map((metric) => (
          <div key={metric.label} className="analytics-card">
            <div className="metric-icon">{metric.icon}</div>
            <div className="metric-text">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.change && <small>{metric.change}</small>}
            </div>
          </div>
        ))}
      </div>

      {summary.protocols.length > 0 && (
        <div className="protocol-chip-grid">
          {summary.protocols.map((protocol) => (
            <span key={protocol} className="protocol-chip">
              {protocol}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
