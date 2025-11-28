'use client'

import { useState, useEffect } from 'react'
import { ContractService } from '@/lib/services/contracts'
import { useWallet } from '@/lib/hooks'
import { parseUnits, formatUnits } from 'ethers'
import { apiService } from '@/lib/services/api'

// Token pair presets
// WORKING TOKEN ADDRESSES - These have balance and pool is initialized!
const TOKEN_PAIRS = [
  {
    name: 'WETH/USDC',
    token0: '0x8B86719bEeCd8004569F429549177B9B25c6555a', // WETH with balance
    token1: '0xbaa74e10F7edbC3FCDA7508C27A8F5599d79b09c', // USDC with balance
    symbol0: 'WETH',
    symbol1: 'USDC',
    decimals0: 18,
    decimals1: 6
  }
]

const FEE_OPTIONS = [
  { value: '500', label: '0.05%', description: 'Best for stable pairs', badge: 'Stable' },
  { value: '3000', label: '0.3%', description: 'Best for most pairs', badge: 'Standard' },
  { value: '10000', label: '1%', description: 'Best for exotic pairs', badge: 'Exotic' },
]

// Tick values must be aligned to tick spacing (60 for 0.3% fee tier)
// Tick spacing 60 requires ticks divisible by 60
const PRICE_RANGE_PRESETS = [
  { label: 'Full Range', tickLower: '-887220', tickUpper: '887220', description: 'Passive strategy', icon: '🌊' },
  { label: 'Wide Range', tickLower: '-200040', tickUpper: '200040', description: 'Balanced exposure', icon: '⚖️' },
  { label: 'Concentrated', tickLower: '-50040', tickUpper: '50040', description: 'Active management', icon: '🎯' },
  { label: 'Custom', tickLower: '', tickUpper: '', description: 'Manual setup', icon: '🔧' },
]

interface AddLiquidityProps {
  preSelectedPool?: {
    token0: string
    token1: string
    feeTier: string
  }
  onSuccess?: () => void
}

export const AddLiquidity = (props: AddLiquidityProps = {}) => {
  const { preSelectedPool, onSuccess } = props
  const { provider, address } = useWallet()

  // Form state
  const [selectedPair, setSelectedPair] = useState(0)
  const [token0, setToken0] = useState(preSelectedPool?.token0 || TOKEN_PAIRS[0].token0)
  const [token1, setToken1] = useState(preSelectedPool?.token1 || TOKEN_PAIRS[0].token1)
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [tickLower, setTickLower] = useState('-887220')
  const [tickUpper, setTickUpper] = useState('887220')
  const [fee, setFee] = useState(
    preSelectedPool?.feeTier === '0.05%' ? '500' :
    preSelectedPool?.feeTier === '0.3%' ? '3000' :
    preSelectedPool?.feeTier === '1%' ? '10000' : '500'
  )
  const [selectedRangePreset, setSelectedRangePreset] = useState(0)

  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [step, setStep] = useState<string>('')

  // Token info
  const [token0Info, setToken0Info] = useState<any>(null)
  const [token1Info, setToken1Info] = useState<any>(null)
  const [balance0, setBalance0] = useState<string>('')
  const [balance1, setBalance1] = useState<string>('')

  const loadTokenInfo = async (tokenAddress: string, setInfo: Function, setBalance: Function) => {
    if (!provider || !address || !tokenAddress) return

    try {
      const contractService = new ContractService(provider)
      const info = await contractService.getTokenInfo(tokenAddress)
      const balance = await contractService.getTokenBalance(tokenAddress, address)

      setInfo(info)
      setBalance(formatUnits(balance, info.decimals))
    } catch (err) {
      console.error('Error loading token info:', err)
    }
  }

  const handlePairChange = (index: number) => {
    setSelectedPair(index)
    const pair = TOKEN_PAIRS[index]
    setToken0(pair.token0)
    setToken1(pair.token1)
    setToken0Info({ name: pair.name, symbol: pair.symbol0, decimals: pair.decimals0 })
    setToken1Info({ name: pair.name, symbol: pair.symbol1, decimals: pair.decimals1 })
    // Load balances
    if (provider && address) {
      loadTokenInfo(pair.token0, setToken0Info, setBalance0)
      loadTokenInfo(pair.token1, setToken1Info, setBalance1)
    }
  }

  const handleRangePreset = (index: number) => {
    setSelectedRangePreset(index)
    const preset = PRICE_RANGE_PRESETS[index]
    if (preset.tickLower && preset.tickUpper) {
      setTickLower(preset.tickLower)
      setTickUpper(preset.tickUpper)
    }
  }

  // Load token info on mount
  useEffect(() => {
    if (provider && address) {
      const pair = TOKEN_PAIRS[selectedPair]
      loadTokenInfo(pair.token0, setToken0Info, setBalance0)
      loadTokenInfo(pair.token1, setToken1Info, setBalance1)
    }
  }, [provider, address, selectedPair])

  const handleAddLiquidity = async () => {
    if (!provider || !address) {
      setError('Please connect your wallet')
      return
    }

    if (!token0 || !token1 || !amount0 || !amount1) {
      setError('Please fill in all fields')
      return
    }

    if (!tickLower || !tickUpper || !fee) {
      setError('Please set price range and fee tier')
      return
    }

    // Validate tick values
    const tickLowerNum = parseInt(tickLower)
    const tickUpperNum = parseInt(tickUpper)
    if (isNaN(tickLowerNum) || isNaN(tickUpperNum)) {
      setError('Invalid tick range values')
      return
    }

    if (tickLowerNum >= tickUpperNum) {
      setError('Tick lower must be less than tick upper')
      return
    }

    try {
      setLoading(true)
      setError(null)
      setSuccess(null)
      setStep('Preparing transaction...')

      const contractService = new ContractService(provider)

      // Get decimals
      const decimals0 = token0Info?.decimals || 18
      const decimals1 = token1Info?.decimals || 18

      const amount0Wei = parseUnits(amount0, decimals0)
      const amount1Wei = parseUnits(amount1, decimals1)

      setStep('Checking balances and approvals...')

      const receipt = await contractService.addLiquidity(
        token0,
        token1,
        amount0Wei,
        amount1Wei,
        tickLowerNum,
        tickUpperNum,
        parseInt(fee)
      )

      setSuccess(`✅ Position created successfully! Transaction: ${receipt.hash}`)
      setStep('Waiting for Ponder indexer to process your position...')

      // Position will be automatically indexed by Ponder indexer
      // Wait 30 seconds for Ponder to index, then refresh the positions list
      if (onSuccess) {
        setTimeout(() => {
          setStep('Refreshing positions list...')
          onSuccess()
          setStep('')
          setSuccess(`✅ Position created and indexed! Transaction: ${receipt.hash}`)
        }, 30000) // 30 seconds delay for Ponder to index
      } else {
        setStep('')
      }

      // Reset form
      setAmount0('')
      setAmount1('')
    } catch (err: any) {
      setError(err.message || 'Failed to add liquidity')
      setStep('')
      console.error('Add liquidity error:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
  }

  const handleMax = (tokenIndex: 0 | 1) => {
    if (tokenIndex === 0 && balance0) {
      setAmount0(balance0)
    } else if (tokenIndex === 1 && balance1) {
      setAmount1(balance1)
    }
  }

  return (
    <div className="create-position">
      {!preSelectedPool && (
        <div className="create-position-header">
          <h2 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Create Position</h2>
          <p className="create-subtitle">Provide liquidity to Uniswap V4 pools and earn fees.</p>
        </div>
      )}

      <div className="create-position-content">
        {/* Token Pair Selection - Glass Card */}
        <div className="glass-card" style={{ padding: '2rem' }}>
          <div className="section-header" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Select Pair</h3>
            <p className="text-secondary">Choose tokens to deposit liquidity</p>
          </div>
          
          <div className="token-pair-selector">
            <div className="pair-card active" style={{ 
              background: 'rgba(139, 92, 246, 0.05)', 
              borderColor: 'var(--accent-primary)',
              boxShadow: '0 0 20px rgba(139, 92, 246, 0.1)' 
            }}>
              <div className="pair-tokens">
                <div className="token-display">
                  <div className="token-avatar-img" style={{ width: '48px', height: '48px', fontSize: '1rem' }}>
                    {token0Info?.symbol?.[0] || 'T'}
                  </div>
                  <div className="token-info">
                    <div className="token-symbol" style={{ fontSize: '1.2rem' }}>{token0Info?.symbol || 'Token 0'}</div>
                    <div className="font-mono text-secondary" style={{ fontSize: '0.8rem' }}>{formatAddress(token0)}</div>
                  </div>
                </div>
                <div className="pair-divider" style={{ margin: '0 1rem', opacity: 0.3 }}>/</div>
                <div className="token-display">
                  <div className="token-avatar-img" style={{ width: '48px', height: '48px', fontSize: '1rem' }}>
                    {token1Info?.symbol?.[0] || 'T'}
                  </div>
                  <div className="token-info">
                    <div className="token-symbol" style={{ fontSize: '1.2rem' }}>{token1Info?.symbol || 'Token 1'}</div>
                    <div className="font-mono text-secondary" style={{ fontSize: '0.8rem' }}>{formatAddress(token1)}</div>
                  </div>
                </div>
              </div>
              
              {address && (
                <div className="token-balances-display" style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <div className="balance-item">
                    <span className="balance-label">Available</span>
                    <span className="font-mono text-primary">{parseFloat(balance0 || '0').toFixed(4)} {token0Info?.symbol}</span>
                  </div>
                  <div className="balance-item">
                    <span className="balance-label">Available</span>
                    <span className="font-mono text-primary">{parseFloat(balance1 || '0').toFixed(4)} {token1Info?.symbol}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Amount Input */}
        <div className="glass-card" style={{ padding: '2rem' }}>
          <div className="section-header" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Deposit Amounts</h3>
            <p className="text-secondary">Enter amounts to provide</p>
          </div>
          <div className="amount-inputs">
            {[
              { 
                token: token0Info, 
                amount: amount0, 
                setAmount: setAmount0, 
                balance: balance0,
                idx: 0
              },
              { 
                token: token1Info, 
                amount: amount1, 
                setAmount: setAmount1, 
                balance: balance1,
                idx: 1
              }
            ].map((item, i) => (
              <div key={i} className="amount-input-card" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="amount-input-header">
                  <div className="token-selector-display">
                    <div className="token-avatar-img" style={{ width: '24px', height: '24px', fontSize: '0.6rem' }}>
                      {item.token?.symbol?.[0] || 'T'}
                    </div>
                    <span className="token-symbol-small">{item.token?.symbol}</span>
                  </div>
                  {address && (
                    <button
                      type="button"
                      onClick={() => handleMax(item.idx as 0 | 1)}
                      className="badge badge-primary"
                      style={{ cursor: 'pointer', border: 'none' }}
                      disabled={loading}
                    >
                      MAX
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={item.amount}
                  onChange={(e) => item.setAmount(e.target.value)}
                  disabled={loading || !address}
                  className="amount-input font-mono"
                  style={{ fontSize: '1.75rem', marginTop: '0.5rem' }}
                />
                {address && (
                  <div className="balance-hint font-mono" style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                    ~${(parseFloat(item.amount || '0') * 1).toFixed(2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Configuration Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          {/* Fee Tier */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <div className="section-header" style={{ marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem' }}>Fee Tier</h3>
            </div>
            <div className="fee-tier-selector">
              {FEE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFee(option.value)}
                  disabled={loading}
                  className={`fee-option ${fee === option.value ? 'active' : ''}`}
                  style={{ padding: '0.75rem', border: fee === option.value ? '1px solid var(--accent-primary)' : '1px solid transparent' }}
                >
                  <div className="fee-option-content">
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span className="fee-label font-mono">{option.label}</span>
                      <span className="badge" style={{ fontSize: '0.6rem' }}>{option.badge}</span>
                    </div>
                    <div className="fee-description" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>{option.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Price Range */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <div className="section-header" style={{ marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem' }}>Price Range</h3>
            </div>
            <div className="range-presets" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {PRICE_RANGE_PRESETS.map((preset, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleRangePreset(index)}
                  disabled={loading}
                  className={`range-preset ${selectedRangePreset === index ? 'active' : ''}`}
                  style={{ 
                    padding: '0.75rem', 
                    textAlign: 'left',
                    background: selectedRangePreset === index ? 'rgba(139, 92, 246, 0.1)' : 'rgba(255,255,255,0.03)',
                    border: selectedRangePreset === index ? '1px solid var(--accent-primary)' : '1px solid transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>{preset.icon}</span>
                    <span className="preset-label" style={{ fontSize: '0.9rem' }}>{preset.label}</span>
                  </div>
                </button>
              ))}
            </div>
            
            <div className="range-inputs" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
               <div style={{ flex: 1 }}>
                  <label className="text-secondary" style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Min Tick</label>
                  <input
                    type="number"
                    value={tickLower}
                    onChange={(e) => { setTickLower(e.target.value); setSelectedRangePreset(3); }}
                    className="range-input font-mono"
                    style={{ fontSize: '0.9rem', padding: '0.5rem' }}
                  />
               </div>
               <div style={{ flex: 1 }}>
                  <label className="text-secondary" style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' }}>Max Tick</label>
                  <input
                    type="number"
                    value={tickUpper}
                    onChange={(e) => { setTickUpper(e.target.value); setSelectedRangePreset(3); }}
                    className="range-input font-mono"
                    style={{ fontSize: '0.9rem', padding: '0.5rem' }}
                  />
               </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ minHeight: '60px' }}>
          {error && (
            <div className="status-message error">
              <span className="status-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="status-message success">
              <span className="status-icon">✓</span>
              <span>{success}</span>
            </div>
          )}
          {step && (
            <div className="status-message info">
              <span className="status-icon">⏳</span>
              <span>{step}</span>
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="create-action">
          {!address ? (
            <div className="wallet-prompt glass-card">
              <p>Please connect your wallet to create a position</p>
            </div>
          ) : (
            <button
              onClick={handleAddLiquidity}
              disabled={loading || !amount0 || !amount1}
              className="btn-gradient"
              style={{ width: '100%', padding: '1.25rem', fontSize: '1.1rem' }}
            >
              {loading ? (
                <>
                  <span className="button-spinner">⏳</span>
                  {step || 'Processing transaction...'}
                </>
              ) : (
                'Create Liquidity Position'
              )}
            </button>
          )}
        </div>

        {/* Info Box */}
        <div className="info-card">
          <div className="info-header">
            <span className="info-icon">💡</span>
            <h4>Pro Tips</h4>
          </div>
          <ul className="info-list">
            <li>Ensure you have sufficient balance of both tokens for gas and deposit.</li>
            <li>Token approvals will be handled automatically before the deposit.</li>
            <li>Full range provides passive fees but lower efficiency. Concentrated liquidity earns more but requires management.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
