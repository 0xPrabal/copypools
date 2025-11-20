'use client'

import { useState } from 'react'
import { WalletConnect } from '@/components/WalletConnect'
import { HealthCheck } from '@/components/HealthCheck'
import { PositionsList } from '@/components/PositionsList'
import { PositionDetails } from '@/components/PositionDetails'
import { AddLiquidity } from '@/components/AddLiquidity'
import { Position } from '@/lib/types'

export default function Home() {
  const [activeTab, setActiveTab] = useState<'positions' | 'add' | 'health'>('positions')
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null)

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>🏊 CopyPools Testing Dashboard</h1>
          <WalletConnect />
        </div>
        <nav className="nav-tabs">
          <button
            className={`tab ${activeTab === 'positions' ? 'active' : ''}`}
            onClick={() => setActiveTab('positions')}
          >
            Positions
          </button>
          <button
            className={`tab ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => setActiveTab('add')}
          >
            Add Liquidity
          </button>
          <button
            className={`tab ${activeTab === 'health' ? 'active' : ''}`}
            onClick={() => setActiveTab('health')}
          >
            Health Status
          </button>
        </nav>
      </header>

      <main className="app-main">
        <div className="container">
          {activeTab === 'positions' && (
            <PositionsList onSelectPosition={setSelectedPosition} />
          )}
          {activeTab === 'add' && <AddLiquidity />}
          {activeTab === 'health' && <HealthCheck />}
        </div>
      </main>

      {selectedPosition && (
        <PositionDetails
          position={selectedPosition}
          onClose={() => setSelectedPosition(null)}
        />
      )}

      <footer className="app-footer">
        <p>CopyPools Protocol - Multi-DEX Liquidity Management</p>
        <p className="footer-links">
          <a href="https://github.com/doryoku-projects/copypools-smart-contract" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          {' | '}
          <a href="https://docs.copypools.xyz" target="_blank" rel="noopener noreferrer">
            Documentation
          </a>
        </p>
      </footer>
    </div>
  )
}
