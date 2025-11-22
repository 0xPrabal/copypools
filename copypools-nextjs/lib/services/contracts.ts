import { Contract, BrowserProvider, parseUnits } from 'ethers'
import { LP_MANAGER_ADDRESS, ADAPTER_ADDRESS } from '@/lib/config/constants'
import LPManagerABI from '@/lib/abis/LPManagerV1.json'
import AdapterABI from '@/lib/abis/UniswapV4AdapterProduction.json'
import ERC20ABI from '@/lib/abis/ERC20.json'

export class ContractService {
  private provider: BrowserProvider
  private lpManagerContract: Contract
  private adapterContract: Contract

  constructor(provider: BrowserProvider) {
    this.provider = provider
    this.lpManagerContract = new Contract(
      LP_MANAGER_ADDRESS,
      LPManagerABI.abi,
      provider
    )
    this.adapterContract = new Contract(
      ADAPTER_ADDRESS,
      AdapterABI.abi,
      provider
    )
  }

  // Token helpers
  private getTokenContract(tokenAddress: string): Contract {
    return new Contract(tokenAddress, ERC20ABI.abi, this.provider)
  }

  async getPosition(positionId: bigint) {
    try {
      const position = await (this.lpManagerContract as any).positions(positionId)
      return {
        protocol: position[0],
        dexTokenId: position[1],
        owner: position[2],
        token0: position[3],
        token1: position[4],
        active: position[5],
      }
    } catch (error) {
      console.error('Error getting position:', error)
      throw error
    }
  }

  async getAdapterPosition(dexTokenId: bigint) {
    try {
      const position = await (this.adapterContract as any).positions(dexTokenId)
      return {
        key: position.key,
        owner: position.owner,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: position.liquidity,
      }
    } catch (error) {
      console.error('Error getting adapter position:', error)
      throw error
    }
  }

  // Get protocol fee
  async getProtocolFee(): Promise<bigint> {
    try {
      return await (this.lpManagerContract as any).protocolFeeBps()
    } catch (error) {
      console.error('Error getting protocol fee:', error)
      throw error
    }
  }

  // Get fee collector address
  async getFeeCollector(): Promise<string> {
    try {
      return await (this.lpManagerContract as any).feeCollector()
    } catch (error) {
      console.error('Error getting fee collector:', error)
      throw error
    }
  }

  // Get adapter address for a protocol
  async getAdapterAddress(protocol: string): Promise<string> {
    try {
      return await (this.lpManagerContract as any).getAdapter(protocol)
    } catch (error) {
      console.error('Error getting adapter address:', error)
      throw error
    }
  }

  // Get position details with full information
  async getPositionDetails(positionId: bigint) {
    try {
      const position = await this.getPosition(positionId)

      // Get adapter position details
      const adapterAddress = await (this.lpManagerContract as any).getAdapter(position.protocol)
      const adapterContract = new Contract(adapterAddress, AdapterABI.abi, this.provider) as any

      const adapterPosition = await adapterContract.positions(position.dexTokenId)

      return {
        ...position,
        tickLower: adapterPosition.tickLower,
        tickUpper: adapterPosition.tickUpper,
        liquidity: adapterPosition.liquidity,
      }
    } catch (error) {
      console.error('Error getting position details:', error)
      throw error
    }
  }

  async moveRange(
    positionId: bigint,
    newTickLower: number,
    newTickUpper: number,
    doSwap: boolean = false
  ) {
    try {
      const signer = await this.provider.getSigner()
      const contract = this.lpManagerContract.connect(signer) as any

      const tx = await contract.moveRange(
        positionId,
        newTickLower,
        newTickUpper,
        doSwap,
        '0x' // empty swap data
      )

      return await tx.wait()
    } catch (error) {
      console.error('Error moving range:', error)
      throw error
    }
  }

  async closePosition(positionId: bigint, liquidity: bigint) {
    try {
      const signer = await this.provider.getSigner()
      const contract = this.lpManagerContract.connect(signer) as any

      const tx = await contract.closePosition(positionId, liquidity)
      return await tx.wait()
    } catch (error) {
      console.error('Error closing position:', error)
      throw error
    }
  }

  async compound(positionId: bigint, doSwap: boolean = false) {
    try {
      const signer = await this.provider.getSigner()
      const contract = this.lpManagerContract.connect(signer) as any

      const tx = await contract.compound(positionId, doSwap, '0x')
      return await tx.wait()
    } catch (error) {
      console.error('Error compounding:', error)
      throw error
    }
  }

  // Token operations
  async getTokenBalance(tokenAddress: string, owner: string): Promise<bigint> {
    try {
      const tokenContract = this.getTokenContract(tokenAddress)
      return await (tokenContract as any).balanceOf(owner)
    } catch (error) {
      console.error('Error getting token balance:', error)
      throw error
    }
  }

  async getTokenAllowance(tokenAddress: string, owner: string, spender: string): Promise<bigint> {
    try {
      const tokenContract = this.getTokenContract(tokenAddress)
      return await (tokenContract as any).allowance(owner, spender)
    } catch (error) {
      console.error('Error getting token allowance:', error)
      throw error
    }
  }

  async approveToken(tokenAddress: string, spender: string, amount: bigint) {
    try {
      const signer = await this.provider.getSigner()
      const tokenContract = this.getTokenContract(tokenAddress).connect(signer) as any

      const tx = await tokenContract.approve(spender, amount)
      return await tx.wait()
    } catch (error) {
      console.error('Error approving token:', error)
      throw error
    }
  }

  async getTokenInfo(tokenAddress: string) {
    try {
      const tokenContract = this.getTokenContract(tokenAddress) as any
      const [name, symbol, decimals] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.decimals(),
      ])

      return { name, symbol, decimals }
    } catch (error) {
      console.error('Error getting token info:', error)
      throw error
    }
  }

  // Add Liquidity (Create Position)
  async addLiquidity(
    token0: string,
    token1: string,
    amount0: bigint,
    amount1: bigint,
    tickLower: number,
    tickUpper: number,
    fee: number = 3000, // default fee tier
    protocol: string = 'UNISWAP_V4' // default protocol
  ) {
    try {
      const signer = await this.provider.getSigner()
      const signerAddress = await signer.getAddress()

      // Check balances
      const balance0 = await this.getTokenBalance(token0, signerAddress)
      const balance1 = await this.getTokenBalance(token1, signerAddress)

      if (balance0 < amount0) {
        throw new Error(`Insufficient ${token0} balance. Need ${amount0}, have ${balance0}`)
      }
      if (balance1 < amount1) {
        throw new Error(`Insufficient ${token1} balance. Need ${amount1}, have ${balance1}`)
      }

      // Check and approve tokens if needed (approve to LPManager, not Adapter)
      const allowance0 = await this.getTokenAllowance(token0, signerAddress, LP_MANAGER_ADDRESS)
      const allowance1 = await this.getTokenAllowance(token1, signerAddress, LP_MANAGER_ADDRESS)

      if (allowance0 < amount0) {
        console.log('Approving token0...')
        await this.approveToken(token0, LP_MANAGER_ADDRESS, amount0)
      }

      if (allowance1 < amount1) {
        console.log('Approving token1...')
        await this.approveToken(token1, LP_MANAGER_ADDRESS, amount1)
      }

      // Prepare parameters matching the contract structure
      const contract = this.lpManagerContract.connect(signer) as any

      // LiquidityParams structure
      const liquidityParams = {
        pool: {
          token0: token0,
          token1: token1,
          fee: fee,
          tickLower: tickLower,
          tickUpper: tickUpper,
          extraData: '0x' // Empty bytes for no hooks
        },
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0n, // Set to 0 to allow any amount (pool price determines ratio)
        amount1Min: 0n, // Set to 0 to allow any amount (pool price determines ratio)
        recipient: signerAddress
      }

      // Call addLiquidity with protocol and params
      const tx = await contract.addLiquidity(protocol, liquidityParams)
      return await tx.wait()
    } catch (error) {
      console.error('Error adding liquidity:', error)
      throw error
    }
  }

  // Increase Liquidity to existing position
  async increaseLiquidity(
    positionId: bigint,
    amount0: bigint,
    amount1: bigint,
    amount0Min: bigint = 0n,
    amount1Min: bigint = 0n
  ) {
    try {
      const signer = await this.provider.getSigner()
      const signerAddress = await signer.getAddress()

      // Get position details to know which tokens to approve
      const position = await this.getPosition(positionId)

      // Approve tokens to LPManager (not adapter!)
      const allowance0 = await this.getTokenAllowance(position.token0, signerAddress, LP_MANAGER_ADDRESS)
      const allowance1 = await this.getTokenAllowance(position.token1, signerAddress, LP_MANAGER_ADDRESS)

      if (allowance0 < amount0) {
        await this.approveToken(position.token0, LP_MANAGER_ADDRESS, amount0)
      }

      if (allowance1 < amount1) {
        await this.approveToken(position.token1, LP_MANAGER_ADDRESS, amount1)
      }

      // Call LPManager (not adapter!)
      const lpManager = this.lpManagerContract.connect(signer) as any

      const tx = await lpManager.increaseLiquidity(
        positionId,
        amount0,
        amount1,
        amount0Min,
        amount1Min
      )

      return await tx.wait()
    } catch (error) {
      console.error('Error increasing liquidity:', error)
      throw error
    }
  }

  // Collect fees from a position
  async collectFees(positionId: bigint) {
    try {
      const signer = await this.provider.getSigner()

      // Call LPManager
      const lpManager = this.lpManagerContract.connect(signer) as any

      const tx = await lpManager.collectFees(positionId)
      return await tx.wait()
    } catch (error) {
      console.error('Error collecting fees:', error)
      throw error
    }
  }

  // Decrease liquidity from a position
  async decreaseLiquidity(
    positionId: bigint,
    liquidityAmount: bigint,
    amount0Min: bigint = 0n,
    amount1Min: bigint = 0n
  ) {
    try {
      const signer = await this.provider.getSigner()

      // Call LPManager
      const lpManager = this.lpManagerContract.connect(signer) as any

      const tx = await lpManager.decreaseLiquidity(
        positionId,
        liquidityAmount,
        amount0Min,
        amount1Min
      )
      return await tx.wait()
    } catch (error) {
      console.error('Error decreasing liquidity:', error)
      throw error
    }
  }

  // Burn position (removes ALL liquidity and closes position)
  async burnPosition(positionId: bigint) {
    try {
      const signer = await this.provider.getSigner()

      // Get position details to find total liquidity
      const position = await this.getPosition(positionId)

      // Get adapter position to get liquidity amount
      const adapterPosition = await this.getAdapterPosition(position.dexTokenId)
      const totalLiquidity = adapterPosition.liquidity

      if (totalLiquidity === 0n) {
        throw new Error('Position has no liquidity to burn')
      }

      // Call LPManager's closePosition with ALL liquidity
      const lpManager = this.lpManagerContract.connect(signer) as any
      const tx = await lpManager.closePosition(positionId, totalLiquidity)
      return await tx.wait()
    } catch (error) {
      console.error('Error burning position:', error)
      throw error
    }
  }
}
