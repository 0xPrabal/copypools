'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { BrowserProvider } from 'ethers'
import { useEffect, useState } from 'react'
import { WalletState } from '@/lib/types'

export const usePrivyWallet = () => {
  const { ready, authenticated, login, logout } = usePrivy()
  const { wallets } = useWallets()
  const [provider, setProvider] = useState<BrowserProvider | null>(null)

  // Get the primary wallet
  const wallet = wallets[0]
  const address = wallet?.address || null
  const chainId = wallet?.chainId
    ? parseInt(wallet.chainId.replace('eip155:', ''))
    : null

  // Create a provider from the Privy wallet if available
  useEffect(() => {
    let mounted = true

    const initProvider = async () => {
      if (!wallet || !authenticated) {
        setProvider(null)
        return
      }

      try {
        // Get the EIP-1193 provider from Privy wallet (async)
        const eip1193Provider = await wallet.getEthereumProvider?.()
        if (!eip1193Provider || !mounted) return

        const browserProvider = new BrowserProvider(eip1193Provider)
        if (mounted) {
          setProvider(browserProvider)
        }
      } catch (error) {
        console.error('Error creating provider:', error)
        if (mounted) {
          setProvider(null)
        }
      }
    }

    initProvider()

    return () => {
      mounted = false
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
