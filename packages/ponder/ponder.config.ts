import { createConfig } from "ponder";
import { V4UtilsAbi } from "./abis/V4Utils";
import { V4CompoundorAbi } from "./abis/V4Compoundor";
import { V4AutoRangeAbi } from "./abis/V4AutoRange";
import { V4AutoExitAbi } from "./abis/V4AutoExit";
import { PositionManagerAbi } from "./abis/PositionManager";

// ============ Base Mainnet ============
const BASE_CONTRACTS = {
  V4_UTILS: process.env.V4_UTILS_ADDRESS || "0x8d81Bb4daA4c8D6ad99a741d1E7C9563EAFda423",
  V4_COMPOUNDOR: process.env.V4_COMPOUNDOR_ADDRESS || "0x2056eDc7590B42b5464f357589810fA3441216E3",
  V4_AUTO_RANGE: process.env.V4_AUTO_RANGE_ADDRESS || "0xB6E684266259d172a8CC85F524ab2E845886242b",
  V4_AUTO_EXIT: process.env.V4_AUTO_EXIT_ADDRESS || "0xb9ab855339036df10790728A773dD3a8c9e538B0",
  // Uniswap V4 PositionManager - indexes ALL position ownership via Transfer events
  POSITION_MANAGER: process.env.POSITION_MANAGER_ADDRESS || "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
};
// Start from deployment block (Feb 19, 2026)
const BASE_START_BLOCK = 42359600;

// PositionManager start block - use same as deployment block to avoid heavy backfill
// Older positions are fetched via Alchemy NFT API or RPC fallback
const POSITION_MANAGER_START_BLOCK = BASE_START_BLOCK;

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
    schema: process.env.PONDER_SCHEMA || "ponder",
  },
  chains: {
    base: {
      id: 8453,
      rpc: BASE_RPCS.length > 0 ? BASE_RPCS : "https://mainnet.base.org",
      pollingInterval: 120_000, // Poll every 2 minutes to reduce RPC pressure
      maxRequestsPerSecond: 1, // Throttled to avoid Alchemy concurrent request limits
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
    V4AutoExit: {
      chain: "base",
      abi: V4AutoExitAbi,
      address: BASE_CONTRACTS.V4_AUTO_EXIT as `0x${string}`,
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
