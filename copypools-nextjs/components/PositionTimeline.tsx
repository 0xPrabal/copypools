'use client'

import { useEffect, useState } from 'react'
import { apiService } from '@/lib/services/api'
import { TimelineEvent } from '@/lib/types'
import { EXPLORER_URLS } from '@/lib/config/constants'
import { useWallet } from '@/lib/hooks'

interface PositionTimelineProps {
  positionId: string
}

export const PositionTimeline = ({ positionId }: PositionTimelineProps) => {
  const { chainId } = useWallet()
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTimeline()
  }, [positionId])

  const fetchTimeline = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiService.getPositionTimeline(positionId)
      setTimeline(data)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch timeline')
      console.error('Failed to fetch timeline:', err)
    } finally {
      setLoading(false)
    }
  }

  const explorerUrl = chainId ? EXPLORER_URLS[chainId] : ''

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'RANGE_MOVE':
        return '📊'
      case 'COMPOUND':
        return '💎'
      case 'CLOSE':
        return '🔒'
      default:
        return '📝'
    }
  }

  const getEventLabel = (type: string) => {
    switch (type) {
      case 'RANGE_MOVE':
        return 'Range Moved'
      case 'COMPOUND':
        return 'Fees Compounded'
      case 'CLOSE':
        return 'Position Closed'
      default:
        return type
    }
  }

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="timeline-container">
        <div className="loading">Loading timeline...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="timeline-container">
        <div className="error-message">{error}</div>
      </div>
    )
  }

  if (timeline.length === 0) {
    return (
      <div className="timeline-container">
        <div className="empty-timeline">
          <div className="empty-icon">📅</div>
          <p>No timeline events found</p>
        </div>
      </div>
    )
  }

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <h3>Position Timeline</h3>
        <button onClick={fetchTimeline} className="refresh-button-small">
          🔄 Refresh
        </button>
      </div>

      <div className="timeline-events">
        {timeline.map((event, index) => (
          <div key={index} className="timeline-event">
            <div className="timeline-event-icon">{getEventIcon(event.type)}</div>
            <div className="timeline-event-content">
              <div className="timeline-event-header">
                <span className="timeline-event-type">{getEventLabel(event.type)}</span>
                <span className="timeline-event-date">{formatDate(event.timestamp)}</span>
              </div>

              <div className="timeline-event-details">
                {event.type === 'RANGE_MOVE' && (
                  <div className="event-detail">
                    <span className="detail-label">New Range:</span>
                    <span className="detail-value">
                      [{event.newTickLower}, {event.newTickUpper}]
                    </span>
                  </div>
                )}

                {event.type === 'COMPOUND' && (
                  <div className="event-detail">
                    <span className="detail-label">Added Liquidity:</span>
                    <span className="detail-value">{event.addedLiquidity || 'N/A'}</span>
                  </div>
                )}

                {event.type === 'CLOSE' && (
                  <div className="event-detail">
                    <span className="detail-label">Amounts:</span>
                    <span className="detail-value">
                      {event.amount0} / {event.amount1}
                    </span>
                  </div>
                )}

                {event.blockNumber && (
                  <div className="event-detail">
                    <span className="detail-label">Block:</span>
                    <span className="detail-value">#{event.blockNumber}</span>
                  </div>
                )}
              </div>

              {event.txHash && explorerUrl && (
                <a
                  href={`${explorerUrl}/tx/${event.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="timeline-event-link"
                >
                  View Transaction →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

