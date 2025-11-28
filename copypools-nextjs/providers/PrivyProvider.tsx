'use client'

import { PrivyProvider as Privy } from '@privy-io/react-auth'
import { sepolia } from 'viem/chains'

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <Privy
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'your-privy-app-id'}
      config={{
        loginMethods: ['wallet', 'email', 'google'],
        appearance: {
          theme: 'dark',
          accentColor: '#676FFF',
        },
        defaultChain: sepolia,
        supportedChains: [sepolia],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </Privy>
  )
}
