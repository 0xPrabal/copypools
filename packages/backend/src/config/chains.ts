/**
 * Multi-chain configuration
 * Defines contracts and RPC URLs for each supported chain
 */

export const SUPPORTED_CHAINS = [8453] as const;
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

};

export function getChainConfig(chainId: number): ChainConfig | null {
  return CHAIN_CONFIGS[chainId as SupportedChainId] || null;
}

export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAINS.includes(chainId as SupportedChainId);
}
