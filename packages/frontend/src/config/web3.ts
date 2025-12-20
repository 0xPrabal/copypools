import { createConfig } from '@privy-io/wagmi';
import { http, fallback } from 'wagmi';
import { sepolia, mainnet, base } from 'wagmi/chains';

// Sepolia RPC URLs (public RPCs)
const sepoliaRpcs = [
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,             // Primary from env
  "https://rpc.sepolia.org",                           // Sepolia.org
  "https://ethereum-sepolia-rpc.publicnode.com",       // PublicNode
  "https://sepolia.drpc.org",                          // dRPC
  "https://rpc2.sepolia.org",                          // Sepolia.org 2
  "https://eth-sepolia.public.blastapi.io",            // BlastAPI
  "https://1rpc.io/sepolia",                           // 1RPC
].filter(Boolean) as string[];


// Base Mainnet RPC URLs (public RPCs)
const baseRpcs = [
  process.env.NEXT_PUBLIC_BASE_RPC_URL,                // Primary from env
  "https://mainnet.base.org",                          // Base Official
  "https://base.drpc.org",                             // dRPC
  "https://base-rpc.publicnode.com",                   // PublicNode
  "https://base.meowrpc.com",                          // MeowRPC
  "https://1rpc.io/base",                              // 1RPC
  "https://base.llamarpc.com",                         // LlamaRPC
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
