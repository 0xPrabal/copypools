export interface PortfolioSummary {
  tvl: string;
  feesGenerated: string;
  volume: string;
  vaults: number;
}

export interface PortfolioPool {
  id: string;
  name: string;
  platform: string;
  apr: string;
}
