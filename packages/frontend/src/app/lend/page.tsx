'use client';

import { Wallet } from 'lucide-react';

export default function LendPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Lending</h1>
        <p className="text-gray-400">
          Borrow against your positions or supply liquidity to earn interest
        </p>
      </div>

      <div className="card">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Wallet className="mx-auto mb-4 text-primary-400" size={48} />
            <h3 className="text-xl font-semibold mb-2">Lending Coming Soon</h3>
            <p className="text-gray-400">
              Use your LP positions as collateral or supply assets to earn yield
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
