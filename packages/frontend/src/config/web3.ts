import { createConfig } from '@privy-io/wagmi';
import { http, fallback } from 'wagmi';
import { sepolia, base } from 'wagmi/chains';

// Sepolia RPC URLs - CORS-friendly only for browser requests
const sepoliaRpcs = [
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,             // Primary from env (Alchemy/Infura)
  "https://ethereum-sepolia-rpc.publicnode.com",       // PublicNode (CORS friendly)
  "https://rpc.sepolia.org",                           // Sepolia.org
  "https://rpc2.sepolia.org",                          // Sepolia.org 2
].filter(Boolean) as string[];

// Base Mainnet RPC URLs - CORS-friendly only for browser requests
const baseRpcs = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,                // Primary from env (Alchemy/Infura)
  "https://base-rpc.publicnode.com",                   // PublicNode (CORS friendly)
  "https://base.meowrpc.com",                          // MeowRPC (CORS friendly)
  "https://base.llamarpc.com",                         // LlamaRPC (CORS friendly)
].filter(Boolean) as string[];

export const config = createConfig({
  chains: [base, sepolia],
  transports: {
    [sepolia.id]: fallback(sepoliaRpcs.map(url => http(url)), { rank: true, retryCount: 2 }),
    [base.id]: fallback(baseRpcs.map(url => http(url)), { rank: true, retryCount: 2 }),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
