import { createConfig } from '@privy-io/wagmi';
import { http, fallback } from 'wagmi';
import { sepolia, base } from 'wagmi/chains';

// RPC URLs - environment variables are inlined at build time by Next.js
// Fallback to reliable public RPCs if env vars not set
const SEPOLIA_RPCS = [
  process.env.NEXT_PUBLIC_QUICKNODE_SEPOLIA_RPC_URL,
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.org",
].filter(Boolean) as string[];

const BASE_RPCS = [
  process.env.NEXT_PUBLIC_INFURA_BASE_RPC_URL,
  process.env.NEXT_PUBLIC_QUICKNODE_BASE_RPC_URL,
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
].filter(Boolean) as string[];

export const config = createConfig({
  chains: [base, sepolia],
  // Reduce polling frequency - 30 seconds
  pollingInterval: 30_000,
  // Enable multicall batching
  batch: {
    multicall: {
      wait: 100,
      batchSize: 1024,
    },
  },
  transports: {
    // Use fallback with rank: false to avoid net_listening polls
    // This provides reliability without excessive health checks
    [sepolia.id]: fallback(
      SEPOLIA_RPCS.map(url => http(url, {
        timeout: 30_000,
        retryCount: 2,
        retryDelay: 1000,
      })),
      { rank: false, retryCount: 2 }
    ),
    [base.id]: fallback(
      BASE_RPCS.map(url => http(url, {
        timeout: 30_000,
        retryCount: 2,
        retryDelay: 1000,
      })),
      { rank: false, retryCount: 2 }
    ),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
