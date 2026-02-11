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
// Start from very recent block for fast sync (~5k blocks = ~1-2 min sync)
// Current block is ~40805000, start from 40800000 to catch recent events
const BASE_START_BLOCK = 40800000;

// PositionManager start block - same as BASE_START_BLOCK for consistency
const POSITION_MANAGER_START_BLOCK = 40800000;

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
  },
});
