import { createConfig } from '@privy-io/wagmi';
import { http, fallback } from 'wagmi';
import { sepolia, base } from 'wagmi/chains';

// Sepolia RPC URLs - CORS-friendly only for browser requests
const sepoliaRpcs = [
  process.env.NEXT_PUBLIC_QUICKNODE_SEPOLIA_RPC_URL,   // QuickNode (primary)
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,             // Alchemy/Infura
  "https://ethereum-sepolia-rpc.publicnode.com",       // PublicNode (CORS friendly)
  "https://rpc.sepolia.org",                           // Sepolia.org
  "https://rpc2.sepolia.org",                          // Sepolia.org 2
].filter(Boolean) as string[];

// Base Mainnet RPC URLs - CORS-friendly only for browser requests
const baseRpcs = [
  process.env.NEXT_PUBLIC_INFURA_BASE_RPC_URL,         // Infura (primary)
  process.env.NEXT_PUBLIC_QUICKNODE_BASE_RPC_URL,      // QuickNode
  process.env.NEXT_PUBLIC_BASE_RPC_URL,                // Alchemy
  "https://base-rpc.publicnode.com",                   // PublicNode (CORS friendly)
  "https://base.meowrpc.com",                          // MeowRPC (CORS friendly)
  "https://base.llamarpc.com",                         // LlamaRPC (CORS friendly)
].filter(Boolean) as string[];

export const config = createConfig({
  chains: [base, sepolia],
  // Reduce polling frequency
  pollingInterval: 30_000, // Poll every 30 seconds instead of default 4 seconds
  batch: {
    multicall: {
      wait: 100, // Batch calls within 100ms window
    },
  },
  transports: {
    // Disable ranking to prevent constant net_listening polls (~5k requests/hour)
    // Fallback will still work - just uses RPCs in order instead of by latency
    [sepolia.id]: fallback(
      sepoliaRpcs.map(url => http(url, {
        timeout: 20_000,
        batch: true, // Enable batching
        retryDelay: 1000,
      })),
      { rank: false, retryCount: 2 }
    ),
    [base.id]: fallback(
      baseRpcs.map(url => http(url, {
        timeout: 20_000,
        batch: true, // Enable batching
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
