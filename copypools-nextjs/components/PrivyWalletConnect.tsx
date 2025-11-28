'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { CHAIN_NAMES } from '@/lib/config/constants'

export const PrivyWalletConnect = () => {
  const { ready, authenticated, login, logout, user } = usePrivy()
  const { wallets } = useWallets()

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
  }

  // Get the primary wallet
  const wallet = wallets[0]
  const address = wallet?.address
  const chainId = wallet?.chainId ? parseInt(wallet.chainId.replace('eip155:', '')) : null

  if (!ready) {
    return (
      <div className="wallet-connect">
        <button className="connect-button" disabled>
          Loading...
        </button>
      </div>
    )
  }

  return (
    <div className="wallet-connect">
      {!authenticated ? (
        <button onClick={login} className="connect-button">
          Connect Wallet
        </button>
      ) : (
        <div className="wallet-info">
          {chainId && (
            <div className="network-badge">
              {CHAIN_NAMES[chainId] || `Chain ${chainId}`}
            </div>
          )}
          {address && (
            <div className="address-badge">
              {formatAddress(address)}
            </div>
          )}
          {user?.email && (
            <div className="email-badge">
              {user.email.address}
            </div>
          )}
          <button onClick={logout} className="disconnect-button">
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
