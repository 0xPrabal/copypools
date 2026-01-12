'use client';

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '@/lib/utils';

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, value, min = 0, max = 100, ...props }, ref) => {
  const minValue = Array.isArray(value) ? value[0] : 0;
  const maxValue = Array.isArray(value) ? value[1] : 100;
  const range = max - min;

  const minPercent = ((minValue - min) / range) * 100;
  const maxPercent = ((maxValue - min) / range) * 100;

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        className
      )}
      value={value}
      min={min}
      max={max}
      {...props}
    >
      {/* Start circle - blue */}
      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full border-2 border-white bg-[#3F95C0] z-[5]" />

      {/* End circle - orange */}
      <span className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full border-2 border-white bg-[#E5801A] z-[5]" />

      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-gray-700">
        {/* Blue section - from start to min */}
        {minPercent > 0 && (
          <div
            className="absolute h-full bg-[#4A90E2] rounded-l-full"
            style={{ width: `${minPercent}%` }}
          />
        )}

        {/* Green section - between min and max */}
        <SliderPrimitive.Range className="absolute h-full bg-[#85E0BA]" />

        {/* Orange section - from max to end */}
        {maxPercent < 100 && (
          <div
            className="absolute h-full bg-[#F59E0B] rounded-r-full"
            style={{
              left: `${maxPercent}%`,
              width: `${100 - maxPercent}%`,
            }}
          />
        )}
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 bg-[#3F95C0] border-white ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing z-10" />
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 bg-[#E5801A] border-white ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing z-10" />
    </SliderPrimitive.Root>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
