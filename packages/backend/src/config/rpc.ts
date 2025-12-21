/**
 * Multi-RPC configuration with fallback support
 * Public RPCs listed in priority order (primary first, then fallbacks)
 */

export interface RpcConfig {
  url: string;
  name: string;
}

export const rpcConfigsPerChain: Record<number, RpcConfig[]> = {
  // Ethereum Mainnet
  // 1: [
  //   { url: process.env.RPC_URL || '', name: 'Primary (env)' },
  //   { url: 'https://ethereum-rpc.publicnode.com', name: 'PublicNode' },
  //   { url: 'https://eth.drpc.org', name: 'dRPC' },
  //   { url: 'https://rpc.ankr.com/eth', name: 'Ankr' },
  //   { url: 'https://eth.llamarpc.com', name: 'LlamaRPC' },
  //   { url: 'https://1rpc.io/eth', name: '1RPC' },
  // ],

  // Sepolia Testnet
  11155111: [
    { url: process.env.QUICKNODE_SEPOLIA_RPC_URL || '', name: 'QuickNode' },
    { url: process.env.RPC_URL || '', name: 'Primary (env)' },
    { url: 'https://rpc.sepolia.org', name: 'Sepolia.org' },
    { url: 'https://ethereum-sepolia-rpc.publicnode.com', name: 'PublicNode' },
    { url: 'https://sepolia.drpc.org', name: 'dRPC' },
    { url: 'https://rpc2.sepolia.org', name: 'Sepolia.org 2' },
  ],

  // Base Mainnet
  8453: [
    { url: process.env.INFURA_BASE_RPC_URL || '', name: 'Infura' },
    { url: process.env.QUICKNODE_BASE_RPC_URL || '', name: 'QuickNode' },
    { url: process.env.RPC_URL || '', name: 'Primary (env)' },
    { url: 'https://mainnet.base.org', name: 'Base Official' },
    { url: 'https://base.drpc.org', name: 'dRPC' },
    { url: 'https://base-rpc.publicnode.com', name: 'PublicNode' },
    { url: 'https://base.meowrpc.com', name: 'MeowRPC' },
    { url: 'https://1rpc.io/base', name: '1RPC' },
    { url: 'https://base.llamarpc.com', name: 'LlamaRPC' },
  ],

  // // Arbitrum One
  // 42161: [
  //   { url: process.env.RPC_URL || '', name: 'Primary (env)' },
  //   { url: 'https://arb1.arbitrum.io/rpc', name: 'Arbitrum Official' },
  //   { url: 'https://arbitrum.drpc.org', name: 'dRPC' },
  //   { url: 'https://arbitrum-one-rpc.publicnode.com', name: 'PublicNode' },
  //   { url: 'https://rpc.ankr.com/arbitrum', name: 'Ankr' },
  //   { url: 'https://1rpc.io/arb', name: '1RPC' },
  //   { url: 'https://arbitrum.llamarpc.com', name: 'LlamaRPC' },
  // ],

  // // Optimism
  // 10: [
  //   { url: process.env.RPC_URL || '', name: 'Primary (env)' },
  //   { url: 'https://mainnet.optimism.io', name: 'Optimism Official' },
  //   { url: 'https://optimism.drpc.org', name: 'dRPC' },
  //   { url: 'https://optimism-rpc.publicnode.com', name: 'PublicNode' },
  //   { url: 'https://rpc.ankr.com/optimism', name: 'Ankr' },
  //   { url: 'https://1rpc.io/op', name: '1RPC' },
  // ],

  // // Polygon
  // 137: [
  //   { url: process.env.RPC_URL || '', name: 'Primary (env)' },
  //   { url: 'https://polygon-rpc.com', name: 'Polygon Official' },
  //   { url: 'https://polygon.drpc.org', name: 'dRPC' },
  //   { url: 'https://polygon-bor-rpc.publicnode.com', name: 'PublicNode' },
  //   { url: 'https://rpc.ankr.com/polygon', name: 'Ankr' },
  //   { url: 'https://1rpc.io/matic', name: '1RPC' },
  // ],
};

/**
 * Get valid RPC URLs for a chain (filters out empty URLs)
 */
export function getValidRpcs(chainId: number): RpcConfig[] {
  const configs = rpcConfigsPerChain[chainId] || [];
  return configs.filter((c) => c.url && c.url.length > 0);
}

/**
 * Get primary RPC URL for a chain
 */
export function getPrimaryRpc(chainId: number): string {
  const rpcs = getValidRpcs(chainId);
  if (rpcs.length === 0) {
    throw new Error(`No RPC configured for chain ${chainId}`);
  }
  return rpcs[0].url;
}
