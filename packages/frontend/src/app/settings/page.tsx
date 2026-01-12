'use client';

import { Settings as SettingsIcon } from 'lucide-react';
import { useThemeStore } from '@/store/theme.store';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { theme, setTheme, initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2 text-text-primary font-heading">Settings</h1>
        <p className="text-text-secondary">Manage your account and preferences</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl bg-surface-card border border-gray-800/50 p-6">
          <h3 className="text-lg font-semibold mb-4 text-text-primary">General Settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-text-primary">Theme</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setTheme('light')}
                  className={cn(
                    'flex-1 px-4 py-2.5 rounded-xl border transition-all font-medium',
                    theme === 'light'
                      ? 'bg-gradient-hard border-brand-medium text-white'
                      : 'bg-gray-800/50 border-gray-700 text-text-secondary hover:border-brand-medium/50'
                  )}
                >
                  Light
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={cn(
                    'flex-1 px-4 py-2.5 rounded-xl border transition-all font-medium',
                    theme === 'dark'
                      ? 'bg-gradient-hard border-brand-medium text-white'
                      : 'bg-gray-800/50 border-gray-700 text-text-secondary hover:border-brand-medium/50'
                  )}
                >
                  Dark
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-text-primary">Currency Display</label>
              <select className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700 rounded-xl focus:outline-none focus:border-brand-medium transition-colors text-text-primary">
                <option value="usd">USD</option>
                <option value="eth">ETH</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-surface-card border border-gray-800/50 p-6">
          <h3 className="text-lg font-semibold mb-4 text-text-primary">Notifications</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-brand-medium focus:ring-brand-medium focus:ring-offset-0"
                defaultChecked
              />
              <span className="text-sm text-text-primary">Position alerts</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-brand-medium focus:ring-brand-medium focus:ring-offset-0"
                defaultChecked
              />
              <span className="text-sm text-text-primary">Price alerts</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 rounded border-gray-700 bg-gray-800 text-brand-medium focus:ring-brand-medium focus:ring-offset-0"
              />
              <span className="text-sm text-text-primary">Marketing emails</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
