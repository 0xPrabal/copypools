'use client';

import { Wallet } from 'lucide-react';

export default function LendPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2 text-text-primary font-heading">Lending</h1>
        <p className="text-text-secondary">
          Borrow against your positions or supply liquidity to earn interest
        </p>
      </div>

      <div className="rounded-2xl bg-surface-card border border-gray-800/50">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-20 h-20 bg-brand-medium/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Wallet className="text-brand-medium" size={40} />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-text-primary">Lending Coming Soon</h3>
            <p className="text-text-secondary">
              Use your LP positions as collateral or supply assets to earn yield
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
