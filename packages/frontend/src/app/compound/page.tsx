'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// Dynamically import the actual page content to avoid SSR issues with wagmi hooks
const CompoundContent = dynamic(
  () => import('./compound-content'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-brand-medium" size={48} />
      </div>
    ),
  }
);

export default function CompoundPage() {
  return <CompoundContent />;
}
