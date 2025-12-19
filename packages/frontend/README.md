# Revert V4 Frontend

Next.js frontend application for managing Uniswap V4 liquidity positions with advanced automation features.

## Features

- **Privy Authentication** - Email login and wallet connection with embedded wallets
- **Position Management** - Create, manage, and monitor V4 liquidity positions
- **Auto-Compounding** - Configure automatic fee compounding for positions
- **Auto-Range** - Set up automatic position rebalancing
- **Real-time Data** - GraphQL queries via Ponder indexer
- **Multi-wallet Support** - MetaMask, Coinbase Wallet, and more via Privy

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Authentication**: Privy
- **Blockchain**: Wagmi v2 + Viem
- **Data Fetching**: React Query + GraphQL (Ponder)
- **Styling**: Tailwind CSS + Radix UI
- **State Management**: Zustand
- **Charts**: Recharts + Lightweight Charts

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Required environment variables:

```bash
# Get from https://dashboard.privy.io
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id

# Ponder GraphQL endpoint (local or deployed)
NEXT_PUBLIC_PONDER_URL=http://localhost:42069

# Backend API endpoint
NEXT_PUBLIC_API_URL=http://localhost:3001

# Chain ID (11155111 for Sepolia)
NEXT_PUBLIC_CHAIN_ID=11155111

# RPC URL (optional, uses wallet provider if not set)
NEXT_PUBLIC_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
```

### 3. Start Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## Project Structure

```
packages/frontend/
├── src/
│   ├── app/               # Next.js app router pages
│   │   ├── page.tsx       # Home/dashboard
│   │   ├── positions/     # Position management
│   │   └── layout.tsx     # Root layout
│   ├── components/        # React components
│   │   ├── ui/           # Reusable UI components (Radix)
│   │   └── providers.tsx # App providers (Privy, Wagmi, React Query)
│   ├── config/           # Configuration files
│   │   ├── web3.ts       # Wagmi configuration
│   │   └── contracts.ts  # Contract addresses and ABIs
│   ├── hooks/            # Custom React hooks
│   │   ├── useV4Utils.ts          # V4Utils contract interactions
│   │   ├── useV4Compoundor.ts     # Compounding contract interactions
│   │   ├── useV4AutoRange.ts      # Auto-range contract interactions
│   │   └── usePonderData.ts       # Ponder GraphQL data fetching
│   └── lib/              # Utility functions
│       └── ponder.ts     # Ponder GraphQL client
├── public/               # Static assets
└── .env.local           # Environment variables
```

## Key Concepts

### Authentication with Privy

Privy is configured in `src/components/providers.tsx`:

```typescript
import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';

function MyComponent() {
  const { login, logout, authenticated } = usePrivy();
  const { address } = useAccount();

  // User is authenticated and wallet is connected
}
```

### Contract Interactions

Use the provided hooks for contract interactions:

```typescript
import { useV4Utils } from '@/hooks';

function SwapAndMintButton() {
  const { swapAndMint, isPending, isConfirming } = useV4Utils();

  const handleMint = async () => {
    await swapAndMint({
      poolKey: {...},
      tickLower: -60,
      tickUpper: 60,
      // ... other params
    });
  };

  return (
    <button onClick={handleMint} disabled={isPending}>
      {isPending ? 'Confirming...' : 'Mint Position'}
    </button>
  );
}
```

### Fetching Indexed Data

Use Ponder hooks to query indexed blockchain data:

```typescript
import { useUserPositions, useCompoundEvents } from '@/hooks';

function UserPositions() {
  const { address } = useAccount();
  const { data: positions, isLoading } = useUserPositions(address);

  return (
    <div>
      {positions?.map((position) => (
        <PositionCard key={position.id} position={position} />
      ))}
    </div>
  );
}
```

### Available Ponder Hooks

- `useUserPositions(owner)` - Get all positions for an address
- `usePosition(tokenId)` - Get a specific position by token ID
- `useCompoundConfig(positionId)` - Get compound configuration for a position
- `useCompoundEvents(positionId, limit)` - Get compound event history
- `useProtocolStats()` - Get protocol-wide statistics

## Development Workflow

### 1. Running the Full Stack

Terminal 1 - Ponder Indexer:
```bash
cd packages/ponder
npm run dev
```

Terminal 2 - Backend API:
```bash
cd packages/backend
npm run dev
```

Terminal 3 - Frontend:
```bash
cd packages/frontend
npm run dev
```

### 2. Testing Contract Interactions

1. Ensure you have Sepolia ETH in your wallet
2. Connect wallet via Privy
3. Use the UI to interact with contracts
4. Check Ponder GraphQL playground for indexed data: `http://localhost:42069/graphql`

### 3. Adding New Features

To add a new contract:

1. Add contract ABI to `@revert-v4/contracts` package
2. Update `src/config/contracts.ts` with new contract config
3. Create hook in `src/hooks/useYourContract.ts`
4. Add corresponding event handlers in Ponder
5. Create UI components for the new functionality

## Styling

This project uses Tailwind CSS with a custom design system based on Radix UI primitives.

### Using UI Components

```typescript
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';

function MyComponent() {
  return (
    <Card>
      <CardHeader>Position Details</CardHeader>
      <CardContent>
        <Button variant="default">Compound Fees</Button>
      </CardContent>
    </Card>
  );
}
```

## Building for Production

```bash
npm run build
npm run start
```

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect repository to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

```bash
# Or use Vercel CLI
npm i -g vercel
vercel
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## Environment Variables for Production

```bash
NEXT_PUBLIC_PRIVY_APP_ID=your_production_privy_app_id
NEXT_PUBLIC_PONDER_URL=https://your-ponder-deployment.com
NEXT_PUBLIC_API_URL=https://your-backend-api.com
NEXT_PUBLIC_CHAIN_ID=1  # Mainnet
NEXT_PUBLIC_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

## Troubleshooting

### "Privy not initialized"
- Check that `NEXT_PUBLIC_PRIVY_APP_ID` is set in `.env.local`
- Verify the App ID is correct in Privy dashboard

### "GraphQL query failed"
- Ensure Ponder is running on `http://localhost:42069`
- Check `NEXT_PUBLIC_PONDER_URL` is correctly set
- Verify network connectivity to Ponder instance

### "Transaction failed"
- Check wallet has sufficient Sepolia ETH
- Verify contract addresses are correct
- Check contract is deployed on the correct network
- Review transaction revert reason in wallet

### "RPC error"
- Check RPC URL is valid and has available requests
- Consider using a paid RPC provider (Alchemy, Infura) for better reliability

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Privy Documentation](https://docs.privy.io)
- [Wagmi Documentation](https://wagmi.sh)
- [Ponder Documentation](https://ponder.sh)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Radix UI](https://www.radix-ui.com)
