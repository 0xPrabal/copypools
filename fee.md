
 # CopyPools - 2 month Progress Update

  ## What We Built

  CopyPools is an automated liquidity management tool for Uniswap V4 on Base. Users can auto-compound fees and auto-rebalance their LP positions without manual intervention.

  ---

  ## Contracts Deployed (Base Mainnet)

  We deployed 3 main contracts:

  1. **V4Utils** - `0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1`
     - Handles minting, adding/removing liquidity, fee collection, exit to stablecoin

  2. **V4Compoundor** - `0xB17265e7875416955dE583e3cd1d72Ab5Ed6f670`
     - Auto-compounds fees back into positions

  3. **V4AutoRange** - `0xa3671811324e8868e9fa83038e6b565A5b59719C`
     - Automatically rebalances positions when they go out of range

  Protocol fee is set at 0.65% on compound/rebalance operations.

  ---

  ## Live Deployments

  **Frontend**
  https://copypools-frontend-production.up.railway.app

  **Backend API**
  https://copypool-backend-production.up.railway.app

  **Indexer (GraphQL)**
  https://ponder-production-6e27.up.railway.app/graphql

  All 3 services running on Railway with PostgreSQL database.

  ---

  ## Backend API

  Built REST API with these modules:
  - Positions - fetch user positions, position details, analytics
  - Automation - check compound/rebalance status for positions
  - Pools - pool data and optimal range calculations
  - Prices - token price feeds
  - Lending - LP collateral features (in progress)
  - Notifications - webhook support for position alerts
  - Health - service monitoring

  Around 50 endpoints total, all tested and working.

  ---

  ## Frontend

  Next.js app with these pages:
  - Dashboard - shows user's positions overview
  - Positions list - all LP positions with filters
  - Position detail - manage individual position
  - Compound page - configure auto-compound
  - Range page - configure auto-rebalance
  - Exit page - one-click exit to USDC
  - Analytics - performance tracking
  - Pools - discover pools

  Using wagmi for wallet connections, works with MetaMask and other wallets.

  ---

  ## Smart Contract Testing

  Tested all write functions on mainnet:

  **V4Compoundor** - register/unregister positions, update configs, compound execution, operator approvals, pause/unpause

  **V4AutoRange** - configure range settings, execute rebalance, remove configurations, operator approvals

  **V4Utils** - mint positions, increase/decrease liquidity, collect fees, exit to stablecoin, move range, sweep tokens

  Total 37 functions tested. All working as expected.

  Executed real transactions on mainnet to verify:
  - Registered position 817492 for auto-compound
  - Configured position 824476 for auto-range
  - Collected fees from position 824476

  ---

  ## Tech Stack

  - Contracts: Solidity, Foundry, OpenZeppelin (UUPS upgradeable)
  - Backend: Node.js, Express, TypeScript
  - Frontend: Next.js 14, React, TailwindCSS, wagmi/viem
  - Indexer: Ponder (GraphQL)
  - Database: PostgreSQL
  - Hosting: Railway
  - Chain: Base Mainnet

  ---

  ## What's Done

  - All 3 contracts deployed and verified on Base
  - Backend API live with 50+ endpoints
  - Frontend live with 8 pages
  - Indexer running with GraphQL
  - All contract functions tested
  - End-to-end flow working
  - Production environment stable

  ---
