'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface TokenPairProps {
  frontSrc?: string;
  backSrc?: string;
  frontSymbol?: string;
  backSymbol?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: { container: 'w-5 h-5', image: 16 },
  md: { container: 'w-7 h-7', image: 24 },
  lg: { container: 'w-9 h-9', image: 32 },
};

export function TokenPair({
  frontSrc,
  backSrc,
  frontSymbol = '',
  backSymbol = '',
  size = 'md',
  className,
}: TokenPairProps) {
  const { container, image } = sizeMap[size];

  // Fallback to colored circles with initials if no image
  const renderToken = (src?: string, symbol?: string, zIndex?: string, marginLeft?: string) => {
    if (src) {
      return (
        <div className={cn(container, 'rounded-full bg-gray-800 flex items-center justify-center', marginLeft, zIndex)}>
          <Image src={src} alt={symbol || ''} width={image} height={image} className="rounded-full" />
        </div>
      );
    }

    return (
      <div className={cn(container, 'rounded-full bg-brand-hard flex items-center justify-center text-white text-xs font-bold', marginLeft, zIndex)}>
        {symbol?.charAt(0) || '?'}
      </div>
    );
  };

  return (
    <div className={cn('relative flex items-center', className)}>
      {/* Back token */}
      {renderToken(backSrc, backSymbol)}

      {/* Front token */}
      {renderToken(frontSrc, frontSymbol, 'z-10', '-ml-2')}
    </div>
  );
}

export default TokenPair;
