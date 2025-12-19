'use client';

import { PositionsList } from '@/components/dashboard/positions-list';
import Link from 'next/link';
import { Plus } from 'lucide-react';

export default function PositionsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Your Positions</h1>
          <p className="text-gray-400">Manage and monitor your liquidity positions</p>
        </div>
        <Link href="/initiator" className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          New Position
        </Link>
      </div>

      <PositionsList />
    </div>
  );
}
