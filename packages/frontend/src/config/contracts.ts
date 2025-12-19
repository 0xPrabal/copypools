// Chain IDs
export const CHAIN_IDS = {
  BASE: 8453,
  SEPOLIA: 11155111,
  MAINNET: 1,
} as const;

// Default chain (Base Mainnet)
export const DEFAULT_CHAIN_ID = CHAIN_IDS.BASE;

// Contract Addresses per chain
export const CHAIN_CONTRACTS = {
  [CHAIN_IDS.BASE]: {
    // Uniswap V4 Core on Base Mainnet
    POOL_MANAGER: '0x498581fF718922c3f8e6A244956aF099B2652b2b' as `0x${string}`,
    POSITION_MANAGER: '0x7C5f5A4bBd8fD63184577525326123B519429bDc' as `0x${string}`,
    STATE_VIEW: '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71' as `0x${string}`,
    // Liquifi Automators on Base (Deployed Proxies)
    V4_UTILS: '0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1' as `0x${string}`,
    V4_COMPOUNDOR: '0xB17265e7875416955dE583e3cd1d72Ab5Ed6f670' as `0x${string}`,
    V4_AUTO_RANGE: '0xa3671811324e8868e9fa83038e6b565A5b59719C' as `0x${string}`,
  },
  [CHAIN_IDS.SEPOLIA]: {
    // Uniswap V4 Core on Sepolia
    POOL_MANAGER: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543' as `0x${string}`,
    POSITION_MANAGER: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4' as `0x${string}`,
    STATE_VIEW: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c' as `0x${string}`,
    // Liquifi Automators on Sepolia
    V4_UTILS: '0xff9C5B6F76444144a36de91F4d2F3289E37Cf956' as `0x${string}`,
    V4_COMPOUNDOR: '0xBA8bc095e0BEA3C6B1C6F5FfB56F67AaD76914Ad' as `0x${string}`,
    V4_AUTO_RANGE: '0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD' as `0x${string}`,
  },
} as const;

// Helper to get contracts for a specific chain
export function getContracts(chainId: number) {
  const contracts = CHAIN_CONTRACTS[chainId as keyof typeof CHAIN_CONTRACTS];
  if (!contracts) {
    console.warn(`No contracts configured for chain ${chainId}, falling back to Base`);
    return CHAIN_CONTRACTS[CHAIN_IDS.BASE];
  }
  return contracts;
}

// Legacy export for backwards compatibility (uses Base by default)
export const CONTRACTS = CHAIN_CONTRACTS[CHAIN_IDS.BASE];
export const CHAIN_ID = DEFAULT_CHAIN_ID;
