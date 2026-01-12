'use client';

import { usePrivy } from '@privy-io/react-auth';
import { Wallet } from 'lucide-react';

export function ConnectPrompt() {
  const { login, ready } = usePrivy();

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-gradient-hard rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-brand-medium/20">
          <Wallet className="text-white" size={40} />
        </div>
        <h2 className="text-2xl font-bold text-text-primary mb-4 font-heading">
          Connect Your Wallet
        </h2>
        <p className="text-text-secondary mb-8">
          Connect your wallet to view your positions, manage liquidity, and access all CopyPools features.
        </p>
        <button
          onClick={login}
          disabled={!ready}
          className="inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white disabled:opacity-50 shadow-lg shadow-brand-medium/20"
        >
          <Wallet size={20} />
          Connect Wallet
        </button>
      </div>
    </div>
  );
}
