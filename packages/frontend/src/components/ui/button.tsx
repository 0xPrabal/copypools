'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-bold text-white hover:opacity-90 transition-all disabled:pointer-events-none disabled:opacity-50 shrink-0 outline-none',
  {
    variants: {
      variant: {
        // New design system variants
        muted: 'bg-gray-800 text-gray-400',
        soft: 'bg-gradient-soft',
        medium: 'bg-gradient-medium',
        hard: 'bg-gradient-hard',
        outline: 'border-2 border-brand-medium bg-transparent',
        outlineHard: 'border-2 border-brand-hard bg-transparent',
        link: 'underline-offset-4 hover:underline bg-transparent',
        // Legacy variants for backwards compatibility
        default: 'bg-gradient-hard text-white shadow-glow-teal',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        secondary: 'bg-gray-700 text-white hover:bg-gray-600',
        ghost: 'bg-transparent hover:bg-gray-800/50 text-gray-400 hover:text-white',
      },
      size: {
        default: 'h-[45px] px-4 py-3',
        sm: 'px-2 py-1.5 text-xs font-medium h-8',
        md: 'px-3 py-2 text-sm font-semibold h-10',
        lg: 'px-6 py-3 text-base font-bold h-12',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'hard',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
