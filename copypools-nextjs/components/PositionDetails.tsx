'use client'

import { useState, useEffect } from 'react'
import { parseUnits } from 'ethers'
import { Position, Transaction } from '@/lib/types'
import { apiService } from '@/lib/services/api'
import { ContractService } from '@/lib/services/contracts'
import { useWallet } from '@/lib/hooks/useWallet'
import { EXPLORER_URLS } from '@/lib/config/constants'
import { PositionTimeline } from './PositionTimeline'

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

  // Helper function to get tick spacing for fee tier
  const getTickSpacing = (fee: number): number => {
    if (fee === 100) return 1
    if (fee === 500) return 10
    if (fee === 3000) return 60
    if (fee === 10000) return 200
    return 60 // Default to 3000 fee tier
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

    try {
      setLoading(true)
      setError(null)
      setOperationType('moveRange')

      // Align ticks to tick spacing (fee 3000 = spacing 60)
      // TODO: Query actual fee from adapter position
      const tickSpacing = 60 // Fee tier 3000
      const inputTickLower = parseInt(tickLower)
      const inputTickUpper = parseInt(tickUpper)

      const alignedTickLower = alignTickToSpacing(inputTickLower, tickSpacing)
      const alignedTickUpper = alignTickToSpacing(inputTickUpper, tickSpacing)

      // Warn user if ticks were adjusted
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

    try {
      setLoading(true)
      setError(null)
      setOperationType('increase')

      const contractService = new ContractService(provider)

      // Parse amounts with proper decimals (assuming 18 for WETH, 6 for USDC)
      const amount0 = parseUnits(increaseAmount0, 18)
      const amount1 = parseUnits(increaseAmount1, 6)

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

  const handleSyncPosition = async () => {
    try {
      setSyncing(true)
      setError(null)
      await apiService.syncPosition(position.positionId)
      // Refresh position data
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
          <h2>Position #{position.positionId}</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="modal-body">
          {/* Position Info */}
          <div className="section">
            <div className="section-header-with-action">
              <h3>Position Information</h3>
              <button
                onClick={handleSyncPosition}
                disabled={syncing}
                className="sync-button"
                title="Sync position data from blockchain"
              >
                {syncing ? '⏳ Syncing...' : '🔄 Sync'}
              </button>
            </div>
            <div className="info-grid">
              <div><strong>Protocol:</strong> {position.protocol}</div>
              <div><strong>Status:</strong> {position.active ? '✅ Active' : '❌ Inactive'}</div>
              <div><strong>Owner:</strong> {position.owner}</div>
              <div><strong>DEX Token ID:</strong> {position.dexTokenId}</div>
              <div><strong>Token0:</strong> {position.token0}</div>
              <div><strong>Token1:</strong> {position.token1}</div>
              {position.tickLower !== undefined && (
                <>
                  <div><strong>Tick Lower:</strong> {position.tickLower}</div>
                  <div><strong>Tick Upper:</strong> {position.tickUpper}</div>
                </>
              )}
              {position.liquidity && (
                <div><strong>Liquidity:</strong> {position.liquidity}</div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="position-tabs">
            <button
              className={`position-tab ${activeTab === 'operations' ? 'active' : ''}`}
              onClick={() => setActiveTab('operations')}
            >
              Operations
            </button>
            <button
              className={`position-tab ${activeTab === 'timeline' ? 'active' : ''}`}
              onClick={() => setActiveTab('timeline')}
            >
              Timeline
            </button>
            <button
              className={`position-tab ${activeTab === 'transactions' ? 'active' : ''}`}
              onClick={() => setActiveTab('transactions')}
            >
              Transactions
            </button>
          </div>

          {/* Operations Tab */}
          {activeTab === 'operations' && position.active && address && (
            <div className="section operations">
              <h3>Operations</h3>

              {error && <div className="error-message">{error}</div>}

              {/* Increase Liquidity */}
              <div className="operation-card">
                <h4>Increase Liquidity</h4>
                <div className="form-group">
                  <input
                    type="number"
                    step="any"
                    placeholder="Amount Token0 (WETH)"
                    value={increaseAmount0}
                    onChange={(e) => setIncreaseAmount0(e.target.value)}
                    disabled={loading}
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Amount Token1 (USDC)"
                    value={increaseAmount1}
                    onChange={(e) => setIncreaseAmount1(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    onClick={handleIncreaseLiquidity}
                    disabled={loading || !increaseAmount0 || !increaseAmount1}
                    className="operation-button"
                  >
                    {loading && operationType === 'increase' ? 'Processing...' : 'Increase Liquidity'}
                  </button>
                </div>
              </div>

              {/* Collect Fees */}
              <div className="operation-card">
                <h4>Collect Fees</h4>
                <div className="form-group">
                  <p>Collect accumulated trading fees from this position.</p>
                  <button
                    onClick={handleCollectFees}
                    disabled={loading}
                    className="operation-button"
                  >
                    {loading && operationType === 'collectFees' ? 'Processing...' : 'Collect Fees'}
                  </button>
                </div>
              </div>

              {/* Decrease Liquidity */}
              <div className="operation-card">
                <h4>Decrease Liquidity</h4>
                <div className="form-group">
                  <input
                    type="text"
                    placeholder="Liquidity Amount to Remove"
                    value={decreaseLiquidityAmount}
                    onChange={(e) => setDecreaseLiquidityAmount(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    onClick={handleDecreaseLiquidity}
                    disabled={loading || !decreaseLiquidityAmount}
                    className="operation-button"
                  >
                    {loading && operationType === 'decrease' ? 'Processing...' : 'Decrease Liquidity'}
                  </button>
                </div>
              </div>

              {/* Move Range */}
              <div className="operation-card">
                <h4>Move Range</h4>
                <div className="form-group">
                  <input
                    type="number"
                    placeholder="New Tick Lower"
                    value={tickLower}
                    onChange={(e) => setTickLower(e.target.value)}
                    disabled={loading}
                  />
                  <input
                    type="number"
                    placeholder="New Tick Upper"
                    value={tickUpper}
                    onChange={(e) => setTickUpper(e.target.value)}
                    disabled={loading}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={moveRangeSwap}
                      onChange={(e) => setMoveRangeSwap(e.target.checked)}
                      disabled={loading}
                    />
                    Swap for optimal ratio
                  </label>
                  <button
                    onClick={handleMoveRange}
                    disabled={loading || !tickLower || !tickUpper}
                    className="operation-button"
                  >
                    {loading && operationType === 'moveRange' ? 'Processing...' : 'Move Range'}
                  </button>
                </div>
              </div>

              {/* Compound */}
              <div className="operation-card">
                <h4>Compound Fees</h4>
                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={compoundSwap}
                      onChange={(e) => setCompoundSwap(e.target.checked)}
                      disabled={loading}
                    />
                    Swap for optimal ratio
                  </label>
                  <button
                    onClick={handleCompound}
                    disabled={loading}
                    className="operation-button"
                  >
                    {loading && operationType === 'compound' ? 'Processing...' : 'Compound'}
                  </button>
                </div>
              </div>

              {/* Burn Position */}
              <div className="operation-card danger">
                <h4>Burn Position (Remove ALL Liquidity)</h4>
                <div className="form-group">
                  <p>This will remove ALL liquidity and close the position permanently.</p>
                  <button
                    onClick={handleBurnPosition}
                    disabled={loading}
                    className="operation-button danger"
                  >
                    {loading && operationType === 'burn' ? 'Processing...' : 'Burn Position'}
                  </button>
                </div>
              </div>

              {/* Close Position */}
              <div className="operation-card danger">
                <h4>Close Position</h4>
                <div className="form-group">
                  <input
                    type="text"
                    placeholder="Liquidity Amount"
                    value={closeLiquidity}
                    onChange={(e) => setCloseLiquidity(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    onClick={handleClosePosition}
                    disabled={loading || !closeLiquidity}
                    className="operation-button danger"
                  >
                    {loading && operationType === 'close' ? 'Processing...' : 'Close Position'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Timeline Tab */}
          {activeTab === 'timeline' && (
            <div className="section">
              <PositionTimeline positionId={position.positionId} />
            </div>
          )}

          {/* Transactions Tab */}
          {activeTab === 'transactions' && (
            <div className="section">
              <h3>Transaction History</h3>
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
                        <span className={`tx-status ${tx.status.toLowerCase()}`}>{tx.status}</span>
                      </div>
                      {tx.txHash && explorerUrl && (
                        <a
                          href={`${explorerUrl}/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tx-hash"
                        >
                          {tx.txHash.substring(0, 10)}...{tx.txHash.substring(tx.txHash.length - 8)}
                        </a>
                      )}
                      {tx.blockNumber && <div>Block: {tx.blockNumber}</div>}
                      {tx.gasUsed && <div>Gas: {tx.gasUsed}</div>}
                      {tx.errorMessage && <div className="error-message">{tx.errorMessage}</div>}
                      <div className="tx-date">{new Date(tx.createdAt).toLocaleString()}</div>
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
