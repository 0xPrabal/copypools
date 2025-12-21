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
            staleTime: 2 * 60 * 1000, // Data considered fresh for 2 minutes (optimized from 30s)
            gcTime: 10 * 60 * 1000, // Keep unused data in cache for 10 minutes
            refetchOnWindowFocus: false, // Disabled to reduce RPC calls (was major source of requests)
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
