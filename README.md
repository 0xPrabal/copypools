# Uniswap V4 Liquidity Management Platform

A comprehensive liquidity management platform for Uniswap V4, featuring auto-compounding, lending, position automation, and analytics.

## Architecture

This is a monorepo containing:

- **packages/contracts** - Solidity smart contracts (Foundry)
- **packages/ponder** - Ponder indexer for blockchain event indexing
- **packages/backend** - Node.js API and automation bots
- **packages/frontend** - Next.js dashboard and UI

## Features

### Smart Contract Features
- **V4Utils** - Atomic swap & mint, increase/decrease liquidity, collect fees
- **V4Compoundor** - Automated fee compounding for positions
- **V4AutoExit** - Stop-loss and take-profit automation
- **V4AutoRange** - Automatic position rebalancing
- **V4Lend** - Use V4 LP positions as collateral for borrowing
- **V4LeverageTransformer** - Leveraged LP positions

### Platform Features
- Position analytics and tracking
- Historical performance data
- Backtesting for new positions (Initiator)
- Multi-chain support
- Upgradeable contracts (UUPS proxy pattern)

## Quick Start

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests
npm run test

# Start frontend
npm run dev

# Start backend
npm run dev:backend
```

## Deployment

See individual package READMEs for deployment instructions.

## Security

- All contracts use OpenZeppelin's upgradeable patterns
- Comprehensive test coverage
- Formal verification for critical paths
- Immunefi bug bounty program ready

## License

MIT
