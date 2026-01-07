import { CHAIN_IDS } from './contracts';

export interface TokenInfo {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  isNative?: boolean;
}

// Comprehensive token list for all supported chains
export const TOKENS_BY_CHAIN: Record<number, TokenInfo[]> = {
  // Base Mainnet tokens
  [CHAIN_IDS.BASE]: [
    // Native & Wrapped ETH
    { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    // Stablecoins
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 },
    { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
    { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
    { symbol: 'EURC', address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', decimals: 6 },
    // Coinbase Wrapped Assets
    { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', decimals: 18 },
    { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
    { symbol: 'cbDOGE', address: '0xcbD06E5A2B0C65597161de254AA074E489dEb510', decimals: 8 },
    { symbol: 'cbXRP', address: '0xcb585250f852C6c6bf90434AB21A00f02833a4af', decimals: 6 },
    { symbol: 'cbLTC', address: '0xcb17C9Db87B595717C857a08468793f5bAb6445F', decimals: 8 },
    { symbol: 'cbADA', address: '0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c', decimals: 6 },
    // LST/LRT tokens
    { symbol: 'wstETH', address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', decimals: 18 },
    { symbol: 'rETH', address: '0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c', decimals: 18 },
    // DeFi Governance Tokens
    { symbol: 'UNI', address: '0xc3De830EA07524a0761646a6a4e4be0e114a3C83', decimals: 18 },
    { symbol: 'COMP', address: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0', decimals: 18 },
    { symbol: 'AERO', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18 },
    { symbol: 'WELL', address: '0xA88594D404727625A9437C3f886C7643872296AE', decimals: 18 },
    { symbol: 'ZRO', address: '0x6985884C4392D348587B19cb9eAAf157F13271cd', decimals: 18 },
    // Meme & Community Tokens
    { symbol: 'DEGEN', address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', decimals: 18 },
    { symbol: 'TOSHI', address: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4', decimals: 18 },
    { symbol: 'BRETT', address: '0x0555E30DA8f98308EDB960aA94c0Db47230d2B9c', decimals: 18 },
    { symbol: 'SPX', address: '0x50dA645f148798F68EF2d7dB7C1CB22A6819bb2C', decimals: 8 },
    // AI & Tech Tokens
    { symbol: 'AIXBT', address: '0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825', decimals: 18 },
    { symbol: 'KAITO', address: '0x98d0baa52b2D063E780DE12F615f963Fe8537553', decimals: 18 },
    { symbol: 'VVV', address: '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf', decimals: 18 },
    // Protocol Tokens
    { symbol: 'ZORA', address: '0x1111111111166b7FE7bd91427724B487980aFc69', decimals: 18 },
    { symbol: 'B3', address: '0xB3B32F9f8827D4634fE7d973Fa1034Ec9fdDB3B3', decimals: 18 },
  ],
  // Sepolia testnet tokens
  [CHAIN_IDS.SEPOLIA]: [
    { symbol: 'ETH', address: '0x0000000000000000000000000000000000000000', decimals: 18, isNative: true },
    { symbol: 'WETH', address: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', decimals: 18 },
    { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
    { symbol: 'DAI', address: '0x68194a729C2450ad26072b3D33ADaCbcef39D574', decimals: 18 },
  ],
};

// Helper to get token by address
export function getTokenByAddress(chainId: number, address: string): TokenInfo | undefined {
  const tokens = TOKENS_BY_CHAIN[chainId] || TOKENS_BY_CHAIN[CHAIN_IDS.BASE];
  return tokens.find(t => t.address.toLowerCase() === address.toLowerCase());
}
