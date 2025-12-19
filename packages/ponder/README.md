# Ponder Indexer

Blockchain event indexer for Revert V4 using [Ponder](https://ponder.sh/).

## Overview

This indexer tracks events from the Revert V4 smart contracts and provides a GraphQL API for querying indexed data. It monitors:

- **V4Utils** - Position management (mint, liquidity changes, fee collection)
- **V4Compoundor** - Auto-compounding events
- **V4AutoRange** - Range rebalancing events

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local` and configure:

```bash
cp .env.example .env.local
```

Required variables:
- `PONDER_RPC_URL_11155111` - Sepolia RPC URL (get from Alchemy/Infura)
- `V4_UTILS_ADDRESS` - V4Utils contract address
- `V4_COMPOUNDOR_ADDRESS` - V4Compoundor contract address
- `V4_AUTO_RANGE_ADDRESS` - V4AutoRange contract address

Optional:
- `DATABASE_URL` - PostgreSQL connection (uses SQLite by default)

### 3. Generate Types

```bash
npm run codegen
```

This generates TypeScript types from your schema and ABIs.

## Development

### Start Development Server

```bash
npm run dev
```

This starts:
- Indexing service (syncs blockchain events)
- GraphQL API at `http://localhost:42069/graphql`
- GraphQL Playground for testing queries

### Start Production Server

```bash
npm run start
```

## Project Structure

```
packages/ponder/
├── src/
│   ├── index.ts           # Main event handlers entry point
│   ├── V4Utils.ts         # V4Utils event handlers
│   ├── V4Compoundor.ts    # Compounding event handlers
│   ├── V4AutoRange.ts     # Auto-range event handlers
│   └── api/
│       └── index.ts       # Custom GraphQL endpoints
├── abis/                  # Contract ABIs
├── ponder.config.ts       # Network and contract configuration
├── ponder.schema.ts       # Database schema definitions
└── .env.local            # Local environment variables

## Schema

The schema includes entities for:

- **Core**: Position, Pool, Token
- **Automation**: CompoundConfig, ExitConfig, RangeConfig
- **Events**: CompoundEvent, ExitEvent, RebalanceEvent
- **Lending**: Vault, Loan, Supply
- **Stats**: ProtocolStats, DailyStats, Account

View full schema in `ponder.schema.ts`.

## Querying Data

### GraphQL Playground

Visit `http://localhost:42069/graphql` to use the interactive playground.

### Example Queries

Get all positions for an address:
```graphql
query {
  positions(where: { owner: "0x..." }) {
    id
    tokenId
    owner
    liquidity
    tickLower
    tickUpper
    collectedFeesToken0
    collectedFeesToken1
  }
}
```

Get compound events:
```graphql
query {
  compoundEvents(orderBy: "timestamp", orderDirection: "desc", limit: 10) {
    id
    positionId
    timestamp
    amount0Compounded
    amount1Compounded
    liquidityAdded
  }
}
```

## Adding New Contracts

1. Add contract ABI to `abis/` directory
2. Update `ponder.config.ts` to include the new contract
3. Create event handlers in `src/YourContract.ts`
4. Update schema in `ponder.schema.ts` if needed
5. Run `npm run codegen` to regenerate types

## Database

By default, Ponder uses SQLite for local development. For production, configure PostgreSQL:

```bash
DATABASE_URL=postgresql://user:password@host:port/database
```

Ponder automatically manages database migrations based on your schema.

## Deployment

### Railway/Heroku/DigitalOcean

1. Set environment variables
2. Deploy the application
3. Run `npm run start`

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run codegen
CMD ["npm", "run", "start"]
```

## Troubleshooting

### Sync Issues

If indexing stops or falls behind:
```bash
# Clear cache and restart
rm -rf .ponder/
npm run dev
```

### Type Errors

Regenerate types after schema or ABI changes:
```bash
npm run codegen
```

## Resources

- [Ponder Documentation](https://ponder.sh/)
- [Ponder Examples](https://github.com/ponder-sh/ponder/tree/main/examples)
- [GraphQL Documentation](https://graphql.org/learn/)
