import type { PoolRow } from "@/types/pool";
import type { PortfolioSummary, PortfolioPool } from "@/types/portfolio";

export const poolRows: PoolRow[] = [
  {
    id: "1",
    pair: "WETH / USDT",
    dex: "Uniswap V3",
    feeTier: "0.3%",
    apr24h: "70.01%",
    tvl: "$114.2M",
    volume24h: "$73.0M",
    fees24h: "$219.0K",
    volumeTvl: "63.93%"
  },
  {
    id: "2",
    pair: "WETH / ADO",
    dex: "Uniswap V3",
    feeTier: "1%",
    apr24h: "3,262.32%",
    tvl: "$1.9M",
    volume24h: "$17.1M",
    fees24h: "$171.0K",
    volumeTvl: "893.79%"
  },
  {
    id: "3",
    pair: "WETH / USDC",
    dex: "Uniswap V3",
    feeTier: "0.05%",
    apr24h: "64.38%",
    tvl: "$75.9M",
    volume24h: "$267.8M",
    fees24h: "$133.9K",
    volumeTvl: "352.77%"
  }
 ,
  {
    id: "4",
    pair: "USDC / WETH",
    dex: "Uniswap V3",
    feeTier: "0.3%",
    apr24h: "58.55%",
    tvl: "$51.5M",
    volume24h: "$27.6M",
    fees24h: "$82.7K",
    volumeTvl: "53.47%",
    favorite: true
  },
  {
    id: "5",
    pair: "ZKP / USDT",
    dex: "PancakeSwap V2",
    feeTier: "0.25%",
    apr24h: "3,424.7%",
    tvl: "$725.8K",
    volume24h: "$40.9M",
    fees24h: "$68.1K",
    volumeTvl: "5,629.65%"
  },
  {
    id: "6",
    pair: "WBTC / USDC",
    dex: "Uniswap V3",
    feeTier: "0.05%",
    apr24h: "19.73%",
    tvl: "$88.6M",
    volume24h: "$16.0M",
    fees24h: "$47.9K",
    volumeTvl: "18.01%"
  },
  {
    id: "7",
    pair: "WHYPE / USDT",
    dex: "Project X V3",
    feeTier: "0.05%",
    apr24h: "175.71%",
    tvl: "$13.0M",
    volume24h: "$124.9M",
    fees24h: "$62.4K",
    volumeTvl: "962.79%"
  }
];

export const portfolioSummary: PortfolioSummary = {
  tvl: "$15.5M",
  feesGenerated: "$29.7M",
  volume: "$1.1B",
  vaults: 2648
};

export const bestPools: PortfolioPool[] = [
  {
    id: "bp1",
    name: "WAVAX / USDC",
    platform: "TraderJoe",
    apr: "302.56%"
  },
  {
    id: "bp2",
    name: "WHYPE / USDE",
    platform: "Uniswap V3",
    apr: "302.26%"
  },
  {
    id: "bp3",
    name: "WETH / USDC",
    platform: "Aerodrome",
    apr: "299.07%"
  }
];
