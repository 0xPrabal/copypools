import { ContractService } from './contracts'
import { BrowserProvider } from 'ethers'

export interface TokenInfo {
  address: string
  name: string
  symbol: string
  decimals: number
}

// Token cache to avoid repeated calls
const tokenCache = new Map<string, TokenInfo>()

// Common token addresses on Sepolia (for fallback)
const COMMON_TOKENS: Record<string, TokenInfo> = {
  '0x8B86719bEeCd8004569F429549177B9B25c6555a': {
    address: '0x8B86719bEeCd8004569F429549177B9B25c6555a',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
  },
  '0xbaa74e10F7edbC3FCDA7508C27A8F5599d79b09c': {
    address: '0xbaa74e10F7edbC3FCDA7508C27A8F5599d79b09c',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
  },
}

export class TokenInfoService {
  private contractService: ContractService | null = null

  constructor(provider?: BrowserProvider) {
    if (provider) {
      this.contractService = new ContractService(provider)
    }
  }

  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const addressLower = tokenAddress.toLowerCase()

    // Check cache first
    if (tokenCache.has(addressLower)) {
      return tokenCache.get(addressLower)!
    }

    // Check common tokens
    if (COMMON_TOKENS[addressLower]) {
      tokenCache.set(addressLower, COMMON_TOKENS[addressLower])
      return COMMON_TOKENS[addressLower]
    }

    // If we have a provider, fetch from contract
    if (this.contractService) {
      try {
        const info = await this.contractService.getTokenInfo(tokenAddress)
        const tokenInfo: TokenInfo = {
          address: tokenAddress,
          name: info.name,
          symbol: info.symbol,
          decimals: info.decimals,
        }
        tokenCache.set(addressLower, tokenInfo)
        return tokenInfo
      } catch (error) {
        console.error(`Failed to fetch token info for ${tokenAddress}:`, error)
      }
    }

    // Fallback: return address-based info
    const fallback: TokenInfo = {
      address: tokenAddress,
      name: `Token ${addressLower.substring(0, 6)}`,
      symbol: addressLower.substring(0, 6).toUpperCase(),
      decimals: 18,
    }
    tokenCache.set(addressLower, fallback)
    return fallback
  }

  async getMultipleTokenInfo(addresses: string[]): Promise<Map<string, TokenInfo>> {
    const results = new Map<string, TokenInfo>()
    
    await Promise.all(
      addresses.map(async (address) => {
        try {
          const info = await this.getTokenInfo(address)
          results.set(address.toLowerCase(), info)
        } catch (error) {
          console.error(`Error fetching token ${address}:`, error)
        }
      })
    )

    return results
  }

  static getTokenSymbol(address: string): string {
    const addressLower = address.toLowerCase()
    if (COMMON_TOKENS[addressLower]) {
      return COMMON_TOKENS[addressLower].symbol
    }
    if (tokenCache.has(addressLower)) {
      return tokenCache.get(addressLower)!.symbol
    }
    return `${address.substring(0, 6)}...`
  }

  static clearCache() {
    tokenCache.clear()
  }
}

