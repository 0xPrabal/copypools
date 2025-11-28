# 📜 Copy Pools Protocol

**Status:** 🎉 WORKING! Uniswap V4 Integration Complete
**Last Updated:** 2025-11-20
**Live Transaction:** [First V4 Position](https://sepolia.etherscan.io/tx/0x9e070444f0de60d5537e2544fb9ac2f94c44af28a58924a4b29ffd3d1a21f473)

A multi-protocol liquidity management layer that enables users to deposit liquidity into Uniswap V4 (and other DEXs) through a unified interface with advanced position management.

## 📁 Project Structure

```
copypools-smart-contract/
├── contracts/          # Smart contracts (Solidity)
├── scripts/           # Deployment & utility scripts
├── test/              # Contract tests
├── copypools-backend/ # NestJS backend API
│   ├── src/          # Backend source code
│   ├── prisma/       # Database schema & migrations
│   └── Dockerfile    # Production Docker config
├── copypools-indexer/ # Ponder blockchain indexer
│   ├── src/          # Indexer event handlers
│   ├── abis/         # Contract ABIs
│   └── Dockerfile    # Production Docker config
├── copypools-nextjs/  # Next.js frontend dashboard
│   ├── app/          # Next.js 13+ app directory
│   ├── components/   # React components
│   └── Dockerfile    # Production Docker config
├── nginx/             # Nginx reverse proxy config
├── docker-compose.yml # Docker orchestration
├── Makefile          # Development & deployment commands
├── DEPLOYMENT.md     # Production deployment guide
└── PRODUCTION_CHECKLIST.md # Pre-deployment checklist
```

**Documentation:**
- Backend: [`copypools-backend/README.md`](./copypools-backend/README.md)
- Deployment: [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- Production Checklist: [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md)

## 🎉 Latest Updates

✅ **UNISWAP V4 FULLY WORKING (Nov 20, 2025)**
- 🚀 First successful position created on V4 Sepolia!
- ✅ Flash accounting pattern implemented correctly
- ✅ Pool initialization with fee tier 500 (0.05%)
- ✅ All V4 delta handling (negative & positive)
- ✅ Production-ready adapter deployed

📄 **Complete Documentation:**
- [`COMPREHENSIVE_V4_TEST_REPORT.md`](./COMPREHENSIVE_V4_TEST_REPORT.md) - **Full test report with findings**
- [`V4_SUCCESS_SUMMARY.md`](./V4_SUCCESS_SUMMARY.md) - Implementation details
- [`V4_TEST_RESULTS.md`](./V4_TEST_RESULTS.md) - Initial test results
- [`UNISWAP_V4_RESEARCH_FINDINGS.md`](./UNISWAP_V4_RESEARCH_FINDINGS.md) - Research & patterns

## 🎯 Overview

Copy Pools Protocol provides:

- **Multi-DEX Aggregation**: Unified interface for Uniswap V4, V3, PancakeSwap, etc.
- **Position Lifecycle Management**: Create, move range, close positions
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

- Node.js v20+
- Docker & Docker Compose (for production)
- PostgreSQL 16+ (if not using Docker)

### Quick Start (Development)

```bash
# Clone the repository
git clone https://github.com/doryoku-projects/copypools-smart-contract.git
cd copypools-smart-contract

# Install dependencies
npm install --legacy-peer-deps

# Backend setup
cd copypools-backend
npm install
cp .env.example .env
# Edit .env with your configuration

# Indexer setup
cd ../copypools-indexer
npm install
cp .env.example .env

# Frontend setup
cd ../copypools-nextjs
npm install
cp .env.example .env.local
```

### Configuration

#### Smart Contracts (.env)

```bash
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PRIVATE_KEY=your_private_key_here
ETHERSCAN_API_KEY=your_etherscan_api_key_here
FEE_COLLECTOR_ADDRESS=your_fee_collector_address_here
```

#### Full Stack (.env.production)

```bash
# Copy production environment template
cp .env.production.example .env

# Edit with your production values
nano .env
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed configuration.

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

#### Smart Contracts

```bash
# Deploy to Sepolia testnet
npx hardhat run scripts/deploy.ts --network sepolia

# Test complete flow (create → move → close)
npx hardhat run scripts/test-moverange-close.ts --network sepolia
```

#### Full Stack (Docker)

```bash
# Development
make up          # Start all services
make logs        # View logs
make health      # Check service health

# Production
make prod        # Start with nginx reverse proxy
make prod-build  # Build and start

# Database operations
make backup      # Create database backup
make db-migrate  # Run migrations
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive deployment instructions.

### Quick Commands

All operations are available via Makefile:

```bash
make help        # Show all available commands
make up          # Start development environment
make down        # Stop all services
make logs        # View logs
make health      # Run health checks
make backup      # Backup database
make clean       # Clean up Docker resources
```

## ✅ Test Results

All core functions tested and verified on Sepolia testnet:

| Function | Status | Gas Cost | Transaction |
|----------|--------|----------|-------------|
| addLiquidity | ✅ PASS | 655,325 | Multiple successful |
| positions query | ✅ PASS | - | Data retrieval |
| moveRange | ✅ PASS | 619,531 | [View](https://sepolia.etherscan.io/tx/0x2f1c28fbf668e343bf0db0bc8bf2a54ebd0148e19176a816abcd79206e858e88) |
| closePosition | ✅ PASS | 209,910 | [View](https://sepolia.etherscan.io/tx/0xba725f3be5426044719e67aba8ae6203f9dd50f77321119164fc4678b95317d0) |

**Success Rate: 100% (5/5 core functions)**

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
