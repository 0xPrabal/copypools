'use client'

import { useState, useEffect, useCallback } from 'react'
import { BrowserProvider } from 'ethers'
import { WalletState } from '@/lib/types'
import { CHAIN_ID } from '@/lib/config/constants'

export const useWallet = () => {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    chainId: null,
    isConnected: false,
    isConnecting: false,
  })

  const [provider, setProvider] = useState<BrowserProvider | null>(null)

  const checkConnection = useCallback(async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const browserProvider = new BrowserProvider(window.ethereum)
        const accounts = await browserProvider.listAccounts()

        if (accounts.length > 0) {
          const network = await browserProvider.getNetwork()
          setWallet({
            address: accounts[0].address,
            chainId: Number(network.chainId),
            isConnected: true,
            isConnecting: false,
          })
          setProvider(browserProvider)
        }
      } catch (error) {
        console.error('Error checking connection:', error)
      }
    }
  }, [])

  const connect = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') {
      alert('Please install MetaMask to use this app')
      return
    }

    try {
      setWallet(prev => ({ ...prev, isConnecting: true }))

      const browserProvider = new BrowserProvider(window.ethereum)
      const accounts = await browserProvider.send('eth_requestAccounts', [])
      const network = await browserProvider.getNetwork()

      // Check if on correct network
      if (Number(network.chainId) !== CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
          })
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            alert('Please add Sepolia network to MetaMask')
          }
          throw switchError
        }
      }

      setWallet({
        address: accounts[0],
        chainId: Number(network.chainId),
        isConnected: true,
        isConnecting: false,
      })
      setProvider(browserProvider)
    } catch (error) {
      console.error('Error connecting wallet:', error)
      setWallet(prev => ({ ...prev, isConnecting: false }))
    }
  }, [])

  const disconnect = useCallback(() => {
    setWallet({
      address: null,
      chainId: null,
      isConnected: false,
      isConnecting: false,
    })
    setProvider(null)
  }, [])

  useEffect(() => {
    checkConnection()

    if (typeof window.ethereum !== 'undefined') {
      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnect()
        } else {
          checkConnection()
        }
      })

      window.ethereum.on('chainChanged', () => {
        window.location.reload()
      })
    }

    return () => {
      if (typeof window.ethereum !== 'undefined') {
        window.ethereum.removeAllListeners('accountsChanged')
        window.ethereum.removeAllListeners('chainChanged')
      }
    }
  }, [checkConnection, disconnect])

  return {
    ...wallet,
    provider,
    connect,
    disconnect,
  }
}

declare global {
  interface Window {
    ethereum?: any
  }
}
