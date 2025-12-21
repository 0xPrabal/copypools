'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useState, useEffect } from 'react';
import { ChevronDown, Wallet, LogOut, Settings, Bell, Globe } from 'lucide-react';
import { CHAIN_IDS } from '@/config/contracts';
import { backendApi } from '@/lib/backend';

export function Navbar() {
  const { login, logout, authenticated, ready } = usePrivy();
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prefetch positions when wallet connects (warms up backend cache)
  useEffect(() => {
    if (address && authenticated && chainId) {
      // Prefetch in background - this warms up the backend cache
      backendApi.getPositionsByOwner(address, true, chainId).catch(() => {});
    }
  }, [address, authenticated, chainId]);

  const currentNetwork = chainId === CHAIN_IDS.BASE ? 'Base' : chainId === CHAIN_IDS.SEPOLIA ? 'Sepolia' : 'Unknown';
  const networkColor = chainId === CHAIN_IDS.BASE ? 'text-blue-400' : 'text-purple-400';

  const formatAddress = (addr: string | undefined) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <nav className="h-16 border-b border-gray-800 px-6 flex items-center justify-between bg-gray-900/50 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <div className="relative">
          <input
            type="text"
            placeholder="Search positions, pools..."
            className="w-64 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-primary-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button className="p-2 text-gray-400 hover:text-white transition-colors relative">
          <Bell size={20} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-primary-500 rounded-full" />
        </button>

        {/* Settings */}
        <button className="p-2 text-gray-400 hover:text-white transition-colors">
          <Settings size={20} />
        </button>

        {/* Network Switcher */}
        {mounted && authenticated && (
          <div className="relative">
            <button
              onClick={() => setShowNetworkDropdown(!showNetworkDropdown)}
              disabled={isSwitching}
              className={`flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg hover:border-primary-500 transition-colors ${isSwitching ? 'opacity-50' : ''}`}
            >
              <Globe size={16} className={networkColor} />
              <span className={`text-sm font-medium ${networkColor}`}>
                {isSwitching ? 'Switching...' : currentNetwork}
              </span>
              <ChevronDown size={14} />
            </button>

            {showNetworkDropdown && (
              <div className="absolute right-0 mt-2 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
                <button
                  onClick={() => {
                    switchChain({ chainId: CHAIN_IDS.BASE });
                    setShowNetworkDropdown(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 transition-colors rounded-t-lg ${chainId === CHAIN_IDS.BASE ? 'text-blue-400 bg-blue-500/10' : 'text-gray-300'}`}
                >
                  <div className={`w-2 h-2 rounded-full ${chainId === CHAIN_IDS.BASE ? 'bg-blue-400' : 'bg-gray-500'}`} />
                  Base Mainnet
                </button>
                <button
                  onClick={() => {
                    switchChain({ chainId: CHAIN_IDS.SEPOLIA });
                    setShowNetworkDropdown(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 transition-colors rounded-b-lg ${chainId === CHAIN_IDS.SEPOLIA ? 'text-purple-400 bg-purple-500/10' : 'text-gray-300'}`}
                >
                  <div className={`w-2 h-2 rounded-full ${chainId === CHAIN_IDS.SEPOLIA ? 'bg-purple-400' : 'bg-gray-500'}`} />
                  Sepolia
                </button>
              </div>
            )}
          </div>
        )}

        {/* Wallet */}
        {!mounted || !ready ? (
          <div className="w-36 h-10 bg-gray-800 rounded-lg animate-pulse" />
        ) : authenticated && address ? (
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg hover:border-primary-500 transition-colors"
            >
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span className="text-sm font-medium">{formatAddress(address)}</span>
              <ChevronDown size={16} />
            </button>

            {showDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
                <div className="p-3 border-b border-gray-700">
                  <p className="text-xs text-gray-400">Connected</p>
                  <p className="text-sm font-mono">{formatAddress(address)}</p>
                </div>
                <button
                  onClick={() => {
                    logout();
                    setShowDropdown(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
                >
                  <LogOut size={16} />
                  Disconnect
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={login}
            className="flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg font-medium transition-colors"
          >
            <Wallet size={18} />
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
}
