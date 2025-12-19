'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle, XCircle, Info, ExternalLink, X } from 'lucide-react';
import { CHAIN_IDS } from '@/config/contracts';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  txHash?: string;
  chainId?: number;
}

interface ToastContextType {
  showToast: (toast: Omit<Toast, 'id'>) => void;
}

function getExplorerUrl(chainId: number, txHash: string): string {
  switch (chainId) {
    case CHAIN_IDS.BASE:
      return `https://basescan.org/tx/${txHash}`;
    case CHAIN_IDS.SEPOLIA:
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    case CHAIN_IDS.MAINNET:
      return `https://etherscan.io/tx/${txHash}`;
    default:
      return `https://basescan.org/tx/${txHash}`;
  }
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-sm min-w-[300px] ${
              toast.type === 'success'
                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                : toast.type === 'error'
                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
            }`}
          >
            {toast.type === 'success' && <CheckCircle size={20} />}
            {toast.type === 'error' && <XCircle size={20} />}
            {toast.type === 'info' && <Info size={20} />}
            
            <div className="flex-1">
              <p className="text-sm font-medium">{toast.message}</p>
              {toast.txHash && (
                <a
                  href={getExplorerUrl(toast.chainId || CHAIN_IDS.BASE, toast.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 mt-1 hover:underline"
                >
                  View on Explorer <ExternalLink size={12} />
                </a>
              )}
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="text-gray-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
