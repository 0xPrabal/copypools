import { createConfig } from "ponder";
import { http, fallback } from "viem";
import { V4UtilsAbi } from "./abis/V4Utils";
import { V4CompoundorAbi } from "./abis/V4Compoundor";
import { V4AutoRangeAbi } from "./abis/V4AutoRange";

// Contract addresses (Base Mainnet)
const V4_UTILS_ADDRESS = process.env.V4_UTILS_ADDRESS || "0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1";
const V4_COMPOUNDOR_ADDRESS = process.env.V4_COMPOUNDOR_ADDRESS || "0xB17265e7875416955dE583e3cd1d72Ab5Ed6f670";
const V4_AUTO_RANGE_ADDRESS = process.env.V4_AUTO_RANGE_ADDRESS || "0xa3671811324e8868e9fa83038e6b565A5b59719C";

// NOTE: PositionManager is NOT indexed here to save RPC costs
// Positions are fetched directly from chain in the backend API
// This Ponder instance only indexes our custom contracts (V4Utils, V4Compoundor, V4AutoRange)

// Start block - set to contract deployment block for faster sync (Base Mainnet deployment: 39369847)
const START_BLOCK = 39369847;

// Base Mainnet RPC URLs with fallbacks (public RPCs)
const BASE_RPCS = [
  process.env.PONDER_RPC_URL_8453,           // Primary from env (e.g., Alchemy)
  "https://mainnet.base.org",                 // Base Official
  "https://base.drpc.org",                    // dRPC
  "https://base-rpc.publicnode.com",          // PublicNode
  "https://base.meowrpc.com",                 // MeowRPC
  "https://1rpc.io/base",                     // 1RPC
  "https://base.llamarpc.com",                // LlamaRPC
].filter(Boolean) as string[];

// Create fallback transport for Base
const baseTransport = fallback(
  BASE_RPCS.map((url) => http(url, { timeout: 30_000, retryCount: 2 })),
  { rank: true }
);

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    base: {
      id: 8453,
      transport: baseTransport,
      pollingInterval: 15_000, // Poll every 15s
      maxRequestsPerSecond: 25, // Higher rate limit with fallbacks
    },
  },
  contracts: {
    V4Utils: {
      chain: "base",
      abi: V4UtilsAbi,
      address: V4_UTILS_ADDRESS as `0x${string}`,
      startBlock: START_BLOCK,
    },
    V4Compoundor: {
      chain: "base",
      abi: V4CompoundorAbi,
      address: V4_COMPOUNDOR_ADDRESS as `0x${string}`,
      startBlock: START_BLOCK,
    },
    V4AutoRange: {
      chain: "base",
      abi: V4AutoRangeAbi,
      address: V4_AUTO_RANGE_ADDRESS as `0x${string}`,
      startBlock: START_BLOCK,
    },
  },
});
