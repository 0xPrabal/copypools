import "dotenv/config";
import { createConfig } from "@ponder/core";
import { http } from "viem";
import LPManagerABI from "./abis/LPManagerV1.json";
import AdapterABI from "./abis/UniswapV4AdapterProduction.json";

const databaseUrl = process.env.DATABASE_URL || process.env.PONDER_DATABASE_URL;

export default createConfig({
  database: databaseUrl ? {
    kind: "postgres",
    connectionString: databaseUrl,
  } : undefined,
  networks: {
    sepolia: {
      chainId: 11155111,
      transport: http(process.env.RPC_URL),
    },
  },
  contracts: {
    LPManager: {
      abi: LPManagerABI.abi,
      address: process.env.LP_MANAGER_ADDRESS as `0x${string}`,
      network: "sepolia",
      startBlock: 9698798, // Start from position 18 (first position with NEW adapter)
    },
    UniswapV4Adapter: {
      abi: AdapterABI.abi,
      address: process.env.ADAPTER_ADDRESS as `0x${string}`,
      network: "sepolia",
      startBlock: 9698798, // Start from position 18 (first position with NEW adapter)
    },
  },
});
