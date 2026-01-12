'use client';

import Link from 'next/link';
import { Plus, RefreshCw } from 'lucide-react';

export function QuickActions() {
  return (
    <div className="flex items-center gap-3">
      <Link
        href="/initiator"
        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white"
      >
        <Plus size={18} />
        New Position
      </Link>
      <Link
        href="/compound"
        className="flex items-center gap-2 px-4 py-2.5 bg-surface-card hover:bg-gray-800 rounded-xl font-medium transition-colors border border-gray-700/50 hover:border-brand-medium/50 text-text-primary"
      >
        <RefreshCw size={18} />
        Compound All
      </Link>
    </div>
  );
}
