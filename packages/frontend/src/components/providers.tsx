'use client';

import dynamic from 'next/dynamic';

// Dynamically import the providers with SSR disabled to prevent
// server-side rendering issues with wagmi/privy hooks
const ClientProviders = dynamic(
  () => import('./client-providers').then((mod) => mod.ClientProviders),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    ),
  }
);

export function Providers({ children }: { children: React.ReactNode }) {
  return <ClientProviders>{children}</ClientProviders>;
}
