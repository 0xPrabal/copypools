'use client'

import { useState } from 'react'
import { WalletConnect } from '@/components/WalletConnect'
import { PositionsList } from '@/components/PositionsList'
import { PositionDetails } from '@/components/PositionDetails'
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard'
import { PoolDiscovery } from '@/components/PoolDiscovery'
import { Position } from '@/lib/types'

export default function Home() {
  const [activeTab, setActiveTab] = useState<'discover' | 'positions' | 'create'>('discover')
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null)

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo-section">
            <h1 className="logo" onClick={() => setActiveTab('discover')}>CopyPools</h1>
            <span className="tagline">Liquidity Management for Uniswap V4</span>
          </div>
          <WalletConnect />
        </div>
        <nav className="nav-tabs">
          <button
            className={`tab ${activeTab === 'discover' ? 'active' : ''}`}
            onClick={() => setActiveTab('discover')}
          >
            <span className="tab-icon">🔍</span>
            Discover
          </button>
          <button
            className={`tab ${activeTab === 'positions' ? 'active' : ''}`}
            onClick={() => setActiveTab('positions')}
          >
            <span className="tab-icon">💼</span>
            My Positions
          </button>
          <button
            className={`tab ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            <span className="tab-icon">✨</span>
            Create Position
          </button>
        </nav>
      </header>

      <main className="app-main">
        <div className="container">
          {activeTab === 'discover' && (
            <div className="fade-in-content">
              <AnalyticsDashboard />
              <PositionsList onSelectPosition={setSelectedPosition} showAll={true} />
            </div>
          )}
          {activeTab === 'positions' && (
            <div className="fade-in-content">
              <PositionsList onSelectPosition={setSelectedPosition} showAll={false} />
            </div>
          )}
          {activeTab === 'create' && (
            <div className="create-position-page fade-in-content">
              <PoolDiscovery />
            </div>
          )}
        </div>
      </main>

      {selectedPosition && (
        <PositionDetails
          position={selectedPosition}
          onClose={() => setSelectedPosition(null)}
        />
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <p>© 2025 CopyPools Protocol</p>
            <span>Multi-DEX Liquidity Management on Uniswap v4</span>
          </div>
          <div className="footer-links">
            <a href="https://github.com/doryoku-projects/copypools-smart-contract" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <span>•</span>
            <a href="https://docs.copypools.xyz" target="_blank" rel="noopener noreferrer">
              Documentation
            </a>
            <span>•</span>
            <a href="#" className="text-secondary">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
