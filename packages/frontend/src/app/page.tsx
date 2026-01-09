'use client';

import { DashboardStats } from '@/components/dashboard/stats';
import { PositionsList } from '@/components/dashboard/positions-list';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { ConnectPrompt } from '@/components/common/connect-prompt';
import { useWalletConnection } from '@/hooks/useWalletConnection';

export default function Dashboard() {
  const { isFullyConnected, isLoading } = useWalletConnection();

  // Show loading state while Privy is initializing
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-gray-800 rounded w-48 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Use unified connection check (both Privy AND Wagmi must be connected)
  if (!isFullyConnected) {
    return <ConnectPrompt />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <QuickActions />
      </div>

      <DashboardStats />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PositionsList />
        </div>
        <div>
          <RecentActivity />
        </div>
      </div>
    </div>
  );
}
