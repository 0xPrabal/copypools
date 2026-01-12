'use client';

import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
  showInfo?: boolean;
}

export function StatCard({
  title,
  value,
  description,
  icon,
  className,
  showInfo = true,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'relative rounded-2xl bg-gray-900/80 p-6 border border-gray-800/50 backdrop-blur-sm',
        className
      )}
    >
      {showInfo && (
        <div className="absolute top-4 right-4 cursor-pointer text-gray-500 hover:text-gray-400 transition-colors">
          <Info className="h-4 w-4" />
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        {icon && <div className="text-brand-medium">{icon}</div>}
        <h3 className="text-gray-400 text-sm font-medium">{title}</h3>
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-2xl font-bold text-brand-medium">{value}</div>
        {description && (
          <p className="text-gray-500 text-xs font-medium">{description}</p>
        )}
      </div>
    </div>
  );
}

export default StatCard;
