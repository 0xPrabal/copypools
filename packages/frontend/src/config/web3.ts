import { createConfig } from '@privy-io/wagmi';
import { http, fallback } from 'wagmi';
import { sepolia, mainnet, base } from 'wagmi/chains';

// Sepolia RPC endpoints with fallbacks (public RPCs)
const sepoliaTransports = [
  http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),      // Primary from env
  http("https://rpc.sepolia.org"),                     // Sepolia.org
  http("https://ethereum-sepolia-rpc.publicnode.com"), // PublicNode
  http("https://sepolia.drpc.org"),                    // dRPC
  http("https://rpc2.sepolia.org"),                    // Sepolia.org 2
  http("https://eth-sepolia.public.blastapi.io"),      // BlastAPI
  http("https://1rpc.io/sepolia"),                     // 1RPC
].filter(t => t.config.url); // Filter out undefined URLs

// Mainnet RPC endpoints with fallbacks (public RPCs)
const mainnetTransports = [
  http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL),       // Primary from env
  http("https://ethereum-rpc.publicnode.com"),         // PublicNode
  http("https://eth.drpc.org"),                        // dRPC
  http("https://rpc.ankr.com/eth"),                    // Ankr
  http("https://eth.llamarpc.com"),                    // LlamaRPC
  http("https://1rpc.io/eth"),                         // 1RPC
  http("https://eth.meowrpc.com"),                     // MeowRPC
].filter(t => t.config.url); // Filter out undefined URLs

// Base Mainnet RPC endpoints with fallbacks (public RPCs)
const baseTransports = [
  http(process.env.NEXT_PUBLIC_BASE_RPC_URL),          // Primary from env
  http("https://mainnet.base.org"),                    // Base Official
  http("https://base.drpc.org"),                       // dRPC
  http("https://base-rpc.publicnode.com"),             // PublicNode
  http("https://base.meowrpc.com"),                    // MeowRPC
  http("https://1rpc.io/base"),                        // 1RPC
  http("https://base.llamarpc.com"),                   // LlamaRPC
].filter(t => t.config.url); // Filter out undefined URLs

export const config = createConfig({
  chains: [base, sepolia, mainnet],
  transports: {
    [sepolia.id]: fallback(sepoliaTransports, { rank: true, retryCount: 2 }),
    [mainnet.id]: fallback(mainnetTransports, { rank: true, retryCount: 2 }),
    [base.id]: fallback(baseTransports, { rank: true, retryCount: 2 }),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
