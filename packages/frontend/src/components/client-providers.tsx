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
            // Stale-while-revalidate: show cached data immediately, refresh in background
            staleTime: 30 * 1000, // Data considered fresh for 30 seconds
            gcTime: 5 * 60 * 1000, // Keep unused data in cache for 5 minutes (formerly cacheTime)
            refetchOnWindowFocus: true, // Refresh when user comes back to tab
            refetchOnReconnect: true, // Refresh when internet reconnects
            retry: 2, // Retry failed requests twice
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
        loginMethods: ['email', 'wallet'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
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
