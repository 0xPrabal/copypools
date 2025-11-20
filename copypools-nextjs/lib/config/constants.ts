export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000'
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '11155111')
export const LP_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_LP_MANAGER_ADDRESS || ''
export const ADAPTER_ADDRESS = process.env.NEXT_PUBLIC_ADAPTER_ADDRESS || ''
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'

export const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum Mainnet',
  11155111: 'Sepolia Testnet',
  31337: 'Hardhat Local',
}

export const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  31337: 'http://localhost',
}
