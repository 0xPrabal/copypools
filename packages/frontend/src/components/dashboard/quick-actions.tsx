'use client';

import Link from 'next/link';
import { Plus, RefreshCw, TrendingUp, Wallet } from 'lucide-react';

export function QuickActions() {
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/initiator"
        className="flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg font-medium transition-colors"
      >
        <Plus size={18} />
        New Position
      </Link>
      <Link
        href="/compound"
        className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors border border-gray-700"
      >
        <RefreshCw size={18} />
        Compound All
      </Link>
    </div>
  );
}
