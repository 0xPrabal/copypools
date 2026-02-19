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
    V4_AUTO_EXIT: `0x${string}`;
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
      V4_UTILS: '0x8d81Bb4daA4c8D6ad99a741d1E7C9563EAFda423',
      V4_COMPOUNDOR: '0x2056eDc7590B42b5464f357589810fA3441216E3',
      V4_AUTO_RANGE: '0xB6E684266259d172a8CC85F524ab2E845886242b',
      V4_AUTO_EXIT: '0xb9ab855339036df10790728A773dD3a8c9e538B0',
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
