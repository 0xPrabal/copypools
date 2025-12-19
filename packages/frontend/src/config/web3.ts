import { createConfig } from '@privy-io/wagmi';
import { http, fallback } from 'wagmi';
import { sepolia, mainnet, base } from 'wagmi/chains';

// Sepolia RPC endpoints with fallbacks
const sepoliaTransports = [
  http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL),
  http("https://rpc.sepolia.org"),
  http("https://ethereum-sepolia-rpc.publicnode.com"),
  http("https://sepolia.drpc.org"),
  http("https://rpc2.sepolia.org"),
  http("https://eth-sepolia.public.blastapi.io"),
];

// Mainnet RPC endpoints with fallbacks
const mainnetTransports = [
  http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL),
  http("https://ethereum-rpc.publicnode.com"),
  http("https://eth.drpc.org"),
  http("https://rpc.ankr.com/eth"),
];

// Base Mainnet RPC endpoints with fallbacks
const baseTransports = [
  http(process.env.NEXT_PUBLIC_BASE_RPC_URL),
  http("https://mainnet.base.org"),
  http("https://base.drpc.org"),
  http("https://base-rpc.publicnode.com"),
  http("https://base.meowrpc.com"),
];

export const config = createConfig({
  chains: [base, sepolia, mainnet],
  transports: {
    [sepolia.id]: fallback(sepoliaTransports),
    [mainnet.id]: fallback(mainnetTransports),
    [base.id]: fallback(baseTransports),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
