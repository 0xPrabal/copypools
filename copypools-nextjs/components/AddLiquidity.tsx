'use client'

import { useState, useEffect } from 'react'
import { ContractService } from '@/lib/services/contracts'
import { useWallet } from '@/lib/hooks/useWallet'
import { parseUnits, formatUnits } from 'ethers'

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

export const AddLiquidity = () => {
  const { provider, address } = useWallet()

  // Form state
  const [selectedPair, setSelectedPair] = useState(0)
  const [token0, setToken0] = useState(TOKEN_PAIRS[0].token0)
  const [token1, setToken1] = useState(TOKEN_PAIRS[0].token1)
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [tickLower, setTickLower] = useState('-887220')
  const [tickUpper, setTickUpper] = useState('887220')
  const [fee, setFee] = useState('500')

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
      alert('Please connect your wallet')
      return
    }

    if (!token0 || !token1 || !amount0 || !amount1) {
      alert('Please fill in all fields')
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

      setSuccess(`Liquidity added successfully! Transaction: ${receipt.hash}`)
      setStep('')

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

  const feeOptions = [
    { value: '500', label: '0.05%' },
    { value: '3000', label: '0.3%' },
    { value: '10000', label: '1%' },
  ]

  return (
    <div className="add-liquidity">
      <h2>Add Liquidity (Create Position)</h2>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      {step && <div className="info-message">{step}</div>}

      <div className="form-section">
        <h3>Token Pair</h3>

        <div className="form-group">
          <label>Select Trading Pair</label>
          <select
            value={selectedPair}
            onChange={(e) => handlePairChange(Number(e.target.value))}
            disabled={loading}
            className="pair-selector"
          >
            {TOKEN_PAIRS.map((pair, index) => (
              <option key={index} value={index}>
                {pair.name} ({pair.symbol0}/{pair.symbol1})
              </option>
            ))}
          </select>
        </div>

        <div className="token-balances">
          {token0Info && (
            <div className="token-balance-item">
              <strong>{token0Info.symbol}:</strong> Balance: {balance0 || '0'}
            </div>
          )}
          {token1Info && (
            <div className="token-balance-item">
              <strong>{token1Info.symbol}:</strong> Balance: {balance1 || '0'}
            </div>
          )}
        </div>
      </div>

      <div className="form-section">
        <h3>Amounts</h3>

        <div className="form-group">
          <label>Amount Token 0</label>
          <input
            type="number"
            step="any"
            placeholder="0.0"
            value={amount0}
            onChange={(e) => setAmount0(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label>Amount Token 1</label>
          <input
            type="number"
            step="any"
            placeholder="0.0"
            value={amount1}
            onChange={(e) => setAmount1(e.target.value)}
            disabled={loading}
          />
        </div>
      </div>

      <div className="form-section">
        <h3>Price Range</h3>

        <div className="form-group">
          <label>Tick Lower</label>
          <input
            type="number"
            placeholder="-887220"
            value={tickLower}
            onChange={(e) => setTickLower(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label>Tick Upper</label>
          <input
            type="number"
            placeholder="887220"
            value={tickUpper}
            onChange={(e) => setTickUpper(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label>Fee Tier</label>
          <select value={fee} onChange={(e) => setFee(e.target.value)} disabled={loading}>
            {feeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-section">
        <button
          onClick={handleAddLiquidity}
          disabled={loading || !address || !token0 || !token1 || !amount0 || !amount1}
          className="submit-button"
        >
          {loading ? step || 'Processing...' : 'Add Liquidity'}
        </button>

        {!address && (
          <p className="warning-text">Please connect your wallet to add liquidity</p>
        )}
      </div>

      <div className="info-box">
        <h4>ℹ️ Important Notes</h4>
        <ul>
          <li>Make sure you have both tokens in your wallet</li>
          <li>Tokens will be automatically approved if needed</li>
          <li>Slippage protection disabled (0%) - pool price determines actual ratio</li>
          <li>Full range: Tick Lower = -887220, Tick Upper = 887220</li>
          <li>Concentrated range: Use narrower tick ranges for better capital efficiency</li>
          <li>Use fee tier 0.05% (500) - this pool is initialized and tested</li>
        </ul>
      </div>
    </div>
  )
}
