# 📜 Copy Pools Protocol

A multi-protocol liquidity management layer that enables users to deposit liquidity into Uniswap V4 (and other DEXs) through a unified interface with automated fee compounding.

## 🎯 Overview

Copy Pools Protocol provides:

- **Multi-DEX Aggregation**: Unified interface for Uniswap V4, V3, PancakeSwap, etc.
- **Automated Compounding**: Auto-reinvest trading fees back into positions
- **Performance Fee**: 2% protocol fee on all accrued trading fees
- **Upgradeable**: UUPS proxy pattern for future enhancements
- **Scalable Architecture**: Adapter pattern for easy integration of new DEXs

## 🏗️ Architecture

The protocol uses the **Adapter/Strategy Pattern**:

```
User → LPManagerV1 → IAdapter → UniswapV4Adapter → Uniswap V4
```

- **LPManagerV1**: Main contract handling user positions, fees, and compounding
- **IAdapter**: Standard interface for all DEX adapters
- **UniswapV4Adapter**: Uniswap V4-specific implementation

## 📦 Smart Contracts

### Core Contracts

1. **LPManagerV1.sol**
   - UUPS upgradeable proxy
   - Manages user positions
   - Handles fee collection and distribution
   - Coordinates compounding operations

2. **IAdapter.sol**
   - Generic interface for DEX integrations
   - Defines standard operations: openPosition, increaseLiquidity, decreaseLiquidity, collectFees

3. **UniswapV4Adapter.sol**
   - Uniswap V4-specific implementation
   - Handles V4 pool interactions
   - Manages liquidity positions

## 🚀 Getting Started

### Prerequisites

- Node.js v18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/doryoku-projects/copypools-smart-contract.git
cd copypools-smart-contract

# Install dependencies
npm install --legacy-peer-deps
```

### Configuration

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PRIVATE_KEY=your_private_key_here
ETHERSCAN_API_KEY=your_etherscan_api_key_here
FEE_COLLECTOR_ADDRESS=your_fee_collector_address_here
```

### Compilation

```bash
npm run compile
```

### Testing

```bash
# Run all tests
npm test

# Run with gas reporting
npm run test:gas
```

### Deployment

```bash
# Deploy to Sepolia testnet
npm run deploy:sepolia

# Deploy to local hardhat network
npm run deploy:local
```

## 🧪 Test Scenarios

The test suite covers three main scenarios:

### 1. Happy Path - Add Liquidity
- User deposits tokens (e.g., 100 USDC + 1000 DAI)
- LPManager creates position via adapter
- User receives position NFT/ID

### 2. The Taxman - Fee Collection
- Simulates trading activity to generate fees
- User calls `compound()`
- 2% fee goes to `feeCollector`
- 98% reinvested into position

### 3. Auto-Balancer - Swap & Compound
- Handles imbalanced fee collection
- Automatically swaps tokens to correct ratio
- Adds balanced liquidity back to position

## 📊 Contract Functions

### User Functions

```solidity
// Add liquidity to a DEX
function addLiquidity(string protocol, LiquidityParams params) returns (uint256 positionId)

// Compound fees back into position
function compound(uint256 positionId, bool doSwap, bytes swapData) returns (uint128)

// Close position and withdraw
function closePosition(uint256 positionId, uint128 liquidity)
```

### Admin Functions

```solidity
// Register new DEX adapter
function registerAdapter(string protocol, address adapter)

// Update fee collector
function setFeeCollector(address newFeeCollector)

// Update protocol fee (max 10%)
function setProtocolFee(uint256 newFeeBps)
```

## 🔒 Security Features

- **UUPS Upgradeable**: Allows bug fixes and feature additions
- **ReentrancyGuard**: Protects against reentrancy attacks
- **Ownable**: Access control for admin functions
- **SafeERC20**: Safe token transfers
- **Fee Cap**: Maximum 10% protocol fee

## 📝 License

MIT License

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📞 Support

For issues and questions:
- GitHub Issues: [Issues](https://github.com/doryoku-projects/copypools-smart-contract/issues)

## 🗺️ Roadmap

- [ ] Uniswap V3 adapter
- [ ] PancakeSwap adapter
- [ ] Advanced swap routing
- [ ] Position NFTs (ERC721)
- [ ] Frontend dashboard
- [ ] Mainnet deployment

## ⚠️ Disclaimer

This is experimental software. Use at your own risk. Always do your own research and audit before using in production.
