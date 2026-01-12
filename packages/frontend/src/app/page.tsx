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
      <div className="space-y-6 p-6">
        <div className="h-8 bg-gray-800/50 rounded-xl w-48 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-800/50 rounded-2xl animate-pulse" />
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
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary font-heading">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">
            Manage your liquidity positions and automations
          </p>
        </div>
        <QuickActions />
      </div>

      {/* Stats */}
      <DashboardStats />

      {/* Main Content */}
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
