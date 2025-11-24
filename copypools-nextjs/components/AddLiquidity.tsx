'use client'

import { useState, useEffect } from 'react'
import { ContractService } from '@/lib/services/contracts'
import { useWallet } from '@/lib/hooks/useWallet'
import { parseUnits, formatUnits } from 'ethers'
import { apiService } from '@/lib/services/api'

// Token pair presets
const TOKEN_PAIRS = [
  {
    name: 'WETH/USDC',
    token0: '0x8B86719bEeCd8004569F429549177B9B25c6555a',
    token1: '0xbaa74e10F7edbC3FCDA7508C27A8F5599d79b09c',
    symbol0: 'WETH',
    symbol1: 'USDC',
    decimals0: 18,
    decimals1: 6
  }
]

const FEE_OPTIONS = [
  { value: '500', label: '0.05%', description: 'Best for stable pairs' },
  { value: '3000', label: '0.3%', description: 'Best for most pairs' },
  { value: '10000', label: '1%', description: 'Best for exotic pairs' },
]

// Tick values must be aligned to tick spacing (60 for 0.3% fee tier)
// Tick spacing 60 requires ticks divisible by 60
const PRICE_RANGE_PRESETS = [
  { label: 'Full Range', tickLower: '-887220', tickUpper: '887220', description: 'Maximum liquidity, lower fees' },
  { label: 'Wide Range', tickLower: '-200040', tickUpper: '200040', description: 'Good balance' },
  { label: 'Medium Range', tickLower: '-100020', tickUpper: '100020', description: 'More concentrated' },
  { label: 'Narrow Range', tickLower: '-50040', tickUpper: '50040', description: 'Maximum efficiency' },
  { label: 'Custom', tickLower: '', tickUpper: '', description: 'Set your own range' },
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
        parseInt(tickLower),
        parseInt(tickUpper),
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
          <h2>Create New Position</h2>
          <p className="create-subtitle">Provide liquidity to earn trading fees</p>
        </div>
      )}

      <div className="create-position-content">
        {/* Token Pair Selection */}
        <div className="create-section">
          <div className="section-header">
            <h3>Select Token Pair</h3>
          </div>
          <div className="token-pair-selector">
            <div className="pair-card active">
              <div className="pair-tokens">
                <div className="token-display">
                  <div className="token-avatar-large">{token0Info?.symbol?.[0] || 'T'}</div>
                  <div className="token-info">
                    <div className="token-symbol">{token0Info?.symbol || 'Token 0'}</div>
                    <div className="token-address-small">{formatAddress(token0)}</div>
                  </div>
                </div>
                <div className="pair-divider">/</div>
                <div className="token-display">
                  <div className="token-avatar-large">{token1Info?.symbol?.[0] || 'T'}</div>
                  <div className="token-info">
                    <div className="token-symbol">{token1Info?.symbol || 'Token 1'}</div>
                    <div className="token-address-small">{formatAddress(token1)}</div>
                  </div>
                </div>
              </div>
              {address && (
                <div className="token-balances-display">
                  <div className="balance-item">
                    <span className="balance-label">Balance:</span>
                    <span className="balance-value">{balance0 || '0.00'} {token0Info?.symbol}</span>
                  </div>
                  <div className="balance-item">
                    <span className="balance-label">Balance:</span>
                    <span className="balance-value">{balance1 || '0.00'} {token1Info?.symbol}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Amount Input */}
        <div className="create-section">
          <div className="section-header">
            <h3>Deposit Amounts</h3>
          </div>
          <div className="amount-inputs">
            <div className="amount-input-card">
              <div className="amount-input-header">
                <div className="token-selector-display">
                  <div className="token-avatar-small">{token0Info?.symbol?.[0] || 'T'}</div>
                  <span className="token-symbol-small">{token0Info?.symbol || 'Token 0'}</span>
                </div>
                {address && (
                  <button
                    type="button"
                    onClick={() => handleMax(0)}
                    className="max-button"
                    disabled={loading}
                  >
                    MAX
                  </button>
                )}
              </div>
              <input
                type="number"
                step="any"
                placeholder="0.0"
                value={amount0}
                onChange={(e) => setAmount0(e.target.value)}
                disabled={loading || !address}
                className="amount-input"
              />
              {address && balance0 && (
                <div className="balance-hint">
                  Balance: {parseFloat(balance0).toLocaleString()} {token0Info?.symbol}
                </div>
              )}
            </div>

            <div className="amount-input-card">
              <div className="amount-input-header">
                <div className="token-selector-display">
                  <div className="token-avatar-small">{token1Info?.symbol?.[0] || 'T'}</div>
                  <span className="token-symbol-small">{token1Info?.symbol || 'Token 1'}</span>
                </div>
                {address && (
                  <button
                    type="button"
                    onClick={() => handleMax(1)}
                    className="max-button"
                    disabled={loading}
                  >
                    MAX
                  </button>
                )}
              </div>
              <input
                type="number"
                step="any"
                placeholder="0.0"
                value={amount1}
                onChange={(e) => setAmount1(e.target.value)}
                disabled={loading || !address}
                className="amount-input"
              />
              {address && balance1 && (
                <div className="balance-hint">
                  Balance: {parseFloat(balance1).toLocaleString()} {token1Info?.symbol}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fee Tier */}
        <div className="create-section">
          <div className="section-header">
            <h3>Fee Tier</h3>
            <p className="section-description">Select the fee tier for this pool</p>
          </div>
          <div className="fee-tier-selector">
            {FEE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFee(option.value)}
                disabled={loading}
                className={`fee-option ${fee === option.value ? 'active' : ''}`}
              >
                <div className="fee-option-content">
                  <div className="fee-label">{option.label}</div>
                  <div className="fee-description">{option.description}</div>
                </div>
                {fee === option.value && <div className="fee-check">✓</div>}
              </button>
            ))}
          </div>
        </div>

        {/* Price Range */}
        <div className="create-section">
          <div className="section-header">
            <h3>Price Range</h3>
            <p className="section-description">Set the price range for your liquidity position</p>
          </div>
          <div className="range-presets">
            {PRICE_RANGE_PRESETS.map((preset, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleRangePreset(index)}
                disabled={loading}
                className={`range-preset ${selectedRangePreset === index ? 'active' : ''}`}
              >
                <div className="preset-label">{preset.label}</div>
                <div className="preset-description">{preset.description}</div>
              </button>
            ))}
          </div>
          <div className="range-inputs">
            <div className="range-input-group">
              <label>Tick Lower</label>
              <input
                type="number"
                placeholder="-887220"
                value={tickLower}
                onChange={(e) => {
                  setTickLower(e.target.value)
                  setSelectedRangePreset(PRICE_RANGE_PRESETS.length - 1) // Custom
                }}
                disabled={loading}
                className="range-input"
              />
            </div>
            <div className="range-input-group">
              <label>Tick Upper</label>
              <input
                type="number"
                placeholder="887220"
                value={tickUpper}
                onChange={(e) => {
                  setTickUpper(e.target.value)
                  setSelectedRangePreset(PRICE_RANGE_PRESETS.length - 1) // Custom
                }}
                disabled={loading}
                className="range-input"
              />
            </div>
          </div>
        </div>

        {/* Status Messages */}
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

        {/* Action Button */}
        <div className="create-action">
          {!address ? (
            <div className="wallet-prompt">
              <p>Please connect your wallet to create a position</p>
            </div>
          ) : (
            <button
              onClick={handleAddLiquidity}
              disabled={loading || !amount0 || !amount1}
              className="create-button"
            >
              {loading ? (
                <>
                  <span className="button-spinner">⏳</span>
                  {step || 'Processing...'}
                </>
              ) : (
                'Create Position'
              )}
            </button>
          )}
        </div>

        {/* Info Box */}
        <div className="info-card">
          <div className="info-header">
            <span className="info-icon">ℹ️</span>
            <h4>Important Information</h4>
          </div>
          <ul className="info-list">
            <li>Ensure you have sufficient balance of both tokens</li>
            <li>Token approvals will be handled automatically</li>
            <li>Full range provides maximum liquidity coverage</li>
            <li>Narrower ranges offer higher capital efficiency</li>
            <li>Recommended fee tier: 0.05% for stable pairs</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
