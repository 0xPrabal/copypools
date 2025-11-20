'use client'

import { useWallet } from '@/lib/hooks/useWallet'
import { CHAIN_NAMES } from '@/lib/config/constants'

export const WalletConnect = () => {
  const { address, chainId, isConnected, isConnecting, connect, disconnect } = useWallet()

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
  }

  return (
    <div className="wallet-connect">
      {!isConnected ? (
        <button
          onClick={connect}
          disabled={isConnecting}
          className="connect-button"
        >
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      ) : (
        <div className="wallet-info">
          <div className="network-badge">
            {chainId && CHAIN_NAMES[chainId]}
          </div>
          <div className="address-badge">
            {address && formatAddress(address)}
          </div>
          <button onClick={disconnect} className="disconnect-button">
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
