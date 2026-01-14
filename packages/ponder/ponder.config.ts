import { createConfig } from "ponder";
import { V4UtilsAbi } from "./abis/V4Utils";
import { V4CompoundorAbi } from "./abis/V4Compoundor";
import { V4AutoRangeAbi } from "./abis/V4AutoRange";
import { PositionManagerAbi } from "./abis/PositionManager";

// ============ Base Mainnet ============
const BASE_CONTRACTS = {
  V4_UTILS: process.env.V4_UTILS_ADDRESS || "0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1",
  V4_COMPOUNDOR: process.env.V4_COMPOUNDOR_ADDRESS || "0xB17265e7875416955dE583e3cd1d72Ab5Ed6f670",
  V4_AUTO_RANGE: process.env.V4_AUTO_RANGE_ADDRESS || "0xa3671811324e8868e9fa83038e6b565A5b59719C",
  // Uniswap V4 PositionManager - indexes ALL position ownership via Transfer events
  POSITION_MANAGER: process.env.POSITION_MANAGER_ADDRESS || "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
};
// Start from recent block to catch RangeMoved events (~100k blocks = ~10-20 min sync)
// This catches position 938056→954275 rebalance at block 40753962
const BASE_START_BLOCK = 40700000;

// PositionManager start block - same as BASE_START_BLOCK for consistency
const POSITION_MANAGER_START_BLOCK = 40700000;

// ============ Sepolia Testnet ============
const SEPOLIA_CONTRACTS = {
  V4_UTILS: process.env.SEPOLIA_V4_UTILS_ADDRESS || "0xff9C5B6F76444144a36de91F4d2F3289E37Cf956",
  V4_COMPOUNDOR: process.env.SEPOLIA_V4_COMPOUNDOR_ADDRESS || "0xBA8bc095e0BEA3C6B1C6F5FfB56F67AaD76914Ad",
  V4_AUTO_RANGE: process.env.SEPOLIA_V4_AUTO_RANGE_ADDRESS || "0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD",
};
const SEPOLIA_START_BLOCK = 7500000; // Adjust to actual deployment block

// Base Mainnet RPC URLs - Prioritize paid/reliable RPCs first
// IMPORTANT: Keep list short to avoid spreading requests across too many endpoints
const BASE_RPCS = [
  // Paid RPCs first (more reliable, higher limits)
  process.env.QUICKNODE_BASE_RPC_URL,
  process.env.INFURA_BASE_RPC_URL,
  process.env.PONDER_RPC_URL_8453,
  // Reliable free RPCs as fallback (avoid rate-limited ones like llamarpc)
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
].filter(Boolean) as string[];

// Sepolia RPC URLs - Ponder will load balance across these
const SEPOLIA_RPCS = [
  // Paid RPCs first
  process.env.QUICKNODE_SEPOLIA_RPC_URL,
  process.env.ALCHEMY_SEPOLIA_RPC_URL,
  process.env.INFURA_SEPOLIA_RPC_URL,
  process.env.PONDER_RPC_URL_11155111,
  // Free fallbacks
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.org",
].filter(Boolean) as string[];

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    base: {
      id: 8453,
      rpc: BASE_RPCS.length > 0 ? BASE_RPCS : "https://mainnet.base.org",
      pollingInterval: 60_000, // Poll every 1 minute for faster position updates
      maxRequestsPerSecond: 3, // Increased for faster indexing
    },
    // Sepolia chain - DISABLED to avoid RPC timeout issues
    // sepolia: {
    //   id: 11155111,
    //   rpc: SEPOLIA_RPCS.length > 0 ? SEPOLIA_RPCS : "https://ethereum-sepolia-rpc.publicnode.com",
    //   pollingInterval: 300_000, // Poll every 5 minutes (testnet)
    //   maxRequestsPerSecond: 2,
    // },
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
    // PositionManager - indexes position ownership via ERC721 Transfer events
    // Only indexes recent blocks (~50k) to avoid slow initial sync
    // Older positions are fetched via Alchemy NFT API or RPC fallback
    PositionManager: {
      chain: "base",
      abi: PositionManagerAbi,
      address: BASE_CONTRACTS.POSITION_MANAGER as `0x${string}`,
      startBlock: POSITION_MANAGER_START_BLOCK,
    },
    // Sepolia contracts - DISABLED to avoid RPC timeout issues
    // Uncomment when needed for testnet
    // V4UtilsSepolia: {
    //   chain: "sepolia",
    //   abi: V4UtilsAbi,
    //   address: SEPOLIA_CONTRACTS.V4_UTILS as `0x${string}`,
    //   startBlock: SEPOLIA_START_BLOCK,
    // },
    // V4CompoundorSepolia: {
    //   chain: "sepolia",
    //   abi: V4CompoundorAbi,
    //   address: SEPOLIA_CONTRACTS.V4_COMPOUNDOR as `0x${string}`,
    //   startBlock: SEPOLIA_START_BLOCK,
    // },
    // V4AutoRangeSepolia: {
    //   chain: "sepolia",
    //   abi: V4AutoRangeAbi,
    //   address: SEPOLIA_CONTRACTS.V4_AUTO_RANGE as `0x${string}`,
    //   startBlock: SEPOLIA_START_BLOCK,
    // },
  },
});
