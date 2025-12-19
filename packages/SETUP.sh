#!/bin/bash

echo "======================================"
echo "  Copypools - Installation Script"
echo "======================================"
echo ""

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install wagmi viem @tanstack/react-query

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd ../backend
npm install viem dotenv zod pino

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Configure frontend/.env.local with your RPC URLs and WalletConnect Project ID"
echo "2. Configure backend/.env with your RPC URL and private key"
echo "3. Run 'npm run dev' in frontend and backend directories"
echo ""
echo "See INTEGRATION_GUIDE.md for detailed usage instructions"
