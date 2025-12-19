'use client';

import { Shield } from 'lucide-react';

export default function ExitPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Auto-Exit</h1>
        <p className="text-gray-400">
          Set stop-loss and take-profit orders for your positions
        </p>
      </div>

      <div className="card">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Shield className="mx-auto mb-4 text-primary-400" size={48} />
            <h3 className="text-xl font-semibold mb-2">Auto-Exit Coming Soon</h3>
            <p className="text-gray-400">
              Configure automated exit strategies for risk management
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
