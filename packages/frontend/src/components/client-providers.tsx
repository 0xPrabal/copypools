'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from '@privy-io/wagmi';
import { PrivyProvider } from '@privy-io/react-auth';
import { useState } from 'react';
import { base, sepolia } from 'wagmi/chains';
import { config } from '../config/web3';
import { ToastProvider } from './common/toast';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Balanced caching - load data but don't constantly refresh
            staleTime: 2 * 60 * 1000, // Data fresh for 2 minutes
            gcTime: 10 * 60 * 1000, // Keep unused data in cache for 10 minutes
            refetchOnWindowFocus: false, // Disabled - prevents refresh when tabbing back
            refetchOnReconnect: true, // Refresh when internet reconnects
            refetchOnMount: 'always', // Always fetch fresh data on mount
            retry: 2, // Retry twice on failure
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
          },
        },
      })
  );

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#676FFF',
        },
        loginMethods: ['wallet', 'email'], // Wallet first to prioritize external wallets
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          // Ensure external wallets (MetaMask, etc.) are used when available
          showWalletUIs: true,
        } as any,
        // Prioritize external wallet connectors
        externalWallets: {
          coinbaseWallet: { connectionOptions: 'smartWalletOnly' },
        } as any,
        // Set Base as the default chain, with Sepolia as additional supported chain
        defaultChain: base,
        supportedChains: [base, sepolia],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
