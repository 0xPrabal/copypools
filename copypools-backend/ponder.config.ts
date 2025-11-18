import { createConfig } from "@ponder/core";
import { http } from "viem";
import * as LPManagerABI from "./src/contracts/abi/LPManagerV1.json";
import * as AdapterABI from "./src/contracts/abi/UniswapV4AdapterProduction.json";

export default createConfig({
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
      startBlock: 7363025, // Block when contract was deployed
    },
    UniswapV4Adapter: {
      abi: AdapterABI.abi,
      address: process.env.ADAPTER_ADDRESS as `0x${string}`,
      network: "sepolia",
      startBlock: 7363029, // Block when contract was deployed
    },
  },
});
