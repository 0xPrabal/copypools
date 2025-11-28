'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { BrowserProvider } from 'ethers'
import { useMemo } from 'react'
import { WalletState } from '@/lib/types'

export const usePrivyWallet = () => {
  const { ready, authenticated, login, logout } = usePrivy()
  const { wallets } = useWallets()

  // Get the primary wallet
  const wallet = wallets[0]
  const address = wallet?.address || null
  const chainId = wallet?.chainId
    ? parseInt(wallet.chainId.replace('eip155:', ''))
    : null

  // Create a provider from the Privy wallet if available
  const provider = useMemo(() => {
    if (!wallet || !authenticated) return null

    try {
      // Get the EIP-1193 provider from Privy wallet
      const eip1193Provider = wallet.getEthereumProvider?.()
      if (!eip1193Provider) return null

      return new BrowserProvider(eip1193Provider)
    } catch (error) {
      console.error('Error creating provider:', error)
      return null
    }
  }, [wallet, authenticated])

  const walletState: WalletState = {
    address,
    chainId,
    isConnected: authenticated,
    isConnecting: !ready,
  }

  return {
    ...walletState,
    provider,
    connect: login,
    disconnect: logout,
  }
}
