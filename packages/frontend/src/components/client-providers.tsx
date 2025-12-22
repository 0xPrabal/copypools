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
            // Aggressive caching to minimize RPC calls
            staleTime: 5 * 60 * 1000, // Data fresh for 5 minutes
            gcTime: 30 * 60 * 1000, // Keep unused data in cache for 30 minutes
            refetchOnWindowFocus: false, // Disabled - major source of requests
            refetchOnReconnect: false, // Disabled - user can manually refresh
            refetchOnMount: false, // Don't refetch if data exists
            retry: 1, // Only retry once
            retryDelay: 2000, // Wait 2 seconds before retry
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
