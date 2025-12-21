import { createConfig } from "ponder";
import { http, fallback } from "viem";
import { V4UtilsAbi } from "./abis/V4Utils";
import { V4CompoundorAbi } from "./abis/V4Compoundor";
import { V4AutoRangeAbi } from "./abis/V4AutoRange";

// ============ Base Mainnet ============
const BASE_CONTRACTS = {
  V4_UTILS: process.env.V4_UTILS_ADDRESS || "0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1",
  V4_COMPOUNDOR: process.env.V4_COMPOUNDOR_ADDRESS || "0xB17265e7875416955dE583e3cd1d72Ab5Ed6f670",
  V4_AUTO_RANGE: process.env.V4_AUTO_RANGE_ADDRESS || "0xa3671811324e8868e9fa83038e6b565A5b59719C",
};
const BASE_START_BLOCK = 39369847;

// ============ Sepolia Testnet ============
const SEPOLIA_CONTRACTS = {
  V4_UTILS: process.env.SEPOLIA_V4_UTILS_ADDRESS || "0xff9C5B6F76444144a36de91F4d2F3289E37Cf956",
  V4_COMPOUNDOR: process.env.SEPOLIA_V4_COMPOUNDOR_ADDRESS || "0xBA8bc095e0BEA3C6B1C6F5FfB56F67AaD76914Ad",
  V4_AUTO_RANGE: process.env.SEPOLIA_V4_AUTO_RANGE_ADDRESS || "0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD",
};
const SEPOLIA_START_BLOCK = 7500000; // Adjust to actual deployment block

// NOTE: PositionManager is NOT indexed here to save RPC costs
// Positions are fetched directly from chain in the backend API
// This Ponder instance only indexes our custom contracts (V4Utils, V4Compoundor, V4AutoRange)

// Base Mainnet RPC URLs with fallbacks
const BASE_RPCS = [
  process.env.INFURA_BASE_RPC_URL,
  process.env.QUICKNODE_BASE_RPC_URL,
  process.env.PONDER_RPC_URL_8453,
  "https://mainnet.base.org",
  "https://base.drpc.org",
  "https://base-rpc.publicnode.com",
  "https://base.meowrpc.com",
  "https://1rpc.io/base",
  "https://base.llamarpc.com",
].filter(Boolean) as string[];

// Sepolia RPC URLs with fallbacks
const SEPOLIA_RPCS = [
  process.env.QUICKNODE_SEPOLIA_RPC_URL,
  process.env.PONDER_RPC_URL_11155111,
  "https://rpc.sepolia.org",
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://rpc2.sepolia.org",
].filter(Boolean) as string[];

// Create fallback transports
const baseTransport = fallback(
  BASE_RPCS.map((url) => http(url, { timeout: 30_000, retryCount: 2 })),
  { rank: true }
);

const sepoliaTransport = fallback(
  SEPOLIA_RPCS.map((url) => http(url, { timeout: 30_000, retryCount: 2 })),
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
      pollingInterval: 15_000,
      maxRequestsPerSecond: 25,
    },
    sepolia: {
      id: 11155111,
      transport: sepoliaTransport,
      pollingInterval: 15_000,
      maxRequestsPerSecond: 10,
    },
  },
  contracts: {
    // Base Mainnet contracts
    V4Utils: {
      chain: "base",
      abi: V4UtilsAbi,
      address: BASE_CONTRACTS.V4_UTILS as `0x${string}`,
      startBlock: BASE_START_BLOCK,
    },
    V4Compoundor: {
      chain: "base",
      abi: V4CompoundorAbi,
      address: BASE_CONTRACTS.V4_COMPOUNDOR as `0x${string}`,
      startBlock: BASE_START_BLOCK,
    },
    V4AutoRange: {
      chain: "base",
      abi: V4AutoRangeAbi,
      address: BASE_CONTRACTS.V4_AUTO_RANGE as `0x${string}`,
      startBlock: BASE_START_BLOCK,
    },
    // Sepolia contracts
    V4UtilsSepolia: {
      chain: "sepolia",
      abi: V4UtilsAbi,
      address: SEPOLIA_CONTRACTS.V4_UTILS as `0x${string}`,
      startBlock: SEPOLIA_START_BLOCK,
    },
    V4CompoundorSepolia: {
      chain: "sepolia",
      abi: V4CompoundorAbi,
      address: SEPOLIA_CONTRACTS.V4_COMPOUNDOR as `0x${string}`,
      startBlock: SEPOLIA_START_BLOCK,
    },
    V4AutoRangeSepolia: {
      chain: "sepolia",
      abi: V4AutoRangeAbi,
      address: SEPOLIA_CONTRACTS.V4_AUTO_RANGE as `0x${string}`,
      startBlock: SEPOLIA_START_BLOCK,
    },
  },
});
