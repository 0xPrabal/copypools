import { createConfig } from '@privy-io/wagmi';
import { http } from 'wagmi';
import { sepolia, base } from 'wagmi/chains';

// Use only the FIRST available RPC to avoid fallback polling
// Fallback transports cause net_listening health checks
const getSepoliaRpc = () => {
  return process.env.NEXT_PUBLIC_QUICKNODE_SEPOLIA_RPC_URL ||
         process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
         "https://ethereum-sepolia-rpc.publicnode.com";
};

const getBaseRpc = () => {
  return process.env.NEXT_PUBLIC_INFURA_BASE_RPC_URL ||
         process.env.NEXT_PUBLIC_QUICKNODE_BASE_RPC_URL ||
         process.env.NEXT_PUBLIC_BASE_RPC_URL ||
         "https://base-rpc.publicnode.com";
};

export const config = createConfig({
  chains: [base, sepolia],
  // Drastically reduce polling - 60 seconds instead of default 4 seconds
  pollingInterval: 60_000,
  // Enable multicall batching
  batch: {
    multicall: {
      wait: 100, // Batch calls within 100ms window
      batchSize: 1024, // Max calls per batch
    },
  },
  transports: {
    // Use single HTTP transport (NO fallback) to eliminate net_listening polls
    // Fallback transports poll each RPC for health checks, causing 1000s of requests
    [sepolia.id]: http(getSepoliaRpc(), {
      timeout: 30_000,
      batch: {
        wait: 50, // Batch requests within 50ms
      },
      retryCount: 3,
      retryDelay: 1000,
    }),
    [base.id]: http(getBaseRpc(), {
      timeout: 30_000,
      batch: {
        wait: 50, // Batch requests within 50ms
      },
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
