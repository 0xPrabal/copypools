/**
 * Multi-chain configuration
 * Defines contracts and RPC URLs for each supported chain
 */

export const SUPPORTED_CHAINS = [8453, 11155111] as const;
export type SupportedChainId = typeof SUPPORTED_CHAINS[number];

export interface ChainConfig {
  chainId: number;
  name: string;
  contracts: {
    POOL_MANAGER: `0x${string}`;
    POSITION_MANAGER: `0x${string}`;
    STATE_VIEW: `0x${string}`;
    V4_UTILS: `0x${string}`;
    V4_COMPOUNDOR: `0x${string}`;
    V4_AUTO_RANGE: `0x${string}`;
  };
  rpcUrls: string[];
}

export const CHAIN_CONFIGS: Record<SupportedChainId, ChainConfig> = {
  // Base Mainnet
  8453: {
    chainId: 8453,
    name: 'Base',
    contracts: {
      POOL_MANAGER: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
      POSITION_MANAGER: '0x7C5f5A4bBd8fD63184577525326123B519429bDc',
      STATE_VIEW: '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71',
      V4_UTILS: '0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1',
      V4_COMPOUNDOR: '0xB17265e7875416955dE583e3cd1d72Ab5Ed6f670',
      V4_AUTO_RANGE: '0xa3671811324e8868e9fa83038e6b565A5b59719C',
    },
    rpcUrls: [
      process.env.INFURA_BASE_RPC_URL || '',
      process.env.QUICKNODE_BASE_RPC_URL || '',
      process.env.RPC_URL || '',
      'https://mainnet.base.org',
      'https://base.drpc.org',
      'https://base-rpc.publicnode.com',
      'https://base.meowrpc.com',
      'https://1rpc.io/base',
      'https://base.llamarpc.com',
    ].filter(Boolean),
  },

  // Sepolia Testnet
  11155111: {
    chainId: 11155111,
    name: 'Sepolia',
    contracts: {
      POOL_MANAGER: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
      POSITION_MANAGER: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4',
      STATE_VIEW: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c',
      V4_UTILS: '0xff9C5B6F76444144a36de91F4d2F3289E37Cf956',
      V4_COMPOUNDOR: '0xBA8bc095e0BEA3C6B1C6F5FfB56F67AaD76914Ad',
      V4_AUTO_RANGE: '0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD',
    },
    rpcUrls: [
      process.env.QUICKNODE_SEPOLIA_RPC_URL || '',
      process.env.SEPOLIA_RPC_URL || '',
      'https://rpc.sepolia.org',
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://sepolia.drpc.org',
      'https://rpc2.sepolia.org',
    ].filter(Boolean),
  },
};

export function getChainConfig(chainId: number): ChainConfig | null {
  return CHAIN_CONFIGS[chainId as SupportedChainId] || null;
}

export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAINS.includes(chainId as SupportedChainId);
}
