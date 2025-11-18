# CopyPools Backend

NestJS backend service for the CopyPools protocol - managing Uniswap V4 liquidity positions through automated operations.

## Features

- REST API for position management
- Blockchain event monitoring and persistence
- Database integration with PostgreSQL
- Transaction tracking and history
- Auto-compound automation (scheduled)
- Health monitoring endpoints

## Architecture

```
src/
├── blockchain/           # Blockchain interaction layer
│   ├── blockchain.service.ts
│   └── blockchain.module.ts
├── positions/           # Position management
│   ├── positions.service.ts
│   ├── positions.controller.ts
│   └── positions.module.ts
├── events/              # Blockchain event monitoring
│   ├── event-monitor.service.ts
│   └── events.module.ts
├── entities/            # TypeORM entities
│   ├── position.entity.ts
│   ├── transaction.entity.ts
│   └── blockchain-event.entity.ts
└── contracts/abi/       # Smart contract ABIs
    ├── LPManagerV1.json
    └── UniswapV4AdapterProduction.json
```

## Setup

### Prerequisites

- Node.js v18+
- PostgreSQL 14+
- Smart contracts deployed (LPManager and Adapter)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start PostgreSQL database:
```bash
# Using Docker
docker run -d \
  --name copypools-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=copypools \
  -p 5432:5432 \
  postgres:14
```

4. Run the application:
```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## Environment Variables

See `.env.example` for all configuration options.

Key variables:
- `RPC_URL`: Ethereum RPC endpoint (Sepolia or mainnet)
- `LP_MANAGER_ADDRESS`: Deployed LPManagerV1 contract address
- `ADAPTER_ADDRESS`: Deployed UniswapV4AdapterProduction contract address
- `OPERATOR_PRIVATE_KEY`: Private key for backend operations
- `DATABASE_*`: PostgreSQL connection details

## API Endpoints

### Health Check
```
GET /positions/health/status
```
Returns blockchain and database health status.

### Position Management

#### Get All Positions
```
GET /positions?owner=0x123...
```
Query parameters:
- `owner` (optional): Filter by owner address

#### Get Position
```
GET /positions/:id
```
Returns position details from database.

#### Get Position Details
```
GET /positions/:id/details
```
Returns full position details including liquidity information.

#### Get Position Transactions
```
GET /positions/:id/transactions
```
Returns transaction history for a position.

#### Move Range
```
POST /positions/:id/move-range
Content-Type: application/json

{
  "tickLower": -443640,
  "tickUpper": 443580,
  "doSwap": false
}
```

#### Close Position
```
POST /positions/:id/close
Content-Type: application/json

{
  "liquidity": "1000000000000000000"
}
```

#### Compound Fees
```
POST /positions/:id/compound
Content-Type: application/json

{
  "doSwap": false
}
```

## Database Schema

### Positions Table
Stores LP position data synced from blockchain.

Fields:
- `positionId`: Unique position identifier
- `protocol`: Protocol identifier (e.g., "uniswap-v4")
- `dexTokenId`: DEX-specific token ID
- `owner`: Position owner address
- `token0`, `token1`: Token addresses
- `active`: Position active status
- `tickLower`, `tickUpper`: Current tick range
- `liquidity`: Current liquidity amount
- `lastCompoundAt`, `compoundCount`: Compound tracking

### Transactions Table
Tracks all operations performed on positions.

Fields:
- `id`: UUID
- `positionId`: Related position
- `type`: Transaction type (OPEN, CLOSE, MOVE_RANGE, COMPOUND)
- `status`: PENDING, SUCCESS, FAILED
- `txHash`: Blockchain transaction hash
- `blockNumber`: Block number
- `gasUsed`: Gas consumed
- `metadata`: Additional transaction data

### Blockchain Events Table
Stores raw blockchain events for audit and replay.

Fields:
- `id`: UUID
- `eventType`: Event type (POSITION_OPENED, RANGE_MOVED, etc.)
- `positionId`: Related position
- `txHash`: Transaction hash
- `blockNumber`: Block number
- `eventData`: Raw event data
- `processed`: Processing status

## Event Monitoring

The `EventMonitorService` automatically:
1. Listens to blockchain events (PositionOpened, RangeMoved, PositionClosed)
2. Saves raw events to database
3. Syncs position state from blockchain
4. Updates position active status

Events are processed in real-time and marked as processed after successful handling.

## Development

### Running Tests
```bash
npm run test
npm run test:e2e
```

### Database Migrations
In production, disable `synchronize` and use migrations:

```bash
npm run typeorm migration:generate -- -n InitialSchema
npm run typeorm migration:run
```

### Debugging
Enable detailed logging:
```bash
NODE_ENV=development npm run start:dev
```

## Deployment

### Production Checklist

1. Set environment to production:
```
NODE_ENV=production
```

2. Disable database auto-sync:
```
synchronize: false
```

3. Use migrations for schema changes

4. Secure operator private key (use secrets manager)

5. Enable connection pooling for database

6. Set up monitoring and alerting

7. Configure CORS appropriately

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "run", "start:prod"]
```

```bash
docker build -t copypools-backend .
docker run -d \
  --name copypools-backend \
  --env-file .env \
  -p 3000:3000 \
  copypools-backend
```

## Smart Contract Integration

The backend integrates with:

1. **LPManagerV1** (`0x8260207716eED59209Eb7606489D6bB2cEbC9986` on Sepolia)
   - Position creation and management
   - Range adjustments
   - Fee compounding
   - Position closure

2. **UniswapV4AdapterProduction** (`0x0a9DC2c5F72d7D7ff25cf23B0CAE1cF1f6583625` on Sepolia)
   - Uniswap V4 specific operations
   - Liquidity modifications
   - Fee collection

## Security Considerations

1. **Private Key Management**: Store operator private key securely (AWS Secrets Manager, HashiCorp Vault)
2. **Input Validation**: All API inputs are validated
3. **Transaction Signing**: Only authorized operator can execute transactions
4. **Rate Limiting**: Implement rate limiting for API endpoints
5. **Error Handling**: Comprehensive error handling prevents information leakage

## Monitoring

Key metrics to monitor:
- Blockchain connection status
- Database connection pool usage
- Event processing lag
- Transaction success/failure rates
- Gas usage per operation
- API response times

## Troubleshooting

### Database Connection Issues
```bash
# Check PostgreSQL is running
docker ps | grep copypools-db

# View logs
docker logs copypools-db
```

### Blockchain Connection Issues
```bash
# Test RPC endpoint
curl -X POST $RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Event Listener Not Working
Check that:
1. Operator has sufficient ETH for gas
2. Contract addresses are correct
3. ABI files are up to date
4. Network ID matches configuration

## Future Enhancements

- [ ] Auto-compound scheduler with profitability calculations
- [ ] WebSocket support for real-time updates
- [ ] GraphQL API
- [ ] Advanced analytics endpoints
- [ ] Multi-chain support
- [ ] Position performance tracking
- [ ] Gas optimization recommendations

## License

MIT
