'use client'

import { useState, useEffect } from 'react'
import { parseUnits, formatUnits } from 'ethers'
import { Position, Transaction } from '@/lib/types'
import { apiService } from '@/lib/services/api'
import { ContractService } from '@/lib/services/contracts'
import { useWallet } from '@/lib/hooks'
import { EXPLORER_URLS } from '@/lib/config/constants'
import { PositionTimeline } from './PositionTimeline'
import { TokenInfoService } from '@/lib/services/tokenInfo'

interface PositionDetailsProps {
  position: Position
  onClose: () => void
}

export const PositionDetails = ({ position, onClose }: PositionDetailsProps) => {
  const { provider, address, chainId } = useWallet()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'operations' | 'timeline' | 'transactions'>('operations')
  const [syncing, setSyncing] = useState(false)

  // Move Range
  const [tickLower, setTickLower] = useState('')
  const [tickUpper, setTickUpper] = useState('')
  const [moveRangeSwap, setMoveRangeSwap] = useState(false)

  // Compound
  const [compoundSwap, setCompoundSwap] = useState(false)

  // Close
  const [closeLiquidity, setCloseLiquidity] = useState('')

  // Increase Liquidity
  const [increaseAmount0, setIncreaseAmount0] = useState('')
  const [increaseAmount1, setIncreaseAmount1] = useState('')

  // Decrease Liquidity
  const [decreaseLiquidityAmount, setDecreaseLiquidityAmount] = useState('')

  const [operationType, setOperationType] = useState<
    'moveRange' | 'compound' | 'close' | 'increase' | 'decrease' | 'collectFees' | 'burn' | null
  >(null)

  useEffect(() => {
    fetchTransactions()
  }, [position.positionId])

  const fetchTransactions = async () => {
    try {
      const data = await apiService.getPositionTransactions(position.positionId)
      setTransactions(data)
    } catch (err) {
      console.error('Failed to fetch transactions:', err)
    }
  }

  // Helper function to align tick to tick spacing
  const alignTickToSpacing = (tick: number, tickSpacing: number): number => {
    return Math.round(tick / tickSpacing) * tickSpacing
  }

  const handleMoveRange = async () => {
    if (!provider || !address) {
      alert('Please connect your wallet')
      return
    }

    if (!tickLower || !tickUpper) {
      alert('Please enter tick range')
      return
    }

    if (!position.positionId) {
      alert('Invalid position ID')
      return
    }

    try {
      setLoading(true)
      setError(null)
      setOperationType('moveRange')

      // Align ticks to tick spacing (fee 3000 = spacing 60)
      const tickSpacing = 60 // Fee tier 3000
      const inputTickLower = parseInt(tickLower)
      const inputTickUpper = parseInt(tickUpper)

      if (isNaN(inputTickLower) || isNaN(inputTickUpper)) {
        alert('Invalid tick values. Please enter valid numbers.')
        setLoading(false)
        setOperationType(null)
        return
      }

      if (inputTickLower >= inputTickUpper) {
        alert('Tick lower must be less than tick upper')
        setLoading(false)
        setOperationType(null)
        return
      }

      const alignedTickLower = alignTickToSpacing(inputTickLower, tickSpacing)
      const alignedTickUpper = alignTickToSpacing(inputTickUpper, tickSpacing)

      if (alignedTickLower !== inputTickLower || alignedTickUpper !== inputTickUpper) {
        const proceed = confirm(
          `Ticks adjusted for alignment:\n` +
          `Lower: ${inputTickLower} → ${alignedTickLower}\n` +
          `Upper: ${inputTickUpper} → ${alignedTickUpper}\n` +
          `(Tick spacing: ${tickSpacing})\n\n` +
          `Continue?`
        )
        if (!proceed) {
          setLoading(false)
          setOperationType(null)
          return
        }
      }

      const contractService = new ContractService(provider)
      const tx = await contractService.moveRange(
        BigInt(position.positionId),
        alignedTickLower,
        alignedTickUpper,
        moveRangeSwap
      )

      alert(`Move Range successful! Transaction: ${tx.hash}`)
      fetchTransactions()
      setTickLower('')
      setTickUpper('')
    } catch (err: any) {
      setError(err.message || 'Failed to move range')
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
      setOperationType(null)
    }
  }

  const handleCompound = async () => {
    if (!provider || !address) {
      alert('Please connect your wallet')
      return
    }

    if (!position.positionId) {
      alert('Invalid position ID')
      return
    }

    try {
      setLoading(true)
      setError(null)
      setOperationType('compound')

      const contractService = new ContractService(provider)
      const tx = await contractService.compound(
        BigInt(position.positionId),
        compoundSwap
      )

      alert(`Compound successful! Transaction: ${tx.hash}`)
      fetchTransactions()
    } catch (err: any) {
      setError(err.message || 'Failed to compound')
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
      setOperationType(null)
    }
  }

  const handleIncreaseLiquidity = async () => {
    if (!provider || !address) {
      alert('Please connect your wallet')
      return
    }

    if (!increaseAmount0 || !increaseAmount1) {
      alert('Please enter both token amounts')
      return
    }

    if (isNaN(parseFloat(increaseAmount0)) || isNaN(parseFloat(increaseAmount1))) {
      alert('Please enter valid amounts')
      return
    }

    if (!position.positionId) {
      alert('Invalid position ID')
      return
    }

    try {
      setLoading(true)
      setError(null)
      setOperationType('increase')

      const contractService = new ContractService(provider)
      const token0Info = await contractService.getTokenInfo(position.token0)
      const token1Info = await contractService.getTokenInfo(position.token1)

      const amount0 = parseUnits(increaseAmount0, token0Info.decimals)
      const amount1 = parseUnits(increaseAmount1, token1Info.decimals)

      const tx = await contractService.increaseLiquidity(
        BigInt(position.positionId),
        amount0,
        amount1
      )

      alert(`Increase liquidity successful! Transaction: ${tx.hash}`)
      fetchTransactions()
      setIncreaseAmount0('')
      setIncreaseAmount1('')
    } catch (err: any) {
      setError(err.message || 'Failed to increase liquidity')
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
      setOperationType(null)
    }
  }

  const handleDecreaseLiquidity = async () => {
    if (!provider || !address) {
      alert('Please connect your wallet')
      return
    }

    if (!decreaseLiquidityAmount) {
      alert('Please enter liquidity amount to decrease')
      return
    }

    if (!position.positionId) {
      alert('Invalid position ID')
      return
    }

    try {
      BigInt(decreaseLiquidityAmount)
    } catch {
      alert('Invalid liquidity amount. Please enter a valid whole number.')
      return
    }

    try {
      setLoading(true)
      setError(null)
      setOperationType('decrease')

      const contractService = new ContractService(provider)
      const tx = await contractService.decreaseLiquidity(
        BigInt(position.positionId),
        BigInt(decreaseLiquidityAmount)
      )

      alert(`Decrease liquidity successful! Transaction: ${tx.hash}`)
      fetchTransactions()
      setDecreaseLiquidityAmount('')
    } catch (err: any) {
      setError(err.message || 'Failed to decrease liquidity')
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
      setOperationType(null)
    }
  }

  const handleCollectFees = async () => {
    if (!provider || !address) {
      alert('Please connect your wallet')
      return
    }

    if (!position.positionId) {
      alert('Invalid position ID')
      return
    }

    try {
      setLoading(true)
      setError(null)
      setOperationType('collectFees')

      const contractService = new ContractService(provider)
      const tx = await contractService.collectFees(BigInt(position.positionId))

      alert(`Fees collected successfully! Transaction: ${tx.hash}`)
      fetchTransactions()
    } catch (err: any) {
      setError(err.message || 'Failed to collect fees')
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
      setOperationType(null)
    }
  }

  const handleBurnPosition = async () => {
    if (!provider || !address) {
      alert('Please connect your wallet')
      return
    }

    if (!position.positionId) {
      alert('Invalid position ID')
      return
    }

    if (!confirm('Are you sure you want to BURN this position? This will remove all liquidity and close the position permanently.')) {
      return
    }

    try {
      setLoading(true)
      setError(null)
      setOperationType('burn')

      const contractService = new ContractService(provider)
      const tx = await contractService.burnPosition(BigInt(position.positionId))

      alert(`Position burned successfully! Transaction: ${tx.hash}`)
      fetchTransactions()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to burn position')
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
      setOperationType(null)
    }
  }

  const handleClosePosition = async () => {
    if (!provider || !address) {
      alert('Please connect your wallet')
      return
    }

    if (!closeLiquidity) {
      alert('Please enter liquidity amount')
      return
    }

    if (!position.positionId) {
      alert('Invalid position ID')
      return
    }

    try {
      BigInt(closeLiquidity)
    } catch {
      alert('Invalid liquidity amount. Please enter a valid whole number.')
      return
    }

    if (!confirm('Are you sure you want to close this position?')) {
      return
    }

    try {
      setLoading(true)
      setError(null)
      setOperationType('close')

      const contractService = new ContractService(provider)
      const tx = await contractService.closePosition(
        BigInt(position.positionId),
        BigInt(closeLiquidity)
      )

      alert(`Close position successful! Transaction: ${tx.hash}`)
      fetchTransactions()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to close position')
      alert(`Error: ${err.message}`)
    } finally {
      setLoading(false)
      setOperationType(null)
    }
  }

  const explorerUrl = chainId ? EXPLORER_URLS[chainId] : ''

  const getTokenSymbol = (address: string): string => {
    return TokenInfoService.getTokenSymbol(address)
  }

  const formatLiquidity = (liquidityStr: string): string => {
    try {
      const liquidity = BigInt(liquidityStr)
      const formatted = formatUnits(liquidity, 18)
      const num = parseFloat(formatted)
      if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
      if (num >= 1000) return `${(num / 1000).toFixed(2)}K`
      return num.toFixed(4)
    } catch {
      return liquidityStr
    }
  }

  const handleSyncPosition = async () => {
    try {
      setSyncing(true)
      setError(null)
      await apiService.syncPosition(position.positionId)
      fetchTransactions()
      alert('Position synced successfully!')
    } catch (err: any) {
      setError(err.message || 'Failed to sync position')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="position-details-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content">
        <div className="modal-header">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div className="avatar-group">
                <div className="token-avatar-img" style={{ width: '40px', height: '40px' }}>{getTokenSymbol(position.token0)[0]}</div>
                <div className="token-avatar-img" style={{ width: '40px', height: '40px' }}>{getTokenSymbol(position.token1)[0]}</div>
            </div>
            <div>
              <h2 style={{ fontSize: '1.5rem', margin: 0 }}>
                {getTokenSymbol(position.token0)}/{getTokenSymbol(position.token1)}
              </h2>
              <span className="badge badge-primary">#{position.positionId}</span>
            </div>
          </div>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="modal-body">
          {/* Position Info Grid */}
          <div className="glass-card" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
            <div className="section-header-with-action" style={{ marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Position Details</h3>
              <button
                onClick={handleSyncPosition}
                disabled={syncing}
                className="btn-outline btn-sm"
                title="Sync position data from blockchain"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              >
                {syncing ? '⏳ Syncing...' : '🔄 Sync'}
              </button>
            </div>
            <div className="info-grid" style={{ background: 'transparent', border: 'none', padding: 0 }}>
              <div>
                 <span className="text-secondary" style={{ fontSize: '0.8rem' }}>Protocol</span>
                 <strong style={{ fontSize: '1rem' }}>{position.protocol}</strong>
              </div>
              <div>
                 <span className="text-secondary" style={{ fontSize: '0.8rem' }}>Status</span>
                 <div style={{ marginTop: '0.25rem' }}>
                    <span className={`badge ${position.active ? 'badge-success' : 'badge-danger'}`}>
                        {position.active ? 'Active' : 'Inactive'}
                    </span>
                 </div>
              </div>
              <div>
                 <span className="text-secondary" style={{ fontSize: '0.8rem' }}>Owner</span>
                 <a 
                    href={`${explorerUrl}/address/${position.owner}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="font-mono text-primary"
                    style={{ fontSize: '0.9rem' }}
                 >
                    {position.owner.substring(0, 6)}...{position.owner.substring(38)}
                 </a>
              </div>
              <div>
                 <span className="text-secondary" style={{ fontSize: '0.8rem' }}>Liquidity</span>
                 <strong className="font-mono">{position.liquidity ? formatLiquidity(position.liquidity) : '0'}</strong>
              </div>
              <div>
                 <span className="text-secondary" style={{ fontSize: '0.8rem' }}>Price Range</span>
                 <strong className="font-mono">{position.tickLower} ↔ {position.tickUpper}</strong>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="position-tabs">
            <button
              className={`position-tab ${activeTab === 'operations' ? 'active' : ''}`}
              onClick={() => setActiveTab('operations')}
            >
              Manage
            </button>
            <button
              className={`position-tab ${activeTab === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('timeline')}
            >
              Analytics
            </button>
            <button
              className={`position-tab ${activeTab === 'transactions' ? 'active' : ''}`}
              onClick={() => setActiveTab('transactions')}
            >
              History
            </button>
          </div>

          {/* Operations Tab */}
          {activeTab === 'operations' && position.active && address && (
            <div className="section operations fade-in-content" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
              
              {error && <div className="error-message" style={{ gridColumn: '1 / -1' }}>{error}</div>}

              {/* Increase Liquidity */}
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <h4 style={{ marginBottom: '1rem' }}>Add Liquidity</h4>
                <div className="form-group">
                  <input
                    type="number"
                    placeholder={`Amount ${getTokenSymbol(position.token0)}`}
                    value={increaseAmount0}
                    onChange={(e) => setIncreaseAmount0(e.target.value)}
                    disabled={loading}
                    className="range-input"
                  />
                  <input
                    type="number"
                    placeholder={`Amount ${getTokenSymbol(position.token1)}`}
                    value={increaseAmount1}
                    onChange={(e) => setIncreaseAmount1(e.target.value)}
                    disabled={loading}
                    className="range-input"
                  />
                  <button
                    onClick={handleIncreaseLiquidity}
                    disabled={loading || !increaseAmount0 || !increaseAmount1}
                    className="btn-primary"
                    style={{ width: '100%' }}
                  >
                    {loading && operationType === 'increase' ? 'Processing...' : 'Deposit'}
                  </button>
                </div>
              </div>

              {/* Collect Fees */}
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <h4 style={{ marginBottom: '1rem' }}>Claim Rewards</h4>
                <div className="form-group">
                  <p className="text-secondary" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                    Collect accumulated trading fees from this position.
                  </p>
                  <button
                    onClick={handleCollectFees}
                    disabled={loading}
                    className="btn-gradient"
                    style={{ width: '100%' }}
                  >
                    {loading && operationType === 'collectFees' ? 'Processing...' : 'Collect Fees'}
                  </button>
                </div>
              </div>

              {/* Decrease Liquidity */}
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <h4 style={{ marginBottom: '1rem' }}>Remove Liquidity</h4>
                <div className="form-group">
                  <input
                    type="text"
                    placeholder="Liquidity Amount to Remove"
                    value={decreaseLiquidityAmount}
                    onChange={(e) => setDecreaseLiquidityAmount(e.target.value)}
                    disabled={loading}
                    className="range-input"
                  />
                  <button
                    onClick={handleDecreaseLiquidity}
                    disabled={loading || !decreaseLiquidityAmount}
                    className="btn-outline"
                    style={{ width: '100%' }}
                  >
                    {loading && operationType === 'decrease' ? 'Processing...' : 'Withdraw'}
                  </button>
                </div>
              </div>

              {/* Move Range */}
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <h4 style={{ marginBottom: '1rem' }}>Adjust Range</h4>
                <div className="form-group">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <input
                      type="number"
                      placeholder="Min Tick"
                      value={tickLower}
                      onChange={(e) => setTickLower(e.target.value)}
                      disabled={loading}
                      className="range-input"
                    />
                    <input
                      type="number"
                      placeholder="Max Tick"
                      value={tickUpper}
                      onChange={(e) => setTickUpper(e.target.value)}
                      disabled={loading}
                      className="range-input"
                    />
                  </div>
                  <label className="text-secondary" style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={moveRangeSwap}
                      onChange={(e) => setMoveRangeSwap(e.target.checked)}
                      disabled={loading}
                    />
                    Auto-swap tokens
                  </label>
                  <button
                    onClick={handleMoveRange}
                    disabled={loading || !tickLower || !tickUpper}
                    className="btn-outline"
                    style={{ width: '100%' }}
                  >
                    {loading && operationType === 'moveRange' ? 'Processing...' : 'Move Range'}
                  </button>
                </div>
              </div>

              {/* Compound */}
              <div className="glass-card" style={{ padding: '1.5rem' }}>
                <h4 style={{ marginBottom: '1rem' }}>Compound Fees</h4>
                <div className="form-group">
                  <label className="text-secondary" style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <input
                      type="checkbox"
                      checked={compoundSwap}
                      onChange={(e) => setCompoundSwap(e.target.checked)}
                      disabled={loading}
                    />
                    Auto-swap for optimal ratio
                  </label>
                  <button
                    onClick={handleCompound}
                    disabled={loading}
                    className="btn-primary"
                    style={{ width: '100%' }}
                  >
                    {loading && operationType === 'compound' ? 'Processing...' : 'Compound'}
                  </button>
                </div>
              </div>

              {/* Close Position */}
              <div className="glass-card" style={{ padding: '1.5rem', borderColor: 'var(--accent-danger)' }}>
                <h4 className="text-danger" style={{ marginBottom: '1rem' }}>Close Position</h4>
                <div className="form-group">
                  <input
                    type="text"
                    placeholder="Total Liquidity Amount"
                    value={closeLiquidity}
                    onChange={(e) => setCloseLiquidity(e.target.value)}
                    disabled={loading}
                    className="range-input"
                  />
                  <button
                    onClick={handleClosePosition}
                    disabled={loading || !closeLiquidity}
                    className="btn-outline"
                    style={{ width: '100%', color: 'var(--accent-danger)', borderColor: 'var(--accent-danger)' }}
                  >
                    {loading && operationType === 'close' ? 'Processing...' : 'Close Position'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
            <div className="section fade-in-content">
              <PositionTimeline positionId={position.positionId} />
            </div>
          )}

          {/* Transactions Tab */}
          {activeTab === 'transactions' && (
            <div className="section fade-in-content">
              {transactions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📭</div>
                  <p>No transactions found</p>
                </div>
              ) : (
                <div className="transactions-list">
                  {transactions.map((tx) => (
                    <div key={tx.id} className={`transaction-item ${tx.status.toLowerCase()}`}>
                      <div className="tx-header">
                        <span className="tx-type">{tx.type}</span>
                        <span className={`badge ${tx.status === 'SUCCESS' ? 'badge-success' : tx.status === 'PENDING' ? 'badge-warning' : 'badge-danger'}`}>
                            {tx.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {tx.txHash && explorerUrl && (
                            <a
                            href={`${explorerUrl}/tx/${tx.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tx-hash font-mono"
                            >
                            {tx.txHash}
                            </a>
                        )}
                        <span className="text-secondary" style={{ fontSize: '0.8rem' }}>
                            {new Date(tx.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
