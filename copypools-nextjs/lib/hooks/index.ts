// Export Privy-based wallet hook as the default
// To use the old MetaMask-only hook, import from './useWallet' directly
export { usePrivyWallet as useWallet } from './usePrivyWallet'

// Also export the original for backwards compatibility
export { useWallet as useMetaMaskWallet } from './useWallet'
