'use client';

import { cn } from '@/lib/utils';

interface StepperProps {
  currentStep: number;
}

export function Stepper({ currentStep }: StepperProps) {
  return (
    <div className="flex items-center justify-between bg-gray-100 dark:bg-gray-800/50 px-8 lg:px-28 py-8 rounded-t-2xl">
      <StepperItem step={1} label="Select Pool" active={currentStep === 1} completed={currentStep > 1} />
      <StepperDivider completed={currentStep > 1} />
      <StepperItem step={2} label="Select Range" active={currentStep === 2} completed={currentStep > 2} />
      <StepperDivider completed={currentStep > 2} />
      <StepperItem step={3} label="Deposit Amount" active={currentStep === 3} completed={currentStep > 3} />
    </div>
  );
}

function StepperItem({
  step,
  label,
  active = false,
  completed = false,
}: {
  step: number;
  label: string;
  active?: boolean;
  completed?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          'h-10 w-10 rounded-full bg-gradient-medium text-white font-semibold flex items-center justify-center transition-all',
          !active && !completed && 'opacity-50'
        )}
      >
        {step}
      </div>
      <span
        className={cn(
          'text-sm font-medium',
          active ? 'text-text-primary' : 'text-text-muted'
        )}
      >
        {label}
      </span>
    </div>
  );
}

function StepperDivider({ completed = false }: { completed?: boolean }) {
  return (
    <div
      className={cn(
        'flex-1 h-0.5 mx-4 lg:mx-6 transition-colors',
        completed ? 'bg-brand-medium' : 'bg-[#C5ECEB] dark:bg-gray-700'
      )}
    />
  );
}
