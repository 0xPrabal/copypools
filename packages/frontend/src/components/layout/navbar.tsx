'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, LogOut, Globe, Wallet } from 'lucide-react';
import { CHAIN_IDS } from '@/config/contracts';
import { backendApi } from '@/lib/backend';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/store/theme.store';
import {
  SearchIcon,
  SettingsIcon,
  BellIcon,
  SunIcon,
  MoonIcon,
  InfoIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@/components/icons';

// Info dropdown items
const INFO_ITEMS = [
  'What is Liquidity?',
  'What Are Liquidity Pools?',
  'How Liquidity Providers Earn Fees?',
  'What Is Price Range?',
  'What Is Impermanent Loss?',
  'What Is Auto-Compounding?',
];

// Theme Toggle Component
function ThemeToggle() {
  const { theme, hydrated, setTheme, initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return (
    <div className="relative flex items-center rounded-full bg-gray-800 p-1">
      {/* Sliding pill */}
      <span
        className={cn(
          'absolute left-1 top-1 h-[calc(100%-0.5rem)] w-[calc(50%-0.25rem)] rounded-full',
          'bg-gradient-medium shadow',
          theme === 'dark' && 'translate-x-full',
          hydrated && 'transition-all duration-300 ease-out'
        )}
      />

      {/* Light */}
      <button
        onClick={() => setTheme('light')}
        className={cn(
          'relative z-10 flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors',
          theme === 'light' ? 'text-gray-900' : 'text-gray-400'
        )}
      >
        <SunIcon className="h-4 w-4" />
        Light
      </button>

      {/* Dark */}
      <button
        onClick={() => setTheme('dark')}
        className={cn(
          'relative z-10 flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors',
          theme === 'dark' ? 'text-gray-900' : 'text-gray-400'
        )}
      >
        <MoonIcon className="h-4 w-4" />
        Dark
      </button>
    </div>
  );
}

// Info Dropdown Component
function InfoDropdown() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 bg-gray-800 rounded-xl px-2 py-1.5"
      >
        <InfoIcon className="h-5 w-5" />
        <ChevronDownIcon
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </button>

      <div
        className={cn(
          'absolute right-0 top-full z-50 mt-4 transition-all duration-150',
          open
            ? 'pointer-events-auto opacity-100 translate-y-0'
            : 'pointer-events-none opacity-0 -translate-y-1'
        )}
      >
        <div className="absolute -top-3 right-6 h-6 w-6 rotate-45 bg-gray-800" />

        <div className="flex flex-col gap-4 w-64 rounded-2xl bg-gray-800 p-4 shadow-lg border border-gray-700">
          <div className="text-sm font-semibold text-white">Learn the Basics</div>

          <ul className="space-y-3">
            {INFO_ITEMS.map((item) => (
              <li
                key={item}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between cursor-pointer hover:text-brand-medium transition-colors"
              >
                <span className="text-xs text-gray-400 font-medium">{item}</span>
                <ChevronRightIcon className="h-4 w-4 text-gray-500" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function Navbar() {
  const { login, logout, authenticated, ready } = usePrivy();
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const queryClient = useQueryClient();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleDisconnect = useCallback(async () => {
    setShowDropdown(false);
    queryClient.clear();
    await logout();
  }, [queryClient, logout]);

  // Prefetch positions when wallet connects
  useEffect(() => {
    if (address && authenticated && chainId) {
      backendApi.getPositionsByOwner(address, true, chainId).catch(() => {});
    }
  }, [address, authenticated, chainId]);

  const currentNetwork =
    chainId === CHAIN_IDS.BASE ? 'Base' : chainId === CHAIN_IDS.SEPOLIA ? 'Sepolia' : 'Unknown';
  const networkColor =
    chainId === CHAIN_IDS.BASE ? 'text-blue-400' : 'text-purple-400';

  const formatAddress = (addr: string | undefined) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <nav className="h-16 border-b border-gray-800/50 px-6 flex items-center justify-between bg-surface-card">
      {/* Search */}
      <div className="relative w-72">
        <SearchIcon className="h-5 w-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search by owner, token..."
          className="w-full rounded-xl border border-gray-700 bg-gray-800/50 px-12 py-2.5 text-sm outline-none placeholder:text-gray-500 focus:border-brand-medium transition-colors"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        {/* Settings */}
        <button className="p-2 text-gray-400 hover:text-white transition-colors">
          <SettingsIcon className="h-5 w-5" />
        </button>

        {/* Notifications */}
        <button className="p-2 text-gray-400 hover:text-white transition-colors relative">
          <BellIcon isActive className="h-5 w-5" />
        </button>

        {/* Info Dropdown */}
        <InfoDropdown />

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Network Switcher */}
        {mounted && authenticated && (
          <div className="relative">
            <button
              onClick={() => setShowNetworkDropdown(!showNetworkDropdown)}
              disabled={isSwitching}
              className={cn(
                'flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl hover:border-brand-medium transition-colors',
                isSwitching && 'opacity-50'
              )}
            >
              <Globe size={16} className={networkColor} />
              <span className={cn('text-sm font-medium', networkColor)}>
                {isSwitching ? 'Switching...' : currentNetwork}
              </span>
              <ChevronDown size={14} />
            </button>

            {showNetworkDropdown && (
              <div className="absolute right-0 mt-2 w-40 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50">
                <button
                  onClick={() => {
                    switchChain({ chainId: CHAIN_IDS.BASE });
                    setShowNetworkDropdown(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 transition-colors rounded-t-xl',
                    chainId === CHAIN_IDS.BASE ? 'text-blue-400 bg-blue-500/10' : 'text-gray-300'
                  )}
                >
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full',
                      chainId === CHAIN_IDS.BASE ? 'bg-blue-400' : 'bg-gray-500'
                    )}
                  />
                  Base Mainnet
                </button>
                <button
                  onClick={() => {
                    switchChain({ chainId: CHAIN_IDS.SEPOLIA });
                    setShowNetworkDropdown(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 transition-colors rounded-b-xl',
                    chainId === CHAIN_IDS.SEPOLIA ? 'text-purple-400 bg-purple-500/10' : 'text-gray-300'
                  )}
                >
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full',
                      chainId === CHAIN_IDS.SEPOLIA ? 'bg-purple-400' : 'bg-gray-500'
                    )}
                  />
                  Sepolia
                </button>
              </div>
            )}
          </div>
        )}

        {/* Wallet */}
        {!mounted || !ready ? (
          <div className="w-36 h-10 bg-gray-800 rounded-xl animate-pulse" />
        ) : authenticated && address ? (
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-xl hover:border-brand-medium transition-colors"
            >
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span className="text-sm font-medium">{formatAddress(address)}</span>
              <ChevronDown size={16} />
            </button>

            {showDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50">
                <div className="p-3 border-b border-gray-700">
                  <p className="text-xs text-gray-400">Connected</p>
                  <p className="text-sm font-mono">{formatAddress(address)}</p>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors rounded-b-xl"
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
            className="flex items-center gap-2 px-4 py-2 bg-gradient-hard hover:opacity-90 rounded-xl font-medium transition-all text-white"
          >
            <Wallet size={18} />
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
}
