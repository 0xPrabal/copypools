export interface PoolRow {
  id: string;
  pair: string;
  dex: string;
  feeTier: string;
  apr24h: string;
  tvl: string;
  volume24h: string;
  fees24h: string;
  volumeTvl: string;
  favorite?: boolean;
}
