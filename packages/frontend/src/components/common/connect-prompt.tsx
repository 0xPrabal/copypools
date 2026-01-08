'use client';

import { useConnect } from 'wagmi';
import { Wallet } from 'lucide-react';

export function ConnectPrompt() {
  const { connect, connectors, isPending } = useConnect();

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-primary-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <Wallet className="text-primary-400" size={40} />
        </div>
        <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
        <p className="text-gray-400 mb-8">
          Connect your wallet to view your positions, manage liquidity, and access all CopyPools features.
        </p>
        <div className="space-y-3">
          {connectors.map((connector) => (
            <button
              key={connector.id}
              onClick={() => connect({ connector })}
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors border border-gray-700 disabled:opacity-50"
            >
              {connector.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
