'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { focus } from './ui';

/** Meal chip: turmeric when on, dims while saving. */
export function ChipButton({ on, disabled, children }: { on: boolean; disabled: boolean; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-pressed={on}
      disabled={disabled || pending}
      className={`flex min-h-16 w-full flex-col flex-wrap items-center justify-center px-1 py-2 leading-tight md:min-h-12 md:flex-row md:gap-x-1.5 ${on ? 'bg-turmeric text-on-turmeric' : 'border border-muted bg-surface text-ink'} disabled:opacity-60 ${focus}`}
    >
      {children}
    </button>
  );
}
