'use client';

import { PositionsList } from '@/components/dashboard/positions-list';
import Link from 'next/link';
import { Plus } from 'lucide-react';

export default function PositionsPage() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-text-primary font-heading">Your Positions</h1>
          <p className="text-text-secondary">Manage and monitor your liquidity positions</p>
        </div>
        <Link
          href="/initiator"
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white"
        >
          <Plus size={18} />
          New Position
        </Link>
      </div>

      <PositionsList />
    </div>
  );
}
